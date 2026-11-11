// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Clinical jobs: the pure helpers and the JobsModel requests. The fixtures are
// responses recorded from a live SAS Viya server (user names replaced).
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import {
  ActionCancelledError,
  ActionTimeoutError,
  pollUntil,
} from "../../src/clinical/actionStatus";
import {
  type JobsConnection,
  JobsModel,
} from "../../src/clinical/jobs/JobsModel";
import {
  type ReportLabels,
  renderManifestReport,
} from "../../src/clinical/jobs/manifestReport";
import {
  describeValue,
  manifestNodes,
} from "../../src/clinical/jobs/manifestTree";
import {
  buildParameterValue,
  defaultPath,
  defaultText,
  validateParameterText,
  valuesForRerun,
} from "../../src/clinical/jobs/parameterValues";
import {
  executionIcon,
  humanizeState,
  isTerminal,
  outcomeOf,
  stateIcon,
} from "../../src/clinical/jobs/state";
import type {
  JobParameter,
  Manifest,
  RawSubmission,
} from "../../src/clinical/jobs/types";
import {
  jobPathForProgram,
  manifestSubmissionId,
  normalizeSubmission,
  parentPath,
  parseJobFile,
  programJob,
  resolveJobPath,
  resourceFromPath,
  runsOnlyProgram,
  submittedByFilter,
  toRunInfo,
} from "../../src/clinical/jobs/utils";

// Found from the repository root: this file also runs compiled, from
// client/out/test/positron (VS Code host tests), where there are no fixtures.
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
    "clinicalJobs",
  );
})();
const fixture = (name: string) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");
const json = <T>(name: string): T => JSON.parse(fixture(name));
const noSleep = () => Promise.resolve();
const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("clinical job states", () => {
  it("treats every COMPLETED state as final", () => {
    expect(isTerminal("COMPLETED_CANCELED")).to.equal(true);
    expect(isTerminal("COMPLETED_PROGRAM_WARNINGS_CHECKIN_ERROR")).to.equal(
      true,
    );
    for (const state of [
      "NOT_STARTED",
      "STARTED",
      "RUNNING_TASKS",
      "CANCELING",
      "POST_EXECUTION_PUBLISHING",
      undefined,
    ]) {
      expect(isTerminal(state), String(state)).to.equal(false);
    }
  });

  it("maps states to outcomes and icons", () => {
    expect(outcomeOf("RUNNING_TASKS")).to.equal("running");
    expect(outcomeOf("COMPLETED_SUCCESSFUL")).to.equal("success");
    expect(outcomeOf("COMPLETED_PROGRAM_WARNINGS")).to.equal("warning");
    expect(outcomeOf("COMPLETED_CANCELED")).to.equal("canceled");
    // A check-in error is an error even when the programs ran cleanly.
    expect(outcomeOf("COMPLETED_CHECKIN_ERROR")).to.equal("error");
    expect(outcomeOf("COMPLETED_PROGRAM_WARNINGS_CHECKIN_ERROR")).to.equal(
      "error",
    );
    expect(outcomeOf("COMPLETED_FAILED")).to.equal("error");
    expect(stateIcon("STARTED")).to.equal("loading~spin");
    expect(stateIcon("COMPLETED_SUCCESSFUL")).to.equal("pass");
    expect(executionIcon("CANCELED")).to.equal("circle-slash");
    expect(executionIcon("ERRORS")).to.equal("error");
    expect(executionIcon(undefined)).to.equal("circle-outline");
    expect(humanizeState("COMPLETED_PROGRAM_WARNINGS")).to.equal(
      "Completed program warnings",
    );
  });
});

describe("clinical job paths", () => {
  it("resolves relative paths against the job's folder", () => {
    expect(resolveJobPath("/probe-jobs", "./probe.sas")).to.equal(
      "/probe-jobs/probe.sas",
    );
    expect(resolveJobPath("/a/jobs/", "../programs/t.sas")).to.equal(
      "/a/programs/t.sas",
    );
    expect(resolveJobPath("/a", "/abs/x.sas")).to.equal("/abs/x.sas");
    expect(resolveJobPath("/a", "./")).to.equal("/a");
  });

  it("splits paths into folder and name", () => {
    expect(parentPath("/a/b/c.cjob")).to.equal("/a/b");
    expect(parentPath("/c.cjob")).to.equal("/");
    expect(resourceFromPath("/a/b.cjob", "WORKSPACE")).to.deep.equal({
      name: "b.cjob",
      path: "/a/b.cjob",
      location: "/a",
      resourceLocation: "WORKSPACE",
    });
  });
});

describe("normalizeSubmission", () => {
  it("reads the flat fields the live service sends", () => {
    const page = json<{ items: RawSubmission[] }>("submissions.json");
    const repo = normalizeSubmission(page.items[0]);
    expect(repo.state).to.equal("COMPLETED_CHECKIN_ERROR");
    expect(repo.job).to.deep.equal({
      name: "t.cjob",
      path: "/viyar_live_tests/probe_185156/t.cjob",
      location: "/viyar_live_tests/probe_185156",
      resourceLocation: "REPOSITORY",
      id: "3077c913-36a3-40c3-80c7-1fd64f02f2e1",
      fileVersion: "-",
    });
    expect(repo.manifest?.path).to.equal(
      "/viyar_live_tests/probe_185156/t.cmnf",
    );
    expect(repo.manifest?.resourceLocation).to.equal("REPOSITORY");
    expect(repo).not.to.have.property("jobPath");

    const ws = normalizeSubmission(page.items[1]);
    expect(ws.job.resourceLocation).to.equal("WORKSPACE");
    expect(ws.job).not.to.have.property("id");
  });

  it("reads the response to a run", () => {
    const run = normalizeSubmission(json("submit-response.json"));
    expect(run.state).to.equal("STARTED");
    expect(run.name).to.equal("probe.cjob");
    expect(run.job.path).to.equal("/probe-jobs/probe.cjob");
  });

  it("reads the nested job object of the spec", () => {
    const run = normalizeSubmission({
      id: "1",
      name: "Test.cjob",
      state: "RUNNING_TASKS",
      job: {
        name: "Test.cjob",
        path: "/demo/Test.cjob",
        location: "/demo",
        resourceLocation: "WORKSPACE",
      },
    });
    expect(run.job.location).to.equal("/demo");
    expect(run.job.resourceLocation).to.equal("WORKSPACE");
  });

  it("falls back to the summary state", () => {
    expect(
      normalizeSubmission({
        id: "1",
        jobPath: "/a/b.cjob",
        summaryState: "STARTED",
      }).state,
    ).to.equal("STARTED");
  });
});

describe("clinical job files", () => {
  it("parses a .cjob file and attaches its location", () => {
    const resource = resourceFromPath("/probe-jobs/probe.cjob", "WORKSPACE");
    const job = parseJobFile(fixture("probe.cjob"), resource);
    expect(job.resource).to.deep.equal(resource);
    expect(job.programs?.[0].path).to.equal("./probe.sas");
    expect(job.parameters?.[0]).to.include({
      name: "probe_char",
      type: "CHARACTER",
      defaultValue: "hello",
    });
    expect(job.logsLocation).to.equal("./");
  });

  it("rejects a file that is not a job", () => {
    const resource = resourceFromPath("/x.cjob", "WORKSPACE");
    expect(() => parseJobFile("not json", resource)).to.throw(/x\.cjob/);
    expect(() => parseJobFile("[]", resource)).to.throw(/x\.cjob/);
  });

  it("finds the run that wrote a .cmnf file", () => {
    expect(manifestSubmissionId(fixture("probe.cmnf"))).to.equal(
      "eba8e748-2de6-4ef0-b3f7-e83d32cb7055",
    );
    expect(manifestSubmissionId("{}")).to.equal(undefined);
    expect(manifestSubmissionId("nope")).to.equal(undefined);
  });

  it("builds a run request with only the fields the service accepts", () => {
    const resource = resourceFromPath("/r/t.cjob", "REPOSITORY", {
      id: "abc",
      fileVersion: "1.0",
    });
    expect(toRunInfo(resource)).to.deep.equal({
      job: {
        name: "t.cjob",
        path: "/r/t.cjob",
        location: "/r",
        resourceLocation: "REPOSITORY",
      },
    });
    const values = [{ name: "p", type: "CHARACTER" as const, value: "x" }];
    expect(toRunInfo(resource, values).parameterValues).to.deep.equal(values);
  });

  it("filters submissions by user", () => {
    expect(submittedByFilter("test1")).to.equal('eq(submittedBy,"test1")');
  });
});

describe("pollUntil", () => {
  it("returns the first answer that is done and reports every answer", async () => {
    const answers = ["STARTED", "RUNNING_TASKS", "COMPLETED_SUCCESSFUL"];
    const seen: string[] = [];
    const result = await pollUntil(async () => answers.shift()!, isTerminal, {
      sleep: noSleep,
      onUpdate: (s) => seen.push(s),
    });
    expect(result).to.equal("COMPLETED_SUCCESSFUL");
    expect(seen).to.deep.equal([
      "STARTED",
      "RUNNING_TASKS",
      "COMPLETED_SUCCESSFUL",
    ]);
  });

  it("stops when cancelled or out of time", async () => {
    let cancelled = false;
    const cancel = pollUntil(
      async () => {
        cancelled = true;
        return "RUNNING_TASKS";
      },
      isTerminal,
      { sleep: noSleep, isCancelled: () => cancelled },
    );
    expect(await rejection(cancel)).to.be.instanceOf(ActionCancelledError);

    const timeout = pollUntil(async () => "RUNNING_TASKS", isTerminal, {
      sleep: noSleep,
      intervalMs: 10,
      timeoutMs: 30,
    });
    expect(await rejection(timeout)).to.be.instanceOf(ActionTimeoutError);
  });
});

describe("JobsModel", () => {
  interface Call {
    method: string;
    url: string;
    data?: unknown;
    headers?: Record<string, string>;
  }
  let calls: Call[];
  let answers: Record<string, unknown>;
  /** Answers to successive GETs of a state, used before `answers`. */
  let states: string[];

  // JSON.parse returns `any`, which stands in for each call's response type.
  const answer = (method: string, url: string) => {
    if (method === "GET" && url.endsWith("/state") && states.length) {
      return JSON.parse(JSON.stringify(states.shift()));
    }
    const key = Object.keys(answers).find((k) =>
      `${method} ${url}`.startsWith(k),
    );
    return JSON.parse(JSON.stringify(key ? answers[key] : {}));
  };
  const record = (
    method: string,
    url: string,
    data?: unknown,
    config?: { headers?: Record<string, string> },
  ) => {
    calls.push({ method, url, data, headers: config?.headers });
    return Promise.resolve({ data: answer(method, url) });
  };
  const connection: JobsConnection = {
    get: (url, config) => record("GET", url, undefined, config),
    post: (url, data, config) => record("POST", url, data, config),
    put: (url, data, config) => record("PUT", url, data, config),
    patch: (url, data, config) => record("PATCH", url, data, config),
    delete: (url, config) => record("DELETE", url, undefined, config),
  };
  const contents: Record<string, string> = {};
  const model = new JobsModel(
    {
      getConnection: async () => connection,
      getCurrentUserId: async () => "test1",
    },
    { getContent: async (p) => new TextEncoder().encode(contents[p]) },
  );

  beforeEach(() => {
    calls = [];
    answers = {};
    states = [];
  });

  it("lists the user's submissions and knows whether more follow", async () => {
    answers["GET /clinicalJobs/submissions"] = {
      ...json<object>("submissions.json"),
      links: [{ rel: "next", href: "/clinicalJobs/submissions?start=25" }],
    };
    const page = await model.listSubmissions();
    expect(calls[0].url).to.equal(
      "/clinicalJobs/submissions?start=0&limit=25&filter=eq%28submittedBy%2C%22test1%22%29",
    );
    expect(calls[0].headers).to.deep.equal({ Accept: "application/json" });
    expect(page.items).to.have.length(2);
    expect(page.items[0].job.resourceLocation).to.equal("REPOSITORY");
    expect(page.hasMore).to.equal(true);
  });

  it("runs a job with ?action=RUN and only job and parameterValues", async () => {
    answers["POST /clinicalJobs/submissions"] = json("submit-response.json");
    const resource = resourceFromPath("/probe-jobs/probe.cjob", "WORKSPACE");
    const values = [
      { name: "probe_char", type: "CHARACTER" as const, value: "x" },
    ];
    const run = await model.submit(toRunInfo(resource, values));
    expect(calls[0]).to.deep.include({
      method: "POST",
      url: "/clinicalJobs/submissions?action=RUN",
      data: {
        job: {
          name: "probe.cjob",
          path: "/probe-jobs/probe.cjob",
          location: "/probe-jobs",
          resourceLocation: "WORKSPACE",
        },
        parameterValues: values,
      },
    });
    expect(calls[0].headers).to.deep.equal({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(run.id).to.equal("eba8e748-2de6-4ef0-b3f7-e83d32cb7055");
  });

  it("reads the state as JSON and waits for a final one", async () => {
    states = ["STARTED", "RUNNING_TASKS", "COMPLETED_SUCCESSFUL"];
    const seen: string[] = [];
    const final = await model.waitForCompletion("id1", {
      sleep: noSleep,
      onUpdate: (s) => seen.push(s),
    });
    expect(final).to.equal("COMPLETED_SUCCESSFUL");
    expect(seen).to.deep.equal([
      "STARTED",
      "RUNNING_TASKS",
      "COMPLETED_SUCCESSFUL",
    ]);
    expect(calls[0].url).to.equal("/clinicalJobs/submissions/id1/state");
    expect(calls[0].headers).to.deep.equal({ Accept: "application/json" });
  });

  it("cancels with a lowercase state value", async () => {
    await model.cancel("id 1");
    expect(calls[0]).to.deep.include({
      method: "PUT",
      url: "/clinicalJobs/submissions/id%201/state?value=canceled",
    });
  });

  it("gets manifests by run and by repository item", async () => {
    answers["GET /clinicalJobs/submissions/id1/manifest"] = json<Manifest>(
      "manifest-workspace.json",
    );
    const manifest = await model.getSubmissionManifest("id1");
    expect(manifest.programs?.[0].executionState).to.equal("SUCCESSFUL");
    await model.getRepositoryManifest("m1", "2.0");
    expect(calls[1].url).to.equal(
      "/clinicalJobs/repository/manifests/m1?fileVersion=2.0",
    );
    await model.getRepositoryJob("j1");
    expect(calls[2].url).to.equal("/clinicalJobs/repository/definitions/j1");
  });

  it("reads workspace jobs and manifests from their files", async () => {
    contents["/probe-jobs/probe.cjob"] = fixture("probe.cjob");
    contents["/probe-jobs/probe.cmnf"] = fixture("probe.cmnf");
    const resource = resourceFromPath("/probe-jobs/probe.cjob", "WORKSPACE");
    const job = await model.readWorkspaceJob(resource);
    expect(job.resource).to.deep.equal(resource);
    expect(job.description).to.equal("Probe job (patched)");

    await model.readWorkspaceManifest("/probe-jobs/probe.cmnf");
    expect(calls[0].url).to.equal(
      "/clinicalJobs/submissions/eba8e748-2de6-4ef0-b3f7-e83d32cb7055/manifest",
    );

    contents["/bad.cmnf"] = "{}";
    const error = await rejection(model.readWorkspaceManifest("/bad.cmnf"));
    expect(String(error)).to.match(/does not name the run/);
  });

  it("creates and saves jobs with relative paths", async () => {
    const job = {
      resource: resourceFromPath("/probe-jobs/probe.cjob", "WORKSPACE"),
      programs: [{ path: "/probe-jobs/probe.sas" }],
    };
    await model.createJob(job);
    await model.patchJob(job);
    expect(calls.map((c) => `${c.method} ${c.url}`)).to.deep.equal([
      "POST /clinicalJobs/definitions?useRelativePaths=true",
      "PATCH /clinicalJobs/definitions?useRelativePaths=true",
    ]);
    expect(calls[0].data).to.equal(job);
  });

  it("lists schedules and their next runs", async () => {
    answers["GET /clinicalJobs/schedules?"] = {
      items: [{ id: "s1", name: "Nightly" }],
    };
    answers["GET /clinicalJobs/schedules/s1/future"] = ["2026-11-12T02:00:00Z"];
    expect(await model.listSchedules()).to.deep.equal([
      { id: "s1", name: "Nightly" },
    ]);
    expect(await model.getFutureRuns("s1")).to.deep.equal([
      "2026-11-12T02:00:00Z",
    ]);
    expect(calls.map((c) => c.url)).to.deep.equal([
      "/clinicalJobs/schedules?limit=1000",
      "/clinicalJobs/schedules/s1/future?limit=5",
    ]);
  });
});

describe("job parameter values", () => {
  const param = (
    type: JobParameter["type"],
    defaultValue?: JobParameter["defaultValue"],
  ): JobParameter => ({ name: "p", label: "P", type, defaultValue });

  it("pre-fills prompts from defaults, never masked ones", () => {
    expect(defaultText(param("CHARACTER", "hello"))).to.equal("hello");
    // The {value} form of the spec is read too.
    expect(
      defaultText(param("NUMERIC", JSON.parse('{"value": 999}'))),
    ).to.equal("999");
    expect(defaultText(param("CHARACTER_MASKED", "secret"))).to.equal("");
    expect(defaultText(param("DATE", "2023-12-15T05:00:00Z"))).to.equal(
      "2023-12-15",
    );
    expect(defaultText(param("CHARACTER"))).to.equal("");
  });

  it("resolves FILE and FOLDER defaults against the job's folder", () => {
    expect(
      defaultPath(
        param("FOLDER", { path: "../Demo", includeSubfolders: false }),
        "/test/jobs",
      ),
    ).to.equal("/test/Demo");
    expect(defaultPath(param("FILE", "x"), "/a")).to.equal(undefined);
  });

  it("validates numbers and dates", () => {
    expect(validateParameterText("NUMERIC", "22")).to.equal(undefined);
    expect(validateParameterText("NUMERIC", "-1.5e3")).to.equal(undefined);
    expect(validateParameterText("NUMERIC", "abc")).to.equal("number");
    expect(validateParameterText("NUMERIC", " ")).to.equal("number");
    expect(validateParameterText("DATE", "2026-02-28")).to.equal(undefined);
    expect(validateParameterText("DATE", "2026-02-30")).to.equal("date");
    expect(validateParameterText("DATE", "28.02.2026")).to.equal("date");
    expect(validateParameterText("CHARACTER", "")).to.equal(undefined);
  });

  it("sends text types as plain strings", () => {
    expect(buildParameterValue(param("CHARACTER"), "x")).to.deep.equal({
      name: "p",
      type: "CHARACTER",
      value: "x",
    });
    expect(buildParameterValue(param("NUMERIC"), " 22 ").value).to.equal("22");
    expect(buildParameterValue(param("DATE"), "2026-11-11").value).to.equal(
      "2026-11-11T00:00:00Z",
    );
    expect(
      buildParameterValue(param("FILE"), "/a/b.sas7bdat").value,
    ).to.deep.equal({ path: "/a/b.sas7bdat" });
    expect(
      buildParameterValue(param("FOLDER"), "/a", true).value,
    ).to.deep.equal({
      path: "/a",
      includeSubfolders: true,
    });
  });

  it("reruns with the values a run recorded, without labels", () => {
    const manifest = json<Manifest>("manifest-workspace.json");
    expect(valuesForRerun(manifest.parameters)).to.deep.equal([
      { name: "probe_char", type: "CHARACTER", value: "from-probe" },
    ]);
    expect(valuesForRerun(undefined)).to.deep.equal([]);
  });
});

describe("manifestNodes", () => {
  const labels = {
    programs: "Programs",
    parameters: "Parameters",
    inputs: "Inputs",
    outputs: "Outputs",
    logs: "Logs",
    results: "Results",
    checkinFailures: "Check-in failures",
  };

  it("groups a run's manifest and leaves out empty groups", () => {
    const nodes = manifestNodes(json("manifest-workspace.json"), [], labels);
    const summary = nodes.map((n) =>
      n.kind === "group" ? `${n.label}:${n.children.length}` : n.kind,
    );
    // The log and listing are outputs too, but only listed once.
    expect(summary).to.deep.equal([
      "Programs:1",
      "Parameters:1",
      "Logs:1",
      "Results:1",
    ]);
  });

  it("shows the program states and check-in failures", () => {
    const nodes = manifestNodes(
      json("manifest-canceled.json"),
      [{ itemName: "adsl.sas7bdat", message: "checked out by someone else" }],
      labels,
    );
    const programs = nodes.find(
      (n) => n.kind === "group" && n.label === "Programs",
    );
    expect(programs?.kind === "group" && programs.children[0]).to.deep.include({
      kind: "program",
    });
    const program =
      programs?.kind === "group" ? programs.children[0] : undefined;
    expect(
      program?.kind === "program" && program.program.executionState,
    ).to.equal("CANCELED");
    expect(nodes[nodes.length - 1]).to.deep.include({
      kind: "group",
      label: "Check-in failures",
    });
  });

  it("describes parameter values, hiding masked ones", () => {
    expect(
      describeValue({ name: "a", type: "CHARACTER_MASKED", value: "s" }),
    ).to.equal("*****");
    expect(
      describeValue({
        name: "f",
        type: "FOLDER",
        value: { path: "/x", includeSubfolders: true },
      }),
    ).to.equal("/x (+ subfolders)");
    expect(
      describeValue({ name: "f", type: "FILE", value: { path: "/x.sas" } }),
    ).to.equal("/x.sas");
  });
});

describe("renderManifestReport", () => {
  const labels: ReportLabels = {
    title: "Clinical job manifest",
    summary: "Summary",
    job: "Job",
    description: "Description",
    state: "State",
    info: "Information",
    runId: "Run ID",
    runContext: "Run context",
    submitted: "Submitted",
    completed: "Completed",
    runAs: "Run as",
    owner: "Job owner",
    totalTime: "Total time",
    manifestFile: "Manifest file",
    parameters: "Parameters",
    programs: "Programs",
    inputs: "Inputs",
    externalInputs: "External inputs",
    outputs: "Outputs",
    externalOutputs: "External outputs",
    logs: "Logs",
    results: "Results",
    checkin: "Check-in",
    checkinFailures: "Check-in failures",
    metrics: "File transfer",
    name: "Name",
    label: "Label",
    type: "Type",
    value: "Value",
    path: "Path",
    version: "Version",
    size: "Size",
    modified: "Modified",
    md5: "MD5",
    usedBy: "Used by",
    location: "Location",
    executionState: "Result",
    executionTime: "Time",
    item: "Item",
    message: "Message",
    versioning: "Output versioning",
    versionNewFiles: "Version new files",
    checkinLocations: "Check-in locations",
    files: "Files",
    time: "Time",
    yes: "Yes",
    no: "No",
    none: "None",
    generated: "Generated on",
  };
  const generatedAt = new Date("2026-11-11T10:00:00Z");
  // Rows of a section, as text: the cells of each row joined with "|".
  const rows = (html: string, heading: string): string[] => {
    const start = html.indexOf(`<h2>${heading}</h2>`);
    expect(start, heading).to.be.greaterThan(-1);
    const end = html.indexOf("<h2>", start + 1);
    const section = html.slice(start, end < 0 ? undefined : end);
    return [...section.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) =>
      m[1]
        .split(/<\/t[dh]>/)
        .map((cell) => cell.replace(/<[^>]*>/g, "").trim())
        .filter(Boolean)
        .join("|"),
    );
  };

  it("renders a workspace run as a complete page", () => {
    const html = renderManifestReport(json("manifest-workspace.json"), labels, {
      generatedAt,
    });
    expect(html).to.match(/^<!DOCTYPE html>/);
    expect(html).to.include("<title>Clinical job manifest: probe.cjob</title>");
    expect(html).to.include(
      '<span class="badge success">Completed successful</span>',
    );
    expect(html).to.include("eba8e748-2de6-4ef0-b3f7-e83d32cb7055");
    expect(rows(html, "Parameters")).to.deep.equal([
      "Name|Label|Type|Value",
      "probe_char|Probe text|CHARACTER|from-probe",
    ]);
    expect(rows(html, "Programs")[1]).to.match(
      /^\/probe-jobs\/probe\.sas\|Successful\|0\.04 s$/,
    );
    // The log and listing are in their own sections, not under Outputs.
    expect(html).to.include('<p class="empty">None</p>');
    expect(rows(html, "Logs")[1]).to.match(
      /^\/probe-jobs\/probe\.log\|3\.3 KB\|/,
    );
    // A workspace run checks nothing in.
    expect(html).to.not.include("<h2>Check-in</h2>");
  });

  it("shows the check-in of a repository run and its failures", () => {
    const manifest: Manifest = {
      ...json<Manifest>("manifest-workspace.json"),
      type: "REPOSITORY",
      checkinSpecification: {
        fileVersion: "MINOR",
        enableVersioningOnNewFiles: true,
        locations: [{ path: "/study/output", includeSubfolders: true }],
      },
      inputs: [
        {
          resource: {
            name: "adsl.sas7bdat",
            path: "/study/adam/adsl.sas7bdat",
            location: "/study/adam",
            resourceLocation: "REPOSITORY",
            id: "1",
            fileVersion: "2.0",
          },
          size: 196608,
          digest: "0FA3713F9BA4E15AC2B51D9E659C4D4B",
          referencingProgram: "/study/programs/t.sas",
        },
      ],
    };
    const html = renderManifestReport(manifest, labels, {
      generatedAt,
      checkinFailures: [
        {
          itemIdentifier: "/study/output",
          itemName: "t.lst",
          message: "checked out",
        },
      ],
    });
    expect(rows(html, "Inputs")[1]).to.equal(
      "/study/adam/adsl.sas7bdat|2.0|192 KB|0FA3713F9BA4E15AC2B51D9E659C4D4B|/study/programs/t.sas",
    );
    expect(rows(html, "Check-in")).to.include.members([
      "Output versioning|MINOR",
      "Version new files|Yes",
      "Check-in locations|/study/output +",
      "/study/output/t.lst|checked out",
    ]);
  });

  it("links the run's files when asked to, and only then", () => {
    const manifest = json<Manifest>("manifest-workspace.json");
    const linked = renderManifestReport(manifest, labels, {
      generatedAt,
      linkFor: (resource) =>
        resource.name.endsWith(".cmnf")
          ? undefined
          : `open?f=${resource.path}&x="`,
    });
    expect(linked).to.include(
      '<a href="open?f=/probe-jobs/probe.log&amp;x=&quot;"><code>/probe-jobs/probe.log</code></a>',
    );
    expect(linked).to.include(
      '<a href="open?f=/probe-jobs/probe.cjob&amp;x=&quot;"><code>/probe-jobs/probe.cjob</code></a>',
    );
    // The manifest file itself was given no link.
    expect(linked).to.include("<code>/probe-jobs/probe.cmnf</code>");
    expect(linked).to.not.include('href="open?f=/probe-jobs/probe.cmnf');
    expect(
      renderManifestReport(manifest, labels, { generatedAt }),
    ).to.not.include("<a href");
  });

  it("marks canceled programs and escapes text from the server", () => {
    const manifest = json<Manifest>("manifest-canceled.json");
    manifest.job = {
      ...manifest.job!,
      description: '<script>alert("x")</script>',
    };
    const html = renderManifestReport(manifest, labels, { generatedAt });
    expect(html).to.include('<span class="badge canceled">Canceled</span>');
    expect(html).to.not.include("<script>");
    expect(html).to.include(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});

describe("program jobs", () => {
  it("names the job after the program", () => {
    expect(jobPathForProgram("/study/adsl.sas")).to.equal("/study/adsl.cjob");
    expect(jobPathForProgram("/study/adsl.sas", 2)).to.equal(
      "/study/adsl-2.cjob",
    );
    expect(jobPathForProgram("/t.final.sas")).to.equal("/t.final.cjob");
  });

  it("recognizes a job that runs only the program", () => {
    const resource = resourceFromPath("/probe-jobs/probe.cjob", "WORKSPACE");
    const job = parseJobFile(fixture("probe.cjob"), resource);
    // The file stores "./probe.sas", relative to the job's folder.
    expect(runsOnlyProgram(job, "/probe-jobs/probe.sas")).to.equal(true);
    expect(runsOnlyProgram(job, "/probe-jobs/other.sas")).to.equal(false);
    expect(
      runsOnlyProgram(
        { ...job, programs: [...(job.programs ?? []), { path: "./b.sas" }] },
        "/probe-jobs/probe.sas",
      ),
    ).to.equal(false);
    expect(runsOnlyProgram({ resource }, "/probe-jobs/probe.sas")).to.equal(
      false,
    );
  });

  it("creates a workspace job for one program", () => {
    expect(programJob("/study/adsl.sas", "/study/adsl.cjob")).to.deep.equal({
      resource: {
        name: "adsl.cjob",
        path: "/study/adsl.cjob",
        location: "/study",
        resourceLocation: "WORKSPACE",
      },
      programs: [
        { path: "/study/adsl.sas", name: "adsl.sas", location: "/study" },
      ],
    });
  });
});
