// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Background jobs (#150): the pure helpers, the JobsModel requests and the
// DefinitionStore's reuse / update / collision logic. The fixtures are
// responses recorded from a live SAS Viya server on 2026-11-18 (host and user
// names replaced).
import type { AxiosRequestConfig } from "axios";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import {
  DefinitionStore,
  type StateStore,
} from "../../src/backgroundJobs/DefinitionStore";
import {
  AlreadyFinishedError,
  JobNotFoundError,
  JobsModel,
  PreconditionFailedError,
} from "../../src/backgroundJobs/JobsModel";
import {
  asJobState,
  formatElapsed,
  humanizeState,
  isJobState,
  isTerminal,
  outcomeOf,
  stateIcon,
} from "../../src/backgroundJobs/state";
import type { ExecutionJob } from "../../src/backgroundJobs/types";
import {
  classifyResultKey,
  codeHash,
  fileIdOf,
  isDuration,
  isFileUri,
  jobDetails,
  jobFiles,
  jobNameFor,
  jobsFilter,
  languageTag,
  logFileOf,
  logJsonFileOf,
  nextName,
  resultFileOf,
} from "../../src/backgroundJobs/utils";
import type { RestConnection } from "../../src/viya/connection";

const FIXTURES = (() => {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return path.join(
    dir,
    "client",
    "test",
    "positron",
    "fixtures",
    "backgroundJobs",
  );
})();

const text = (name: string) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");
// JSON.parse returns `any`, which stands in for each fixture's type.
const json = (name: string) => JSON.parse(text(name));

const completedJob = (): ExecutionJob => json("job-completed.json");

// ------------------------------------------------------------------- state

describe("background job state", () => {
  const all = [
    "pending",
    "running",
    "completed",
    "failed",
    "canceled",
    "timedOut",
  ];

  it("treats only pending and running as active", () => {
    expect(all.filter((s) => !isTerminal(s))).to.deep.equal([
      "pending",
      "running",
    ]);
    expect(isTerminal(undefined)).to.equal(false);
  });

  it("maps each state to an outcome", () => {
    expect(all.map(outcomeOf)).to.deep.equal([
      "running",
      "running",
      "success",
      "error",
      "warning",
      "warning",
    ]);
  });

  it("has an icon and wording for every state", () => {
    for (const state of all) {
      expect(stateIcon(state)).to.be.a("string").and.not.equal("");
      expect(humanizeState(state)).to.not.equal("Unknown");
    }
    expect(humanizeState("timedOut")).to.equal("Timed out");
  });

  it("narrows server strings to known states", () => {
    expect(isJobState("completed")).to.equal(true);
    expect(isJobState("COMPLETED")).to.equal(false);
    expect(asJobState("bogus")).to.equal("pending");
    expect(asJobState("failed")).to.equal("failed");
  });

  it("formats run times", () => {
    expect(formatElapsed(7424)).to.equal("7s");
    expect(formatElapsed(247_000)).to.equal("4m 7s");
    expect(formatElapsed(3_720_000)).to.equal("1h 2m");
    expect(formatElapsed(undefined)).to.equal("");
  });
});

// ------------------------------------------------------------------- results

describe("background job results", () => {
  it("lists only Files service entries, and keeps the rest for details", () => {
    const job = completedJob();
    const files = jobFiles(job);
    // The recorded job: the log and the listing, each as JSON and as text.
    expect(files.map((f) => f.kind).sort()).to.deep.equal([
      "listing",
      "listingJson",
      "log",
      "logJson",
    ]);
    expect(files.every((f) => isFileUri(f.uri))).to.equal(true);
    expect(
      jobDetails(job)
        .map(([k]) => k)
        .sort(),
    ).to.deep.equal(["COMPUTE_CONTEXT", "COMPUTE_JOB", "COMPUTE_SESSION"]);
  });

  it("classifies the provider's result keys", () => {
    expect(classifyResultKey("B2BA8016-88C8.log.txt")).to.equal("log");
    expect(classifyResultKey("B2BA8016-88C8.log")).to.equal("logJson");
    expect(classifyResultKey("B2BA8016-88C8.listing.txt")).to.equal("listing");
    expect(classifyResultKey("B2BA8016-88C8.listing")).to.equal("listingJson");
    expect(classifyResultKey("#LN00007")).to.equal("other");
  });

  it("prefers the plain-text log, although logLocation is the JSON one", () => {
    const job = completedJob();
    expect(logFileOf(job)?.kind).to.equal("log");
    // logLocation points at the JSON log, which is what the structured
    // reader wants.
    const jsonLog = logJsonFileOf(job);
    expect(jsonLog?.kind).to.equal("logJson");
    expect(jsonLog?.uri).to.equal(job.logLocation);
  });

  it("falls back to logLocation when the results carry no log key", () => {
    const job: ExecutionJob = {
      id: "j",
      state: "completed",
      logLocation: "/files/files/abc",
    };
    expect(logJsonFileOf(job)?.id).to.equal("abc");
    expect(logFileOf(job)).to.equal(undefined);
  });

  it("opens the listing as the results, since jobs give no ODS HTML", () => {
    expect(resultFileOf(completedJob())?.kind).to.equal("listing");
  });

  it("prefers an HTML result if a deployment ever produces one", () => {
    const job: ExecutionJob = {
      id: "j",
      state: "completed",
      results: {
        "X.listing.txt": "/files/files/1",
        "sashtml.htm": "/files/files/2",
      },
    };
    expect(resultFileOf(job)?.key).to.equal("sashtml.htm");
  });

  it("parses file ids", () => {
    expect(fileIdOf("/files/files/2d111979")).to.equal("2d111979");
    expect(isFileUri("/files/files/x")).to.equal(true);
    expect(isFileUri("SAS Job Execution compute context")).to.equal(false);
    expect(isFileUri(undefined)).to.equal(false);
  });
});

// ------------------------------------------------------------------- naming etc.

describe("background job helpers", () => {
  it("names jobs after the file", () => {
    expect(jobNameFor({ fileName: "/home/u/adsl.sas" })).to.equal("adsl");
    expect(jobNameFor({ fileName: "C:\\work\\adae.sas" })).to.equal("adae");
    expect(jobNameFor({ fileName: "/a/b.sas", selection: true })).to.equal(
      "b (selection)",
    );
    expect(jobNameFor({ fileName: "Untitled-1", untitled: true })).to.equal(
      "Untitled",
    );
    expect(
      jobNameFor({ fileName: `/x/${"a".repeat(300)}.sas` }),
    ).to.have.length(100);
  });

  it("picks a free name when the folder already holds one", () => {
    expect(nextName("adsl", new Set())).to.equal("adsl");
    expect(nextName("adsl", new Set(["adsl"]))).to.equal("adsl (2)");
    expect(nextName("adsl", new Set(["adsl", "adsl (2)"]))).to.equal(
      "adsl (3)",
    );
  });

  it("filters the job list to this client and user", () => {
    expect(jobsFilter()).to.equal("eq(submittedByApplication,'positron-sas')");
    expect(jobsFilter("u1")).to.equal(
      "and(eq(submittedByApplication,'positron-sas'),eq(createdBy,'u1'))",
    );
  });

  it("hashes code stably and by name and content", () => {
    expect(codeHash("a", "x")).to.equal(codeHash("a", "x"));
    expect(codeHash("a", "x")).to.not.equal(codeHash("a", "y"));
    expect(codeHash("a", "x")).to.not.equal(codeHash("b", "x"));
  });

  it("validates ISO-8601 durations", () => {
    for (const ok of ["P7D", "PT1H", "P1DT12H", "P2W", "PT30M"]) {
      expect(isDuration(ok), ok).to.equal(true);
    }
    for (const bad of ["P", "PT", "7D", "P1H", "1 day", ""]) {
      expect(isDuration(bad), bad).to.equal(false);
    }
  });

  it("maps editor languages to tags SAS accepts", () => {
    expect(languageTag(undefined)).to.equal("en-US");
    expect(languageTag("pt-br")).to.equal("pt-BR");
    expect(languageTag("de")).to.equal("de");
    expect(languageTag("zh-cn")).to.equal("zh-CN");
  });
});

// ------------------------------------------------------------------- the REST client

interface Call {
  method: string;
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: string;
}

interface Reply {
  status?: number;
  data?: unknown;
  headers?: Record<string, string>;
}

type Route = [method: string, prefix: string, reply: Reply | (() => Reply)];

/** The request headers as plain strings, for assertions. */
function stringHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

/** A recorder standing in for an axios instance, with headers and errors. */
function fakeConnection() {
  const calls: Call[] = [];
  let routes: Route[] = [];
  const respond = (
    method: string,
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ) => {
    calls.push({
      method,
      url,
      data,
      headers: stringHeaders(config?.headers),
      responseType:
        typeof config?.responseType === "string"
          ? config.responseType
          : undefined,
    });
    const index = routes.findIndex(
      ([m, prefix]) => m === method && url.startsWith(prefix),
    );
    if (index < 0) {
      return Promise.reject(new Error(`No route for ${method} ${url}`));
    }
    const route = routes[index][2];
    const reply = typeof route === "function" ? route() : route;
    const status = reply.status ?? 200;
    if (status >= 400) {
      return Promise.reject({ response: { status, data: reply.data } });
    }
    return Promise.resolve({
      data: JSON.parse(JSON.stringify(reply.data ?? {})),
      headers: reply.headers ?? {},
    });
  };
  const connection: RestConnection = {
    get: (url, config) => respond("GET", url, undefined, config),
    post: (url, data, config) => respond("POST", url, data, config),
    put: (url, data, config) => respond("PUT", url, data, config),
    patch: (url, data, config) => respond("PATCH", url, data, config),
    delete: (url, config) => respond("DELETE", url, undefined, config),
  };
  return {
    calls,
    connection,
    /** Routes are matched in order; put the most specific first. */
    route(...more: Route[]) {
      routes = [...routes, ...more];
    },
    reset() {
      calls.length = 0;
      routes = [];
    },
  };
}

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("background JobsModel", () => {
  const fake = fakeConnection();
  const model = new JobsModel(
    {
      getConnection: async () => fake.connection,
      getCurrentUserId: async () => "user1",
    },
    "de-CH",
  );

  beforeEach(() => fake.reset());

  it("submits by definition reference, with the language and the submitter", async () => {
    fake.route([
      "POST",
      "/jobExecution/jobs",
      { data: json("job-created.json") },
    ]);
    const job = await model.submit({
      name: "adsl",
      description: "from Positron",
      definitionUri: "/jobDefinitions/definitions/d1",
      contextName: "SAS Job Execution compute context",
      expiresAfter: "P7D",
    });
    expect(job.state).to.equal("running");
    const [call] = fake.calls;
    expect(call.url).to.equal("/jobExecution/jobs?submitter=positron-sas");
    expect(call.headers).to.deep.equal({
      // Without it every job fails with Compute error 5023.
      "Accept-Language": "de-CH",
      "Content-Type": "application/vnd.sas.job.execution.job.request+json",
      Accept: "application/vnd.sas.job.execution.job+json",
    });
    expect(call.data).to.deep.equal({
      version: 3,
      name: "adsl",
      description: "from Positron",
      jobDefinitionUri: "/jobDefinitions/definitions/d1",
      arguments: { _contextName: "SAS Job Execution compute context" },
      expiresAfter: "P7D",
    });
  });

  it("sends the definition inline when none could be stored", async () => {
    fake.route(["POST", "/jobExecution/jobs", { data: { id: "j" } }]);
    await model.submit({
      name: "adsl",
      definition: { name: "adsl", type: "Compute", code: "proc print; run;" },
      contextName: "ctx",
      extraArguments: { _queue: "batch" },
    });
    const body = fake.calls[0].data;
    expect(body).to.have.property("jobDefinition");
    expect(body).to.not.have.property("jobDefinitionUri");
    expect(body).to.not.have.property("expiresAfter");
    expect(body)
      .to.have.property("arguments")
      .that.deep.equals({ _contextName: "ctx", _queue: "batch" });
  });

  it("reads the state as text, which is all the endpoint serves", async () => {
    fake.route(["GET", "/jobExecution/jobs/j1/state", { data: "completed\n" }]);
    expect(await model.getState("j1")).to.equal("completed");
    expect(fake.calls[0].headers?.Accept).to.equal("text/plain");
    expect(fake.calls[0].responseType).to.equal("text");
  });

  it("reports a job that is gone", async () => {
    fake.route(["GET", "/jobExecution/jobs/gone", { status: 404 }]);
    expect(await rejection(model.getState("gone"))).to.be.instanceOf(
      JobNotFoundError,
    );
    expect(await rejection(model.getJob("gone"))).to.be.instanceOf(
      JobNotFoundError,
    );
  });

  it("cancels, and treats a late cancel (405) as already finished", async () => {
    fake.route(["PUT", "/jobExecution/jobs/j1/state", { data: "" }]);
    await model.cancel("j1");
    expect(fake.calls[0].url).to.equal(
      "/jobExecution/jobs/j1/state?value=canceled",
    );
    // A body-less PUT gets axios' default Content-Type, which the live
    // server refuses with 415.
    expect(fake.calls[0].data).to.equal("canceled");
    expect(fake.calls[0].headers?.["Content-Type"]).to.equal("text/plain");

    fake.reset();
    const recorded = json("cancel-again-405.json");
    fake.route(["PUT", "/jobExecution/jobs/j1/state", recorded]);
    expect(await rejection(model.cancel("j1"))).to.be.instanceOf(
      AlreadyFinishedError,
    );
  });

  it("creates a definition in a folder and returns its ETag", async () => {
    fake.route([
      "POST",
      "/jobDefinitions/definitions",
      {
        status: 201,
        data: json("definition-created.json"),
        headers: { etag: 'W/"1795020739005000000"' },
      },
    ]);
    const { definition, etag } = await model.createDefinition(
      { name: "adsl", type: "Compute", code: "x" },
      "/folders/folders/f1",
    );
    expect(definition.id).to.be.a("string");
    expect(etag).to.equal('W/"1795020739005000000"');
    expect(fake.calls[0].url).to.equal(
      "/jobDefinitions/definitions?parentFolderUri=%2Ffolders%2Ffolders%2Ff1",
    );
    expect(fake.calls[0].data).to.include({ version: 2, type: "Compute" });
  });

  it("updates with the id in the body and an If-Match header", async () => {
    fake.route([
      "PUT",
      "/jobDefinitions/definitions/d1",
      { data: { id: "d1" } },
    ]);
    await model.updateDefinition(
      "d1",
      { name: "adsl", type: "Compute", code: "y" },
      'W/"1"',
    );
    const [call] = fake.calls;
    // Without the id the service answers 400 "IDs do not match on update".
    expect(call.data).to.include({ id: "d1", version: 2, code: "y" });
    expect(call.headers?.["If-Match"]).to.equal('W/"1"');
  });

  it("turns a stale ETag (412) into PreconditionFailedError", async () => {
    fake.route([
      "PUT",
      "/jobDefinitions/definitions/d1",
      json("definition-put-412.json"),
    ]);
    expect(
      await rejection(
        model.updateDefinition("d1", { name: "a", type: "Compute" }, '"x"'),
      ),
    ).to.be.instanceOf(PreconditionFailedError);
  });

  it("lists this client's jobs newest first, and pages", async () => {
    const page = json("jobs-page.json");
    fake.route(["GET", "/jobExecution/jobs?", { data: page }]);
    const result = await model.listJobs(0, 5);
    expect(result.items.length).to.equal(page.items.length);
    expect(
      result.items.every(
        (j: ExecutionJob) => j.submittedByApplication === "positron-sas",
      ),
    ).to.equal(true);
    const url = decodeURIComponent(fake.calls[0].url);
    expect(url).to.contain("start=0&limit=5");
    expect(url).to.contain("sortBy=creationTimeStamp:descending");
    expect(url).to.contain(
      "filter=and(eq(submittedByApplication,'positron-sas'),eq(createdBy,'user1'))",
    );
    expect(result.hasMore).to.equal(
      (page.links ?? []).some((l: { rel: string }) => l.rel === "next"),
    );
  });

  it("reads the structured log as compute log lines", async () => {
    fake.route([
      "GET",
      "/files/files/log1/content",
      { data: json("log.json") },
    ]);
    const lines = await model.getLogLines("log1");
    expect(lines.length).to.be.greaterThan(0);
    expect(lines[0]).to.deep.include({ type: "source" });
    expect(lines.some((l) => l.type === "note")).to.equal(true);
  });
});

// ------------------------------------------------------------------- DefinitionStore

describe("DefinitionStore", () => {
  const ENDPOINT = "https://viya.example.com";
  const DOC = "file:///work/adsl.sas";

  const fake = fakeConnection();
  const model = new JobsModel(
    {
      getConnection: async () => fake.connection,
      getCurrentUserId: async () => "user1",
    },
    "en-US",
  );

  let memento: Record<string, unknown>;
  const store: StateStore = {
    get: <T>(key: string): T | undefined => {
      const value: unknown = memento[key];
      // Round-trip like a real Memento, so callers can't mutate stored state.
      return value === undefined
        ? undefined
        : JSON.parse(JSON.stringify(value));
    },
    update: async (key, value) => {
      memento[key] = value;
    },
  };

  const folderRoutes = (memberNames: string[] = []): Route[] => [
    ["GET", "/folders/folders/@myFolder", { data: { id: "my" } }],
    [
      "GET",
      "/folders/folders/my/members",
      {
        data: {
          items: [{ name: "Positron Jobs", uri: "/folders/folders/pj" }],
        },
      },
    ],
    [
      "GET",
      "/folders/folders/pj/members",
      {
        data: {
          items: memberNames.map((name) => ({
            name,
            uri: `/jobDefinitions/definitions/${name}`,
          })),
        },
      },
    ],
  ];

  const created = (id: string): Route => [
    "POST",
    "/jobDefinitions/definitions",
    { status: 201, data: { id, name: "adsl" }, headers: { etag: '"e1"' } },
  ];

  const methods = () => fake.calls.map((c) => `${c.method} ${c.url}`);

  beforeEach(() => {
    fake.reset();
    memento = {};
  });

  it("creates a definition in the Positron Jobs folder the first time", async () => {
    fake.route(...folderRoutes(), created("d1"));
    const definitions = new DefinitionStore(model, store);
    const result = await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "proc print; run;",
    });
    expect(result).to.deep.equal({
      uri: "/jobDefinitions/definitions/d1",
      id: "d1",
      action: "created",
    });
    const post = fake.calls.find((c) => c.method === "POST");
    expect(post?.url).to.contain("parentFolderUri=%2Ffolders%2Ffolders%2Fpj");
    // Stamped so clean-up can tell generated definitions from saved ones.
    expect(post?.data).to.have.deep.property("properties", [
      { name: "createdByPositron", value: "true" },
      { name: "positronSource", value: DOC },
    ]);
  });

  it("reuses an unchanged definition without writing anything", async () => {
    fake.route(...folderRoutes(), created("d1"));
    const definitions = new DefinitionStore(model, store);
    const options = {
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "proc print; run;",
    };
    await definitions.ensure(options);

    fake.reset();
    fake.route([
      "GET",
      "/jobDefinitions/definitions/d1",
      {
        data: { id: "d1", name: "adsl", type: "Compute" },
        headers: { etag: '"e1"' },
      },
    ]);
    const again = await definitions.ensure(options);
    expect(again.action).to.equal("reused");
    expect(methods()).to.deep.equal(["GET /jobDefinitions/definitions/d1"]);
  });

  it("updates in place when the code changed, sending only owned fields", async () => {
    fake.route(...folderRoutes(), created("d1"));
    const definitions = new DefinitionStore(model, store);
    await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v1",
    });

    fake.reset();
    fake.route(
      [
        "GET",
        "/jobDefinitions/definitions/d1",
        {
          data: {
            id: "d1",
            name: "adsl",
            type: "Compute",
            code: "v1",
            links: [{ rel: "self", href: "/x" }],
            creationTimeStamp: "2026-11-18T00:00:00Z",
          },
          headers: { etag: '"e2"' },
        },
      ],
      [
        "PUT",
        "/jobDefinitions/definitions/d1",
        { data: { id: "d1" }, headers: { etag: '"e3"' } },
      ],
    );
    const result = await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v2",
    });
    expect(result.action).to.equal("updated");
    const put = fake.calls.find((c) => c.method === "PUT");
    expect(put?.headers?.["If-Match"]).to.equal('"e2"');
    expect(put?.data).to.include({ id: "d1", code: "v2" });
    expect(put?.data).to.not.have.property("links");
    expect(put?.data).to.not.have.property("creationTimeStamp");
  });

  it("retries once after a stale ETag", async () => {
    fake.route(...folderRoutes(), created("d1"));
    const definitions = new DefinitionStore(model, store);
    await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v1",
    });

    fake.reset();
    let puts = 0;
    fake.route(
      [
        "GET",
        "/jobDefinitions/definitions/d1",
        {
          data: { id: "d1", name: "adsl", type: "Compute" },
          headers: { etag: '"e2"' },
        },
      ],
      [
        "PUT",
        "/jobDefinitions/definitions/d1",
        () => (++puts === 1 ? { status: 412 } : { data: { id: "d1" } }),
      ],
    );
    const result = await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v2",
    });
    expect(result.action).to.equal("updated");
    expect(puts).to.equal(2);
  });

  it("recreates a definition that was deleted on the server", async () => {
    fake.route(...folderRoutes(), created("d1"));
    const definitions = new DefinitionStore(model, store);
    await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v1",
    });

    fake.reset();
    fake.route(
      ["GET", "/jobDefinitions/definitions/d1", { status: 404 }],
      ...folderRoutes(),
      created("d2"),
    );
    const result = await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "v1",
    });
    expect(result).to.include({ id: "d2", action: "created" });
  });

  it("avoids a name already used in the folder", async () => {
    fake.route(...folderRoutes(["adsl", "adsl (2)"]), created("d1"));
    const definitions = new DefinitionStore(model, store);
    await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "x",
    });
    const post = fake.calls.find((c) => c.method === "POST");
    // The service refuses a duplicate name with 400 "Failed to add member".
    expect(post?.data).to.include({ name: "adsl (3)" });
  });

  it("creates the Positron Jobs folder when My Folder has none", async () => {
    fake.route(
      ["GET", "/folders/folders/@myFolder", { data: { id: "my" } }],
      ["GET", "/folders/folders/my/members", { data: { items: [] } }],
      ["POST", "/folders/folders?", { status: 201, data: { id: "new" } }],
      ["GET", "/folders/folders/new/members", { data: { items: [] } }],
      created("d1"),
    );
    const definitions = new DefinitionStore(model, store);
    await definitions.ensure({
      endpoint: ENDPOINT,
      documentUri: DOC,
      name: "adsl",
      code: "x",
    });
    const folderPost = fake.calls.find(
      (c) => c.method === "POST" && c.url.startsWith("/folders/folders?"),
    );
    expect(folderPost?.data).to.deep.equal({
      name: "Positron Jobs",
      type: "folder",
    });
  });
});
