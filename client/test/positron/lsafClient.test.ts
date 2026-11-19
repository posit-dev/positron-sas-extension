// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  HttpRequest,
  HttpResponse,
  LsafActionError,
  LsafClient,
  LsafError,
  basicAuth,
  checkAction,
  checkActions,
  describeError,
  parseEncryptedPassword,
} from "../../src/lsaf/LsafClient";
import {
  encodePath,
  extension,
  jobPathForProgram,
  jobUrl,
  normalizeApiUrl,
  parentPath,
  relativeProgramReference,
  repositoryContainerUrl,
  repositoryFileUrl,
  resolvePath,
  submissionUrl,
  workspaceFolderUrl,
} from "../../src/lsaf/paths";
import { classifyLsafProbe, combineProbes } from "../../src/lsaf/probeResult";

const encoder = new TextEncoder();

const response = (
  status: number,
  body: unknown = "",
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers: {
    "content-type":
      typeof body === "string" ? "text/plain" : "application/json",
    ...headers,
  },
  data: encoder.encode(typeof body === "string" ? body : JSON.stringify(body)),
});

/** A transport that answers from a queue and records the requests. */
function fakeTransport(answers: Array<(request: HttpRequest) => HttpResponse>) {
  const requests: HttpRequest[] = [];
  const transport = async (request: HttpRequest) => {
    requests.push(request);
    const answer = answers.shift();
    if (!answer) {
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    }
    return answer(request);
  };
  return { requests, transport };
}

const logonOk = (token: string) => () =>
  response(200, "", { "x-auth-token": token });

describe("LSAF paths", () => {
  it("normalizes server URLs to the REST API root", () => {
    expect(normalizeApiUrl("lsaf.example.com")).to.equal(
      "https://lsaf.example.com/lsaf/api",
    );
    expect(normalizeApiUrl("https://lsaf.example.com/")).to.equal(
      "https://lsaf.example.com/lsaf/api",
    );
    expect(normalizeApiUrl("https://lsaf.example.com/lsaf")).to.equal(
      "https://lsaf.example.com/lsaf/api",
    );
    expect(normalizeApiUrl(" https://h:8443/lsaf/api/ ")).to.equal(
      "https://h:8443/lsaf/api",
    );
    expect(normalizeApiUrl("http://127.0.0.1:8765/custom/api")).to.equal(
      "http://127.0.0.1:8765/custom/api",
    );
    expect(normalizeApiUrl("")).to.equal(undefined);
    expect(normalizeApiUrl("ftp://h")).to.equal(undefined);
  });

  it("encodes each path segment and keeps the slashes", () => {
    expect(encodePath("/Org/My Study/a#1.sas")).to.equal(
      "Org/My%20Study/a%231.sas",
    );
    expect(encodePath("/")).to.equal("");
    expect(repositoryFileUrl("/a/b.sas")).to.equal("/repository/files/a/b.sas");
    expect(repositoryContainerUrl("/")).to.equal("/repository/containers");
    expect(workspaceFolderUrl("")).to.equal("/workspace/folders");
    expect(jobUrl("workspace", "/a/b.job")).to.equal("/jobs/workspace/a/b.job");
    expect(submissionUrl("x y", "manifest")).to.equal(
      "/jobs/submissions/x%20y/manifest",
    );
  });

  it("derives parents, extensions and the job of a program", () => {
    expect(parentPath("/a/b/c.sas")).to.equal("/a/b");
    expect(parentPath("/a")).to.equal("/");
    expect(extension("/a/B.SAS")).to.equal("sas");
    expect(extension("/a/.profile")).to.equal("");
    expect(jobPathForProgram("/Org/S/programs/adsl.sas")).to.equal(
      "/Org/S/programs/adsl.job",
    );
    expect(relativeProgramReference("/Org/S/adsl.sas")).to.equal("./adsl.sas");
  });

  it("resolves paths relative to a job's folder", () => {
    expect(resolvePath("/a/jobs", "./logs/x.log")).to.equal(
      "/a/jobs/logs/x.log",
    );
    expect(resolvePath("/a/jobs", "../programs/p.sas?version=1.0")).to.equal(
      "/a/programs/p.sas",
    );
    expect(resolvePath("/a/jobs", "/b/x.log")).to.equal("/b/x.log");
  });
});

describe("LSAF probe", () => {
  it("recognizes the API by its metadata or its error body", () => {
    expect(
      classifyLsafProbe(200, "application/json", '{"version":"1.0"}'),
    ).to.equal("lsaf");
    expect(
      classifyLsafProbe(401, "application/vnd.sas.hls.error+json", ""),
    ).to.equal("lsaf");
    expect(
      classifyLsafProbe(401, "application/json", '{"errorCode":1002}'),
    ).to.equal("lsaf");
  });

  it("rejects anything else", () => {
    expect(classifyLsafProbe(200, "text/html", "<html>")).to.equal("absent");
    expect(classifyLsafProbe(200, "application/json", '"text"')).to.equal(
      "absent",
    );
    expect(classifyLsafProbe(401, "text/html", "login")).to.equal("absent");
    expect(classifyLsafProbe(401, "application/json", "{}")).to.equal("absent");
    expect(classifyLsafProbe(404, "application/json", "{}")).to.equal("absent");
    expect(classifyLsafProbe(302, "", "")).to.equal("absent");
  });

  it("retries server errors", () => {
    expect(classifyLsafProbe(503, "text/html", "")).to.equal("error");
    expect(combineProbes("error", "absent")).to.equal("error");
    expect(combineProbes("absent", "lsaf")).to.equal("lsaf");
    expect(combineProbes("absent", "absent")).to.equal("absent");
  });
});

describe("LSAF client", () => {
  it("parses the encrypted password in every documented shape", () => {
    expect(parseEncryptedPassword('"{P21}abc=="')).to.equal("{P21}abc==");
    expect(
      parseEncryptedPassword('{"encryptedPassword":"{P21}abc=="}'),
    ).to.equal("{P21}abc==");
    expect(parseEncryptedPassword("{P21}abc==\n")).to.equal("{P21}abc==");
    expect(parseEncryptedPassword("")).to.equal(undefined);
    expect(parseEncryptedPassword("{}")).to.equal(undefined);
  });

  it("encrypts with Basic authentication", async () => {
    const { requests, transport } = fakeTransport([
      () => response(200, "{P21}secret"),
    ]);
    const client = new LsafClient("https://h/lsaf/api", transport);
    expect(await client.encrypt("me", "pw")).to.equal("{P21}secret");
    expect(requests[0].method).to.equal("GET");
    expect(requests[0].url).to.equal("/encrypt");
    expect(requests[0].headers.Authorization).to.equal(basicAuth("me", "pw"));
  });

  it("logs on, sends the token, and logs on again when it expires", async () => {
    const { requests, transport } = fakeTransport([
      logonOk("t1"),
      () => response(200, { items: [] }),
      () =>
        response(
          401,
          { errorCode: 1002, message: "expired" },
          { "content-type": "application/vnd.sas.hls.error+json" },
        ),
      logonOk("t2"),
      () => response(200, { items: [1] }),
    ]);
    const client = new LsafClient("https://h/lsaf/api", transport, {
      userId: "me",
      secret: "{P21}x",
    });
    await client.logon();
    expect(requests[0].url).to.equal("/logon");
    expect(requests[0].method).to.equal("POST");
    expect(requests[0].headers.Authorization).to.equal(
      basicAuth("me", "{P21}x"),
    );
    await client.getJson("/a");
    expect(requests[1].headers["X-Auth-Token"]).to.equal("t1");
    const result = await client.getJson<{ items: number[] }>("/b", {
      component: "children",
    });
    expect(result.items).to.deep.equal([1]);
    expect(requests.map((r) => r.url)).to.deep.equal([
      "/logon",
      "/a",
      "/b",
      "/logon",
      "/b",
    ]);
    expect(requests[4].headers["X-Auth-Token"]).to.equal("t2");
    expect(requests[4].params).to.deep.equal({ component: "children" });
  });

  it("shares one logon between concurrent requests", async () => {
    const { requests, transport } = fakeTransport([
      logonOk("t"),
      () => response(200, {}),
      () => response(200, {}),
    ]);
    const client = new LsafClient("u", transport, {
      userId: "me",
      secret: "s",
    });
    await Promise.all([client.getJson("/a"), client.getJson("/b")]);
    expect(requests.filter((r) => r.url === "/logon")).to.have.length(1);
  });

  it("turns error bodies into LsafErrors", async () => {
    const { transport } = fakeTransport([
      logonOk("t"),
      () =>
        response(
          404,
          {
            httpStatusCode: 404,
            errorCode: 2002,
            message: "The file was not found.",
            remediation: "Check the path.",
          },
          { "content-type": "application/vnd.sas.hls.error+json" },
        ),
    ]);
    const client = new LsafClient("u", transport, {
      userId: "me",
      secret: "s",
    });
    try {
      await client.getJson("/repository/files/x");
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.be.instanceOf(LsafError);
      if (error instanceof LsafError) {
        expect(error.status).to.equal(404);
        expect(error.errorCode).to.equal(2002);
      }
      expect(describeError(error)).to.equal(
        "The file was not found. Check the path.",
      );
    }
  });

  it("fails a logon without a token header", async () => {
    const { transport } = fakeTransport([() => response(200, "")]);
    const client = new LsafClient("u", transport, {
      userId: "me",
      secret: "s",
    });
    try {
      await client.logon();
      expect.fail("should throw");
    } catch (error) {
      expect(describeError(error)).to.match(/X-Auth-Token/);
    }
  });

  it("checks action results that answer 200", () => {
    expect(() =>
      checkAction({ status: { type: "success" } }, "Upload"),
    ).not.to.throw();
    expect(() =>
      checkAction({ status: { type: "started", code: 40001 } }, "Run"),
    ).not.to.throw();
    expect(() =>
      checkAction(
        {
          status: {
            type: "warning",
            code: 20012,
            message: "File was not updated.",
          },
        },
        "Upload",
      ),
    ).to.throw(LsafActionError, "Upload: File was not updated.");
    expect(() =>
      checkAction({ status: { type: "failure", code: 3 } }, "Check in"),
    ).to.throw(LsafActionError, "(3)");
    expect(() =>
      checkActions(
        { successes: { count: 1 }, failures: { count: 0 } },
        "Upload",
      ),
    ).not.to.throw();
    expect(() =>
      checkActions(
        {
          failures: {
            count: 1,
            items: [{ status: { message: "No permission." } }],
          },
        },
        "Upload",
      ),
    ).to.throw(LsafActionError, "No permission.");
  });

  it("logs off with the token and forgets it", async () => {
    const { requests, transport } = fakeTransport([
      logonOk("t"),
      () => response(200, ""),
    ]);
    const client = new LsafClient("u", transport, {
      userId: "me",
      secret: "s",
    });
    await client.logon();
    await client.logoff();
    expect(requests[1].url).to.equal("/logoff");
    expect(requests[1].headers["X-Auth-Token"]).to.equal("t");
    expect(client.signedIn).to.equal(false);
  });
});
