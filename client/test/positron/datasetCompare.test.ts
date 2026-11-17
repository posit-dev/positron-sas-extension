// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  buildCompareCode,
  commonColumns,
  dataExplorerTabLabel,
  describeCompareResult,
  parseCompareStatus,
} from "../../src/positron/datasetCompare";

const base = { lib: "work", mem: "adsl", label: "WORK.ADSL" };
const compare = { lib: "qc", mem: "adsl", label: "adsl.sas7bdat" };

describe("buildCompareCode", () => {
  it("compares by position without ID variables", () => {
    const code = buildCompareCode({ base, compare, idVars: [] });
    expect(code).to.equal(
      [
        "%let _sas_cmpopt=%sysfunc(getoption(center)) ls=%sysfunc(getoption(linesize));",
        "options nocenter ls=132;",
        "title 'Compare WORK.ADSL (base) with adsl.sas7bdat';",
        "proc compare base=WORK.ADSL compare=QC.ADSL listall",
        "    out=WORK._COMPARE outnoequal outbase outcomp outdif;",
        "run;",
        "%let _sas_cmprc=&sysinfo;",
        "title;",
        "options &_sas_cmpopt;",
      ].join("\n"),
    );
  });

  it("sorts both datasets by the ID variables first", () => {
    const code = buildCompareCode({
      base,
      compare,
      idVars: ["usubjid", "STUDYID"],
    });
    expect(code).to.contain(
      "proc sort data=WORK.ADSL out=WORK._B_ADSL; by USUBJID STUDYID; run;",
    );
    expect(code).to.contain(
      "proc sort data=QC.ADSL out=WORK._C_ADSL; by USUBJID STUDYID; run;",
    );
    expect(code).to.contain(
      "proc compare base=WORK._B_ADSL compare=WORK._C_ADSL listall",
    );
    expect(code).to.contain("  id USUBJID STUDYID;");
    // The return code is saved before the sorted copies are deleted.
    expect(code.indexOf("%let _sas_cmprc=&sysinfo;")).to.be.lessThan(
      code.indexOf("delete _B_ADSL _C_ADSL"),
    );
  });

  it("keeps the sorted copies' names within 32 characters", () => {
    const long = "A".repeat(32);
    const code = buildCompareCode({
      base: { ...base, mem: long },
      compare,
      idVars: ["USUBJID"],
    });
    expect(code).to.contain(`out=WORK._B_${"A".repeat(29)};`);
  });

  it("adds a tolerance for numeric values", () => {
    const code = buildCompareCode({
      base,
      compare,
      idVars: [],
      tolerance: 1e-5,
    });
    expect(code).to.contain("listall method=absolute criterion=0.00001");
    expect(
      buildCompareCode({ base, compare, idVars: [], tolerance: 0 }),
    ).to.not.contain("criterion");
  });

  it("quotes the title so SAS doesn't resolve macro triggers", () => {
    const code = buildCompareCode({
      base: { ...base, label: "it's &sysuserid" },
      compare,
      idVars: [],
    });
    expect(code).to.contain(
      "title 'Compare it''s &sysuserid (base) with adsl.sas7bdat';",
    );
  });

  it("rejects names that could inject code", () => {
    expect(() =>
      buildCompareCode({
        base: { ...base, mem: "a; run" },
        compare,
        idVars: [],
      }),
    ).to.throw(/Invalid SAS identifier/);
    expect(() =>
      buildCompareCode({ base, compare, idVars: ["x;drop"] }),
    ).to.throw(/Invalid SAS identifier/);
    expect(() =>
      buildCompareCode({ base, compare, idVars: [], tolerance: -1 }),
    ).to.throw(/Invalid tolerance/);
  });
});

describe("parseCompareStatus", () => {
  it("reads the return code and the number of differences", () => {
    expect(parseCompareStatus("x\nCMPSTATUS=4160|3\ny")).to.deep.equal({
      returnCode: 4160,
      differenceRows: 3,
    });
  });

  it("has no return code when PROC COMPARE didn't run", () => {
    expect(parseCompareStatus("CMPSTATUS=|0")).to.deep.equal({
      returnCode: undefined,
      differenceRows: 0,
    });
  });

  it("ignores the source echo of the %put", () => {
    expect(
      parseCompareStatus("12   %put CMPSTATUS=&_sas_cmprc|&_sas_cmpn;"),
    ).to.equal(undefined);
  });
});

describe("describeCompareResult", () => {
  it("reports identical datasets", () => {
    expect(describeCompareResult(0)).to.deep.equal({
      identical: true,
      fatal: false,
      differences: [],
    });
  });

  it("lists every difference the return code holds", () => {
    // 64 + 4096: observations only in base, unequal values.
    expect(describeCompareResult(4160).differences).to.deep.equal([
      "observations only in the base dataset",
      "unequal values",
    ]);
    expect(describeCompareResult(1024 | 2048 | 16).differences).to.deep.equal([
      "variables have different lengths",
      "variables only in the base dataset",
      "variables only in the compare dataset",
    ]);
  });

  it("flags a fatal error", () => {
    expect(describeCompareResult(32768).fatal).to.equal(true);
  });
});

describe("commonColumns", () => {
  it("keeps the base order and ignores case", () => {
    expect(
      commonColumns(
        [{ name: "STUDYID" }, { name: "USUBJID" }, { name: "AGE" }],
        [{ name: "usubjid" }, { name: "studyid" }, { name: "SEX" }],
      ),
    ).to.deep.equal(["STUDYID", "USUBJID"]);
  });
});

describe("dataExplorerTabLabel", () => {
  it("prefixes the title with Data:", () => {
    expect(dataExplorerTabLabel("WORK.A")).to.equal("Data: WORK.A");
  });

  it("cuts titles over 30 characters as Positron does", () => {
    const title = "Differences: WORK.ADSL vs WORK.ADSL_QC";
    expect(dataExplorerTabLabel(title)).to.equal(
      "Data: Differences: WORK.ADSL vs W...",
    );
    expect(dataExplorerTabLabel("x".repeat(30))).to.equal(
      `Data: ${"x".repeat(30)}`,
    );
  });
});
