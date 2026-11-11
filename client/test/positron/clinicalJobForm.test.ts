// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import {
  dateToDefault,
  defaultToDate,
  emptyDefault,
  parseJobText,
  relativeJobPath,
  serializeJobFile,
  validateJobFile,
} from "../../src/clinical/jobs/jobForm";

// From the repository root: this file also runs compiled from client/out.
const root = (() => {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return dir;
})();
const fixture = fs.readFileSync(
  path.join(root, "client/test/positron/fixtures/clinicalJobs/probe.cjob"),
  "utf8",
);

describe("clinical job editor model", () => {
  it("is contributed as the default editor of .cjob files", () => {
    // A second "customEditors" key once replaced the first one silently.
    const text = fs.readFileSync(path.join(root, "package.json"), "utf8");
    expect(text.match(/"customEditors"\s*:/g)).to.have.length(1);
    const editors: { viewType: string; priority: string }[] =
      JSON.parse(text).contributes.customEditors;
    expect(
      editors.find((e) => e.viewType === "SAS.clinical.jobEditor"),
    ).to.deep.include({ priority: "default" });
  });

  it("reads a .cjob file and keeps fields it does not know", () => {
    const result = parseJobText(fixture);
    expect(result).to.have.property("job");
    if (!("job" in result)) {
      return;
    }
    expect(result.job.useSingleOutputLocation).to.equal(false);
    expect(result.job).to.have.property("outputLocation", null);
    // Round trip: same content (the service writes "key" : value).
    expect(JSON.parse(serializeJobFile(result.job))).to.deep.equal(
      JSON.parse(fixture),
    );
  });

  it("treats an empty file as an empty job and reports broken JSON", () => {
    expect(parseJobText("  ")).to.deep.equal({ job: {} });
    expect(parseJobText("{")).to.have.property("error");
    expect(parseJobText("[1]")).to.have.property("error");
  });

  it("stores paths relative to the job's folder", () => {
    expect(relativeJobPath("/probe-jobs", "/probe-jobs/probe.sas")).to.equal(
      "./probe.sas",
    );
    expect(relativeJobPath("/study/jobs", "/study/programs/t.sas")).to.equal(
      "../programs/t.sas",
    );
    expect(relativeJobPath("/a/b", "/c.sas")).to.equal("../../c.sas");
    expect(relativeJobPath("/", "/x/y.sas")).to.equal("./x/y.sas");
    expect(relativeJobPath("/study/jobs", "/study")).to.equal("..");
    expect(relativeJobPath("/study", "/study")).to.equal("./");
  });

  it("validates programs and parameters", () => {
    expect(validateJobFile({})).to.deep.equal([{ kind: "noPrograms" }]);
    const problems = validateJobFile({
      programs: [{ path: "./a.sas" }, { path: " " }],
      parameters: [
        { name: "1bad", type: "CHARACTER" },
        { name: "cutoff", type: "NUMERIC", defaultValue: "ten" },
        { name: "CUTOFF", type: "CHARACTER" },
        { name: "start", type: "DATE", defaultValue: "someday" },
        { name: "ok", type: "DATE", defaultValue: "2026-11-11T00:00:00Z" },
        { name: "empty", type: "NUMERIC", defaultValue: "" },
      ],
    });
    expect(problems).to.deep.equal([
      { kind: "programPath", index: 1 },
      { kind: "parameterName", index: 0 },
      { kind: "parameterNumber", index: 1 },
      { kind: "parameterDuplicate", index: 2 },
      { kind: "parameterDate", index: 3 },
    ]);
  });

  it("converts dates and starts defaults by type", () => {
    expect(dateToDefault("2026-11-11")).to.equal("2026-11-11T00:00:00Z");
    expect(dateToDefault("")).to.equal("");
    expect(defaultToDate("2023-12-15T05:00:00Z")).to.equal("2023-12-15");
    expect(defaultToDate(undefined)).to.equal("");
    expect(emptyDefault("CHARACTER")).to.equal("");
    expect(emptyDefault("FILE")).to.deep.equal({ path: "" });
    expect(emptyDefault("FOLDER")).to.deep.equal({
      path: "",
      includeSubfolders: false,
    });
  });
});
