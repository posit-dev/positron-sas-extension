// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { get } from "http";

import { ViewerServer } from "../../src/positron/viewerServer";

/** GET a URL; resolves with the status and body. */
const fetchUrl = (url: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });

describe("ViewerServer", () => {
  let opened: string[];
  let server: ViewerServer;

  beforeEach(() => {
    opened = [];
    server = new ViewerServer((target) => {
      opened.push(target);
      return target.startsWith("sasClinical");
    }, 2);
  });

  afterEach(() => server.dispose());

  it("serves published pages on localhost behind a token", async () => {
    const url = await server.publish("<p>report</p>", "manifest-probe");
    expect(url).to.match(
      /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/page\/1-manifest-probe\.html$/,
    );
    expect(await fetchUrl(url)).to.deep.equal({
      status: 200,
      body: "<p>report</p>",
    });
    // Without the token, nothing is there.
    const wrong = url.replace(/\/[0-9a-f]{32}\//, "/" + "0".repeat(32) + "/");
    expect((await fetchUrl(wrong)).status).to.equal(404);
  });

  it("forbids scripts in its pages", async () => {
    const url = await server.publish("<p/>");
    const path = new URL(url).pathname;
    const response = await server.handle("GET", path);
    expect(response.headers["Content-Security-Policy"]).to.include(
      "default-src 'none'",
    );
    expect(response.headers["Content-Security-Policy"]).to.not.include(
      "script-src",
    );
  });

  it("hands link targets to the extension and answers 204", async () => {
    const url = await server.publish("<p/>");
    // Links are relative to the page, so they also work behind a proxy.
    const link = new URL(
      ViewerServer.linkTo("sasClinicalWorkspace:/probe-jobs/probe.log"),
      url,
    );
    expect((await fetchUrl(link.toString())).status).to.equal(204);
    expect(opened).to.deep.equal([
      "sasClinicalWorkspace:/probe-jobs/probe.log",
    ]);

    // Targets the extension refuses, and links without a target.
    const refused = new URL(ViewerServer.linkTo("file:///etc/passwd"), url);
    expect((await fetchUrl(refused.toString())).status).to.equal(400);
    const empty = new URL("../open", url);
    expect((await fetchUrl(empty.toString())).status).to.equal(400);
  });

  it("keeps only the newest pages and answers only GET and HEAD", async () => {
    const first = new URL(await server.publish("1")).pathname;
    await server.publish("2");
    await server.publish("3");
    expect((await server.handle("GET", first)).status).to.equal(404);
    expect((await server.handle("POST", first)).status).to.equal(405);
  });
});
