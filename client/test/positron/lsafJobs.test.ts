// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  JobsModel,
  isTerminal,
  parseParameter,
  resourceArea,
  runOutcome,
} from "../../src/lsaf/JobsModel";
import { LsafClient } from "../../src/lsaf/LsafClient";
import { RepositoryModel } from "../../src/lsaf/RepositoryModel";
import { WorkspaceModel } from "../../src/lsaf/WorkspaceModel";
import { JobOutputs, findOutputPaths } from "../../src/lsaf/jobOutputs";
import { MementoLike, RunStore, TrackedRun } from "../../src/lsaf/runStore";
import { axiosTransport } from "../../src/lsaf/transport";
import { LsafMockServer } from "../lsaf-mock/server";
import { shown } from "./lsafMenus.test";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function memento(): MementoLike {
  // Stored as JSON, as VS Code stores global state.
  const data = new Map<string, string>();
  return {
    get: <T>(key: string): T | undefined => {
      const json = data.get(key);
      return json === undefined ? undefined : JSON.parse(json);
    },
    update: async (key: string, value: unknown) => {
      data.set(key, JSON.stringify(value));
    },
  };
}

const run = (id: string, extra: Partial<TrackedRun> = {}): TrackedRun => ({
  id,
  area: "workspace",
  jobPath: "/Org/S/jobs/report.job",
  submittedAt: `2026-11-19T10:00:0${id}.000Z`,
  outcome: "running",
  ...extra,
});

describe("LSAF job outcomes", () => {
  it("reads the documented state and lenient alternatives", () => {
    // The spec's example.
    expect(
      runOutcome({
        state: "completed",
        message: "Job completed successfully.",
        completedTimestamp: "2022-07-15T19:57:04.000Z",
      }),
    ).to.equal("succeeded");
    expect(runOutcome({ state: "COMPLETED" })).to.equal("succeeded");
    expect(
      runOutcome({
        state: "completed",
        message: "Job completed with warnings.",
      }),
    ).to.equal("warnings");
    expect(
      runOutcome({ state: "completed", message: "Job completed with errors." }),
    ).to.equal("failed");
    expect(runOutcome({ state: "FAILED" })).to.equal("failed");
    expect(runOutcome({ state: "cancelled" })).to.equal("canceled");
    expect(runOutcome({ state: "running" })).to.equal("running");
    expect(runOutcome({ state: "QUEUED" })).to.equal("running");
    expect(
      runOutcome({ state: "SOMETHING_NEW", completedTimestamp: "2026-01-01" }),
    ).to.equal("finished");
    expect(isTerminal({ state: "started" })).to.equal(false);
    expect(isTerminal({ state: "completed" })).to.equal(true);
  });

  it("reads where a resource lives", () => {
    expect(
      resourceArea({ schemaType: "repository", path: "/a" }, "workspace"),
    ).to.equal("repository");
    expect(
      resourceArea({ schemaType: "workspace", path: "/a" }, "repository"),
    ).to.equal("workspace");
    expect(
      resourceArea({ schemaType: "file", path: "/a" }, "workspace"),
    ).to.equal("workspace");
  });

  it("parses typed parameter values", () => {
    expect(parseParameter("numParm=10")).to.deep.equal(["numParm", "10"]);
    expect(
      parseParameter(" fileParm = /folder/file.txt?version=2.0 "),
    ).to.deep.equal(["fileParm", "/folder/file.txt?version=2.0"]);
    expect(parseParameter("empty=")).to.deep.equal(["empty", ""]);
    expect(parseParameter("a=b=c")).to.deep.equal(["a", "b=c"]);
    expect(parseParameter("1bad=x")).to.equal(undefined);
    expect(parseParameter("novalue")).to.equal(undefined);
  });
});

describe("LSAF run store", () => {
  it("keeps runs newest first and updates them", async () => {
    const store = new RunStore(memento(), "k");
    await store.add(run("1"));
    await store.add(run("2"));
    expect(store.list().map((r) => r.id)).to.deep.equal(["2", "1"]);
    await store.update("1", { outcome: "succeeded", state: "completed" });
    expect(store.get("1")?.outcome).to.equal("succeeded");
    await store.removeFinished();
    expect(store.list().map((r) => r.id)).to.deep.equal(["2"]);
    await store.remove(["2"]);
    expect(store.list()).to.deep.equal([]);
  });

  it("forgets the oldest runs beyond its limit", async () => {
    const store = new RunStore(memento(), "k");
    for (let i = 0; i < 205; i++) {
      await store.add(
        run(String(i), {
          submittedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }),
      );
    }
    expect(store.list()).to.have.length(200);
    expect(store.get("0")).to.equal(undefined);
    expect(store.get("204")).to.not.equal(undefined);
  });
});

describe("LSAF manifest outputs", () => {
  it("finds logs and listings in an XML manifest", () => {
    // The mock server's guess at a manifest; the real format is undocumented.
    const xml = `<?xml version="1.0"?>
<manifest>
  <job path="/Org/S/jobs/report.job"/>
  <outputs>
    <file path="/Org/S/jobs/report.log" type="log"/>
    <file path="report.lst"/>
    <file path="/Org/S/jobs/report.log"/>
    <file path="./logs/a&amp;b.log?version=1.0"/>
  </outputs>
</manifest>`;
    expect(findOutputPaths(xml, "/Org/S/jobs")).to.deep.equal({
      logs: ["/Org/S/jobs/report.log", "/Org/S/jobs/logs/a&b.log"],
      listings: ["/Org/S/jobs/report.lst"],
    });
  });

  it("finds them in JSON with escaped slashes too", () => {
    const json = JSON.stringify({
      outputs: [{ path: "..\\/out\\/x.log" }, { path: "../out/y.LST" }],
    }).replace(/\\\\/g, "\\");
    expect(findOutputPaths(json, "/a/jobs")).to.deep.equal({
      logs: ["/a/out/x.log"],
      listings: ["/a/out/y.LST"],
    });
    expect(findOutputPaths("no outputs", "/a")).to.deep.equal({
      logs: [],
      listings: [],
    });
  });
});

describe("LSAF job menus", () => {
  const jobsMenu = (value: string) =>
    shown("view/item/context", "lsafjobsprovider", value);

  it("offers the manifest only for finished runs", () => {
    const running = jobsMenu(";run;running;");
    expect(running).to.include.members([
      "SAS.lsaf.jobs.openLog@inline",
      "SAS.lsaf.jobs.openJob",
      "SAS.lsaf.jobs.runAgain",
      "SAS.lsaf.jobs.remove",
    ]);
    expect(running).to.not.include("SAS.lsaf.jobs.openManifest");
    expect(jobsMenu(";run;finished;")).to.include("SAS.lsaf.jobs.openManifest");
    expect(jobsMenu(";runFile;log;")).to.deep.equal([]);
  });

  it("runs programs and jobs from the views", () => {
    const ws = (value: string) =>
      shown("view/item/context", "lsafworkspaceprovider", value);
    expect(ws(";ws;file;sas;notInRepository;")).to.include(
      "SAS.lsaf.runProgram",
    );
    expect(ws(";ws;file;job;notInRepository;")).to.include.members([
      "SAS.lsaf.runJob",
      "SAS.lsaf.runJobWithParameters",
    ]);
    expect(ws(";ws;file;job;notInRepository;")).to.not.include(
      "SAS.lsaf.runProgram",
    );
    expect(
      shown(
        "view/item/context",
        "lsafrepositoryprovider",
        ";repo;file;notCheckedOut;job;",
      ),
    ).to.include("SAS.lsaf.runJob");
  });
});

describe("LSAF jobs against the mock server", function () {
  this.timeout(10_000);
  let mock: LsafMockServer;
  let jobs: JobsModel;
  let outputs: JobOutputs;

  beforeEach(async () => {
    mock = new LsafMockServer({ jobDurationMs: 50 });
    const apiUrl = await mock.start();
    const client = new LsafClient(apiUrl, axiosTransport(apiUrl), {
      userId: "demo",
      secret: "demo",
    });
    await client.logon();
    jobs = new JobsModel(() => client);
    outputs = new JobOutputs(
      jobs,
      new RepositoryModel(() => client),
      new WorkspaceModel(() => client),
    );
  });

  afterEach(() => mock.stop());

  const last = () => mock.requests[mock.requests.length - 1];

  it("creates a job for a program with a JSON array of relative paths", async () => {
    await jobs.createJob("workspace", "/Org/Study1/scratch/test.job", [
      "./test.sas",
    ]);
    const request = last();
    expect(request.method).to.equal("POST");
    expect(request.path).to.equal(
      "/lsaf/api/jobs/workspace/Org/Study1/scratch/test.job",
    );
    expect(request.query).to.deep.include({
      createParents: "false",
      useRelativePaths: "true",
    });
    expect(String(request.headers["content-type"])).to.match(
      /^application\/json/,
    );
    expect(JSON.parse(text(request.body))).to.deep.equal(["./test.sas"]);
    try {
      await jobs.createJob("workspace", "/Org/Study1/scratch/test.job", []);
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.have.property("status", 409);
    }
  });

  it("submits without a body, or with parameter overrides", async () => {
    await jobs.createJob("workspace", "/Org/Study1/scratch/test.job", [
      "./test.sas",
    ]);
    const id = await jobs.submit("workspace", "/Org/Study1/scratch/test.job");
    expect(id).to.be.a("string");
    expect(last().method).to.equal("PUT");
    expect(last().query).to.deep.include({ action: "run" });
    expect(last().body.length).to.equal(0);
    await jobs.submit("repository", "/Org/Study1/jobs/report.job", {
      numParm: "10",
    });
    expect(last().path).to.equal(
      "/lsaf/api/jobs/repository/Org/Study1/jobs/report.job",
    );
    expect(JSON.parse(text(last().body))).to.deep.equal({ numParm: "10" });
  });

  it("follows a run to its manifest, log and listing", async () => {
    const id = await jobs.submit("repository", "/Org/Study1/jobs/report.job");
    expect(isTerminal(await jobs.getSubmission(id))).to.equal(false);
    await sleep(150);
    const submission = await jobs.getSubmission(id);
    expect(runOutcome(submission)).to.equal("succeeded");
    const found = await outputs.find(
      run(id, {
        area: "repository",
        jobPath: "/Org/Study1/jobs/report.job",
        submittedAt: submission.submittedTimestamp ?? "",
      }),
    );
    expect(found.map((f) => [f.kind, f.area, f.path])).to.deep.equal([
      ["manifest", "repository", "/Org/Study1/jobs/report.mnf"],
      ["log", "repository", "/Org/Study1/jobs/report.log"],
      ["listing", "repository", "/Org/Study1/jobs/report.lst"],
    ]);
    expect(text(await outputs.read("repository", found[1].path))).to.match(
      /Fake LSAF job/,
    );
  });

  it("falls back to recent logs in the job's folder", async () => {
    const jobPath = "/Org/Study1/scratch/test.job";
    await jobs.createJob("workspace", jobPath, ["./test.sas"]);
    const id = await jobs.submit("workspace", jobPath);
    await sleep(150);
    // A manifest that names no log, as a real one might.
    mock.addWsFile("/Org/Study1/scratch/test.mnf", "<manifest/>");
    mock.addWsFile("/Org/Study1/scratch/other.log", "x");
    const found = await outputs.find(
      run(id, { jobPath, submittedAt: new Date().toISOString() }),
    );
    const logs = found.filter((f) => f.kind === "log").map((f) => f.path);
    expect(logs[0]).to.equal("/Org/Study1/scratch/test.log");
    expect(logs).to.include("/Org/Study1/scratch/other.log");
  });
});
