// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import {
  SasClient,
  isInternalTableName,
  parseDataRows,
  parseSessionSnapshot,
  sasIdent,
} from "../../src/positron/sasClient";

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeClient(responses: Record<string, string>) {
  const executor = sinon.stub();
  for (const [pattern, response] of Object.entries(responses)) {
    executor.withArgs(sinon.match(pattern)).resolves(response);
  }
  executor.resolves("");
  return { client: new SasClient(executor), executor };
}

function sentinelWrap(content: string): string {
  return `~~SAS_START~~\n${content}\n~~SAS_END~~`;
}

// ─── sasIdent ────────────────────────────────────────────────────────────────

describe("sasIdent", () => {
  it("upcases valid identifiers", () => {
    expect(sasIdent("work")).to.equal("WORK");
    expect(sasIdent("my_lib")).to.equal("MY_LIB");
  });

  it("throws on non-string input", () => {
    expect(() => sasIdent(42)).to.throw("Expected string");
  });

  it("throws on identifiers with invalid characters", () => {
    expect(() => sasIdent("bad name")).to.throw("Invalid SAS identifier");
    expect(() => sasIdent("1bad")).to.throw("Invalid SAS identifier");
    expect(() => sasIdent("bad;inject")).to.throw("Invalid SAS identifier");
  });
});

// ─── SasClient.getLibraryList ─────────────────────────────────────────────────

describe("SasClient.getLibraryList", () => {
  it("returns library names parsed from one record per line", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("LIB=WORK\nLIB=SASHELP\nLIB=SASUSER"),
    });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal(["WORK", "SASHELP", "SASUSER"]);
  });

  it("returns empty array when output has no sentinel", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": "some noise\nno markers",
    });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal([]);
  });

  it("filters empty records", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("LIB=WORK\nLIB=\nLIB=SASHELP"),
    });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal(["WORK", "SASHELP"]);
  });

  it("emits one %put per library so output survives log line wrapping", async () => {
    const { client, executor } = makeClient({});
    await client.getLibraryList();
    const code: string = executor.firstCall.args[0];
    expect(code).to.include("%put LIB=%superq(_sas_lib&_i);");
    expect(code).not.to.include("separated by");
  });
});

// ─── SasClient.getLibraryMembers ──────────────────────────────────────────────

describe("SasClient.getLibraryMembers", () => {
  it("returns members with type", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("MEM=CLASS|DATA\nMEM=CARS|VIEW"),
    });
    const members = await client.getLibraryMembers("sashelp");
    expect(members).to.deep.equal([
      { name: "CLASS", type: "DATA" },
      { name: "CARS", type: "VIEW" },
    ]);
  });

  it("returns every member of a large library", async () => {
    const names = Array.from({ length: 200 }, (_, i) => `TABLE${i}`);
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        names.map((n) => `MEM=${n}|DATA`).join("\n"),
      ),
    });
    const members = await client.getLibraryMembers("sashelp");
    expect(members.map((m) => m.name)).to.deep.equal(names);
  });

  it("ignores unprefixed lines inside the sentinel block", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("NOTE: noise\nMEM=CLASS|DATA\n|DATA"),
    });
    const members = await client.getLibraryMembers("sashelp");
    expect(members).to.deep.equal([{ name: "CLASS", type: "DATA" }]);
  });

  it("validates the libname identifier", async () => {
    const { client } = makeClient({});
    let threw = false;
    try {
      await client.getLibraryMembers("bad name");
    } catch (e) {
      threw = true;
      expect(String(e)).to.include("Invalid SAS identifier");
    }
    expect(threw).to.be.true;
  });

  it("returns empty array for an empty library", async () => {
    const { client } = makeClient({ "~~SAS_START~~": sentinelWrap("") });
    const members = await client.getLibraryMembers("work");
    expect(members).to.deep.equal([]);
  });
});

// ─── SasClient.getDatasetColumns ──────────────────────────────────────────────

describe("SasClient.getDatasetColumns", () => {
  it("returns parsed column metadata", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        "COL=NAME|char|20|$||Student name\nCOL=AGE|num|8|BEST12.|F8.|Age | years",
      ),
    });
    const cols = await client.getDatasetColumns("work", "class");
    expect(cols).to.deep.equal([
      {
        name: "NAME",
        type: "char",
        length: 20,
        format: "$",
        informat: undefined,
        label: "Student name",
      },
      // A label may contain the delimiter.
      {
        name: "AGE",
        type: "num",
        length: 8,
        format: "BEST12.",
        informat: "F8.",
        label: "Age|years",
      },
    ]);
  });

  it("returns every column of a wide table", async () => {
    const names = Array.from({ length: 100 }, (_, i) => `VAR${i}`);
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        names.map((n) => `COL=${n}|num|8|`).join("\n"),
      ),
    });
    const cols = await client.getDatasetColumns("work", "wide");
    expect(cols.map((c) => c.name)).to.deep.equal(names);
    expect(cols.every((c) => c.type === "num")).to.be.true;
  });

  it("validates both identifiers", async () => {
    const { client } = makeClient({});
    let threw = false;
    try {
      await client.getDatasetColumns("work", "bad;name");
    } catch (e) {
      threw = true;
      expect(String(e)).to.include("Invalid SAS identifier");
    }
    expect(threw).to.be.true;
  });

  it("caches concurrent requests for the same table", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("COL=ID|num|8|"));
    const client = new SasClient(executor);
    const [a, b] = await Promise.all([
      client.getDatasetColumns("WORK", "CLASS"),
      client.getDatasetColumns("WORK", "CLASS"),
    ]);
    expect(executor.callCount).to.equal(1);
    expect(a).to.deep.equal(b);
  });

  it("treats missing format as undefined", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("COL=X|num|8|"),
    });
    const cols = await client.getDatasetColumns("work", "t");
    expect(cols[0].format).to.be.undefined;
  });
});

// ─── SasClient.getDatasetRowCount ─────────────────────────────────────────────

describe("SasClient.getDatasetRowCount", () => {
  it("returns parsed row count", async () => {
    const { client } = makeClient({ "~~SAS_START~~": sentinelWrap("42") });
    expect(await client.getDatasetRowCount("work", "class")).to.equal(42);
  });

  it("returns 0 when output is empty", async () => {
    const { client } = makeClient({ "~~SAS_START~~": "" });
    expect(await client.getDatasetRowCount("work", "class")).to.equal(0);
  });

  it("passes the WHERE clause into the query", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("5"));
    const client = new SasClient(executor);
    await client.getDatasetRowCount("WORK", "T", "AGE > 10");
    const code: string = executor.firstCall.args[0];
    expect(code).to.include("where AGE > 10");
  });
});

// ─── SasClient.getColumnNullCounts ────────────────────────────────────────────

describe("SasClient.getColumnNullCounts", () => {
  it("returns null counts for each column", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("NC0=0\nNC1=3"));
    const client = new SasClient(executor);
    const counts = await client.getColumnNullCounts("work", "class", [
      "NAME",
      "AGE",
    ]);
    expect(counts).to.deep.equal([0, 3]);
  });

  it("returns empty array for empty column list", async () => {
    const executor = sinon.stub();
    const client = new SasClient(executor);
    const counts = await client.getColumnNullCounts("work", "class", []);
    expect(counts).to.deep.equal([]);
    expect(executor.callCount).to.equal(0);
  });

  it("defaults to 0 for missing markers", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("NC0=2"));
    const client = new SasClient(executor);
    const counts = await client.getColumnNullCounts("work", "t", [
      "NAME",
      "AGE",
    ]);
    expect(counts).to.deep.equal([2, 0]);
  });
});

// ─── SasClient.getColumnSummaryStats ──────────────────────────────────────────

describe("SasClient.getColumnSummaryStats", () => {
  it("parses min/max/mean/median/stdev", async () => {
    const executor = sinon
      .stub()
      .resolves(sentinelWrap("STATS0=5|90|47.5|45|20.3"));
    const client = new SasClient(executor);
    const stats = await client.getColumnSummaryStats("work", "class", ["AGE"]);
    expect(stats[0]).to.deep.equal({
      minValue: 5,
      maxValue: 90,
      meanValue: 47.5,
      medianValue: 45,
      stdevValue: 20.3,
    });
  });

  it("returns nulls for missing values (SAS missing = '.')", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("STATS0=.|.|.|.|."));
    const client = new SasClient(executor);
    const stats = await client.getColumnSummaryStats("work", "t", ["X"]);
    expect(stats[0]).to.deep.equal({
      minValue: null,
      maxValue: null,
      meanValue: null,
      medianValue: null,
      stdevValue: null,
    });
  });

  it("returns empty array for empty column list without calling executor", async () => {
    const executor = sinon.stub();
    const client = new SasClient(executor);
    const stats = await client.getColumnSummaryStats("work", "t", []);
    expect(stats).to.deep.equal([]);
    expect(executor.callCount).to.equal(0);
  });
});

// ─── Long column names ────────────────────────────────────────────────────────

/** All macro variable names a submitted program assigns or reads. */
function macroVariableNames(code: string): string[] {
  return [...code.matchAll(/(?:%let\s+|:)(_[A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

describe("SasClient profile queries with long column names", () => {
  const longName = "A_VERY_LONG_COLUMN_NAME_32_CHARS";

  it("keeps every macro variable name within SAS's 32-character limit", async () => {
    expect(longName).to.have.length(32);
    const executor = sinon.stub().resolves("");
    const client = new SasClient(executor);
    await client.getColumnNullCounts("work", "t", [longName]);
    await client.getColumnSummaryStats("work", "t", [longName]);
    await client.getColumnBinningStats("work", "t", [longName]);
    await client.getColumnHistogramCounts("work", "t", [
      { column: longName, bins: { lo: 0, width: 1, nbins: 3 } },
    ]);
    await client.getColumnFrequencyTables("work", "t", [
      { column: longName, limit: 8 },
    ]);
    await client.getColumnStringStats("work", "t", [longName]);

    expect(executor.callCount).to.equal(6);
    for (const call of executor.getCalls()) {
      const names = macroVariableNames(call.args[0]);
      expect(names).to.not.be.empty;
      for (const name of names) {
        expect(name.length, name).to.be.at.most(32);
      }
    }
  });
});

// ─── SasClient.getColumnBinningStats ──────────────────────────────────────────

describe("SasClient.getColumnBinningStats", () => {
  it("parses n, min, max, quartiles and non-integer counts per column", async () => {
    const executor = sinon
      .stub()
      .resolves(
        sentinelWrap(
          "NOTE: noise\nHS0=19|11|16|12|15|0\nHS1=19|51.3|72|57.5|66.5|17",
        ),
      );
    const client = new SasClient(executor);
    const stats = await client.getColumnBinningStats("sashelp", "class", [
      "AGE",
      "HEIGHT",
    ]);
    expect(stats).to.deep.equal([
      { n: 19, min: 11, max: 16, q1: 12, q3: 15, nonInteger: 0 },
      { n: 19, min: 51.3, max: 72, q1: 57.5, q3: 66.5, nonInteger: 17 },
    ]);
  });

  it("applies the WHERE clause in a PROC SQL view", async () => {
    const executor = sinon.stub().resolves("");
    const client = new SasClient(executor);
    await client.getColumnBinningStats(
      "sashelp",
      "class",
      ["AGE"],
      "SEX = 'F'",
    );
    const code: string = executor.firstCall.args[0];
    expect(code).to.match(
      /create view work\._sas_hv as\s+select AGE from SASHELP\.CLASS\s+where SEX = 'F'/,
    );
    expect(code).to.include("proc means data=work._sas_hv");
  });

  it("treats an all-missing column as empty", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("HS0=0|.|.|.|.|."));
    const client = new SasClient(executor);
    const [stats] = await client.getColumnBinningStats("work", "t", ["X"]);
    expect(stats).to.deep.equal({
      n: 0,
      min: null,
      max: null,
      q1: null,
      q3: null,
      nonInteger: 0,
    });
  });
});

// ─── SasClient.getColumnHistogramCounts ───────────────────────────────────────

describe("SasClient.getColumnHistogramCounts", () => {
  it("fills counts per bin, with empty bins left at 0", async () => {
    const executor = sinon
      .stub()
      .resolves(sentinelWrap("HB0=0|4\nHB0=2|7\nHB1=1|5"));
    const client = new SasClient(executor);
    const counts = await client.getColumnHistogramCounts("work", "t", [
      { column: "A", bins: { lo: 0, width: 1, nbins: 3 } },
      { column: "B", bins: { lo: 10, width: 5, nbins: 2 } },
    ]);
    expect(counts).to.deep.equal([
      [4, 0, 7],
      [0, 5],
    ]);
  });

  it("does not query zero-width or empty histograms", async () => {
    const executor = sinon.stub().resolves("");
    const client = new SasClient(executor);
    const counts = await client.getColumnHistogramCounts("work", "t", [
      { column: "A", bins: { lo: 5, width: 0, nbins: 1 } },
      { column: "B", bins: { lo: 0, width: 0, nbins: 0 } },
    ]);
    expect(counts).to.deep.equal([[0], []]);
    expect(executor.callCount).to.equal(0);
  });

  it("clamps bin indices and combines the WHERE clause with a missing-value filter", async () => {
    const executor = sinon.stub().resolves("");
    const client = new SasClient(executor);
    await client.getColumnHistogramCounts(
      "work",
      "t",
      [{ column: "A", bins: { lo: -5, width: 2.5, nbins: 4 } }],
      "B > 1",
    );
    const code: string = executor.firstCall.args[0];
    expect(code).to.include("max(0, min(3, floor((A - (-5)) / (2.5))))");
    expect(code).to.include("where not missing(A) and (B > 1)");
  });
});

// ─── SasClient.getColumnFrequencyTables ───────────────────────────────────────

describe("SasClient.getColumnFrequencyTables", () => {
  it("returns top values, counts and the remaining count", async () => {
    const executor = sinon
      .stub()
      .resolves(
        sentinelWrap("FTT0=19\nFT0=10|M\nFT0=9|F\nFTT1=19\nFT1=2|a|b\nFT1=1|c"),
      );
    const client = new SasClient(executor);
    const tables = await client.getColumnFrequencyTables("sashelp", "class", [
      { column: "SEX", limit: 8 },
      { column: "NAME", limit: 2 },
    ]);
    expect(tables).to.deep.equal([
      { values: ["M", "F"], counts: [10, 9], otherCount: 0 },
      // Values may contain "|": only the first one separates the count.
      { values: ["a|b", "c"], counts: [2, 1], otherCount: 16 },
    ]);
  });

  it("aliases each column in the view so COUNT can't clash with PROC FREQ output", async () => {
    const executor = sinon.stub().resolves("");
    const client = new SasClient(executor);
    await client.getColumnFrequencyTables("work", "t", [
      { column: "COUNT", limit: 8 },
    ]);
    const code: string = executor.firstCall.args[0];
    expect(code).to.include("COUNT as _fv0");
    expect(code).to.include("tables _fv0 / out=work._sas_ft0(keep=_fv0 count)");
    expect(code).to.include("set work._sas_ft0(obs=8)");
  });
});

// ─── SasClient.getColumnStringStats ───────────────────────────────────────────

describe("SasClient.getColumnStringStats", () => {
  it("parses distinct and empty counts", async () => {
    const executor = sinon.stub().resolves(sentinelWrap("SS0=19|0\nSS1=2|3"));
    const client = new SasClient(executor);
    const stats = await client.getColumnStringStats("work", "t", [
      "NAME",
      "SEX",
    ]);
    expect(stats).to.deep.equal([
      { numUnique: 19, numEmpty: 0 },
      { numUnique: 2, numEmpty: 3 },
    ]);
  });
});

// ─── SasClient.getDatasetProperties ───────────────────────────────────────────

describe("SasClient.getDatasetProperties", () => {
  it("parses what dictionary.tables says", async () => {
    const { client, executor } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        [
          "PROP_MEMTYPE=DATA",
          "PROP_LABEL=Student Data | 2026",
          "PROP_CREATED=2026-11-17T09:30:00",
          "PROP_MODIFIED=2026-11-17T10:15:42",
          "PROP_ROWS=19",
          "PROP_DELETED=0",
          "PROP_COLUMNS=5",
          "PROP_ROWLENGTH=40",
          "PROP_FILESIZE=131072",
          "PROP_COMPRESS=NO",
          "PROP_ENCODING=utf-8  Unicode (UTF-8)",
          "PROP_DATAREP=SOLARIS_X86_64",
          "PROP_SORTEDBY=Sex Name",
        ].join("\n"),
      ),
    });
    const props = await client.getDatasetProperties("sashelp", "class");
    expect(props).to.deep.equal({
      lib: "SASHELP",
      mem: "CLASS",
      memtype: "DATA",
      label: "Student Data | 2026",
      created: "2026-11-17T09:30:00",
      modified: "2026-11-17T10:15:42",
      rows: 19,
      deletedRows: 0,
      columns: 5,
      rowLength: 40,
      fileSize: 131072,
      compression: "NO",
      encoding: "utf-8  Unicode (UTF-8)",
      dataRepresentation: "SOLARIS_X86_64",
      sortedBy: ["Sex", "Name"],
    });
    const code = String(executor.firstCall.args[0]);
    expect(code).to.include('where libname="SASHELP" and memname="CLASS"');
    // Long labels need a long line; the user's line size comes back.
    expect(code).to.include("ls=max");
    expect(code).to.include("options notes source &_sas_opt;");
  });

  it("leaves out what a view doesn't have", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        "PROP_MEMTYPE=VIEW\nPROP_LABEL=\nPROP_ROWS=.\nPROP_FILESIZE=.\nPROP_SORTEDBY=",
      ),
    });
    const props = await client.getDatasetProperties("sashelp", "vcolumn");
    expect(props?.memtype).to.equal("VIEW");
    expect(props?.label).to.equal(undefined);
    expect(props?.rows).to.equal(undefined);
    expect(props?.fileSize).to.equal(undefined);
    expect(props?.sortedBy).to.deep.equal([]);
  });

  it("returns undefined for a dataset that doesn't exist", async () => {
    const { client } = makeClient({ "~~SAS_START~~": sentinelWrap("") });
    expect(await client.getDatasetProperties("work", "gone")).to.equal(
      undefined,
    );
  });
});

// ─── SasClient.getDatasetStamps ───────────────────────────────────────────────

describe("SasClient.getDatasetStamps", () => {
  it("returns a stamp per existing dataset", async () => {
    const { client, executor } = makeClient({
      "~~SAS_START~~": sentinelWrap(
        "STAMP=WORK|A|DATA|2.0123E9|19|5\nSTAMP=WORK|V|VIEW|.|.|3",
      ),
    });
    const stamps = await client.getDatasetStamps([
      { lib: "work", mem: "a" },
      { lib: "work", mem: "v" },
      { lib: "work", mem: "gone" },
    ]);
    expect([...stamps.entries()]).to.deep.equal([
      ["WORK.A", { memtype: "DATA", stamp: "2.0123E9|19|5" }],
      ["WORK.V", { memtype: "VIEW", stamp: ".|.|3" }],
    ]);
    const code = String(executor.firstCall.args[0]);
    expect(code).to.include('(libname="WORK" and memname="GONE")');
  });

  it("runs nothing without datasets", async () => {
    const { client, executor } = makeClient({});
    expect((await client.getDatasetStamps([])).size).to.equal(0);
    expect(executor.called).to.equal(false);
  });
});

// ─── SasClient.getDatasetRows options ─────────────────────────────────────────

describe("SasClient.getDatasetRows options", () => {
  it("restores the user's line size and macro options", async () => {
    const { client, executor } = makeClient({});
    await client.getDatasetRows("work", "a", ["NAME"], 0, 10);
    await client.getDatasetRows("work", "a", ["NAME"], 0, 10, "AGE > 12");
    for (const call of executor.getCalls()) {
      const code = String(call.args[0]);
      expect(code).to.include("%sysfunc(getoption(ls,keyword))");
      expect(code.trimEnd()).to.match(/options notes source &_sas_opt;$/);
    }
  });
});

// ─── Rows written in chunks ──────────────────────────────────────────────────

/** Write a row to a fake log as the row emitter does: 200-character chunks, trailing blanks dropped. */
function logRow(index: number, row: string): string {
  const lines: string[] = [];
  for (let i = 0; i < row.length; i += 200) {
    lines.push(`DR${index}=|${row.slice(i, i + 200)}`.trimEnd());
  }
  return lines.join("\n");
}

describe("parseDataRows", () => {
  it("joins the chunks of wide rows, keeping blanks at chunk edges", () => {
    // Blanks fall at the end of the first chunk and the start of the second.
    const wide = `|${"a".repeat(197)} |  b|${"c".repeat(250)}|x|y`;
    const rows = parseDataRows(sentinelWrap([logRow(1, wide), logRow(2, "|1|2")].join("\n")));
    expect(rows).to.deep.equal([wide, "|1|2"]);
  });

  it("orders rows by index", () => {
    const rows = parseDataRows(sentinelWrap([logRow(10, "|j"), logRow(2, "|b")].join("\n")));
    expect(rows).to.deep.equal(["|b", "|j"]);
  });
});

describe("SasClient.getDatasetRows", () => {
  it("parses chunked rows", async () => {
    const wide = `|${"x".repeat(300)}|end`;
    const { client, executor } = makeClient({
      "~~SAS_START~~": sentinelWrap([logRow(1, wide), logRow(2, "|a|b")].join("\n")),
    });
    expect(await client.getDatasetRows("work", "a", ["X", "Y"], 0, 2)).to.deep.equal([wide, "|a|b"]);
    expect(String(executor.firstCall.args[0])).to.include("%put DR&_i=|%qsubstr(%superq(_dr&_i)");
  });
});

// ─── SasClient.openDataset ───────────────────────────────────────────────────

describe("SasClient.openDataset", () => {
  it("reads type, row count, stamp, columns and first rows in one job", async () => {
    const { client, executor } = makeClient({
      "~~SAS_START~~": sentinelWrap([
        "OPEN=DATA|2|19|2000000000|19|3",
        "COL=NAME|char|8||$8.|Name",
        "COL=AGE|num|8|||",
        "COL=HEIGHT|num|8|||",
        logRow(1, "|Alfred|14"),
        logRow(2, "|Alice|13"),
      ].join("\n")),
    });
    const opened = await client.openDataset("work", "class", { rows: 200, maxColumns: 50 });
    expect(executor.callCount).to.equal(1);
    expect(opened).to.deep.equal({
      memtype: "DATA",
      columns: [
        { name: "NAME", type: "char", length: 8, format: undefined, informat: "$8.", label: "Name" },
        { name: "AGE", type: "num", length: 8, format: undefined, informat: undefined, label: undefined },
        { name: "HEIGHT", type: "num", length: 8, format: undefined, informat: undefined, label: undefined },
      ],
      rowCount: 19,
      stamp: "2000000000|19|3",
      rows: ["|Alfred|14", "|Alice|13"],
      rowColumns: 2,
    });
  });

  it("looks the dataset up by equality and counts views", async () => {
    const { client, executor } = makeClient({});
    await client.openDataset("work", "class", { rows: 200, maxColumns: 50 });
    const code = String(executor.firstCall.args[0]);
    // upcase(libname) would scan the metadata of every library.
    expect(code).not.to.include("upcase(");
    expect(code).to.include('where libname="WORK" and memname="CLASS"');
    expect(code).to.include("&_sas_mt = VIEW");
    expect(code).to.include("count(*)");
    expect(code).to.include("set WORK.CLASS(obs=200)");
    expect(code).to.include("min(&_sas_n, 50)");
  });

  it("reports a missing dataset", async () => {
    const { client } = makeClient({ "~~SAS_START~~": sentinelWrap("OPEN=|0||") });
    const opened = await client.openDataset("work", "gone", { rows: 200, maxColumns: 50 });
    expect(opened).to.deep.include({ memtype: undefined, columns: [], rowCount: 0, stamp: undefined });
  });

  it("validates both identifiers", async () => {
    const { client } = makeClient({});
    let threw = false;
    try {
      await client.openDataset("work", "x;y", { rows: 1, maxColumns: 1 });
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});

// ─── SasClient.materializeDataset ────────────────────────────────────────────

describe("SasClient.materializeDataset", () => {
  it("builds the view table, drops old ones and returns the row count", async () => {
    const { client, executor } = makeClient({ "~~SAS_START~~": sentinelWrap("42") });
    const rows = await client.materializeDataset(
      "work", "class", "_SASDV7", "AGE > 12", "AGE desc", ["_SASDV6"],
    );
    expect(rows).to.equal(42);
    const code = String(executor.firstCall.args[0]);
    expect(code).to.include("delete _SASDV6;");
    expect(code).to.include("create table work._SASDV7 as");
    expect(code).to.include("select * from WORK.CLASS");
    expect(code).to.include("where AGE > 12");
    expect(code).to.include("order by AGE desc");
    expect(code).to.include("%let _sas_nobs=&sqlobs;");
  });

  it("validates the table names", async () => {
    const { client } = makeClient({});
    let threw = false;
    try {
      await client.materializeDataset("work", "class", "t;run", undefined, "AGE asc");
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});

// ─── Helper tables are hidden ────────────────────────────────────────────────

describe("Data Explorer view tables", () => {
  it("are recognised by name", () => {
    expect(isInternalTableName("_SASDV12")).to.be.true;
    expect(isInternalTableName("_sasdv1")).to.be.true;
    expect(isInternalTableName("CLASS")).to.be.false;
  });

  it("are hidden from WORK's members, but not other libraries'", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("MEM=CLASS|DATA\nMEM=_SASDV3|DATA"),
    });
    expect((await client.getLibraryMembers("work")).map((m) => m.name)).to.deep.equal(["CLASS"]);
    expect((await client.getLibraryMembers("mylib")).map((m) => m.name)).to.deep.equal([
      "CLASS", "_SASDV3",
    ]);
  });

  it("are hidden from the Variables pane snapshot", () => {
    const snapshot = parseSessionSnapshot(
      sentinelWrap("WT1=CLASS|DATA|19|5|2026-11-22T10:00:00|\nWT2=_SASDV3|DATA|19|5|2026-11-22T10:00:00|"),
    );
    expect(snapshot.tables.map((t) => t.name)).to.deep.equal(["CLASS"]);
  });
});

// ─── Job order ───────────────────────────────────────────────────────────────

describe("SasClient job queue", () => {
  function deferredExecutor() {
    const started: string[] = [];
    const pending: Array<() => void> = [];
    const executor = sinon.stub().callsFake((code: string) => {
      started.push(code.includes("count(*)") ? "count" : code.includes("nmiss(") ? "profile" : "other");
      return new Promise<string>((resolve) => pending.push(() => resolve("")));
    });
    const finishNext = async () => {
      pending.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { executor, started, pending, finishNext };
  }

  it("runs one job at a time", async () => {
    const { executor, pending, finishNext } = deferredExecutor();
    const client = new SasClient(executor);
    const jobs = [
      client.getDatasetRowCount("work", "a"),
      client.getDatasetRowCount("work", "b"),
      client.getDatasetRowCount("work", "c"),
    ];
    await new Promise((r) => setTimeout(r, 0));
    expect(executor.callCount).to.equal(1);
    expect(pending).to.have.length(1);
    await finishNext();
    await finishNext();
    await finishNext();
    await Promise.all(jobs);
    expect(executor.callCount).to.equal(3);
  });

  it("lets foreground jobs overtake waiting background jobs", async () => {
    const { executor, started, finishNext } = deferredExecutor();
    const client = new SasClient(executor);
    const request = {
      nullCounts: ["AGE"], numericStats: [], stringStats: [], frequencyTables: [], binning: [],
    };
    const jobs: Promise<unknown>[] = [
      client.getDatasetRowCount("work", "a"), // runs first
      client.getColumnProfileStats("work", "a", request), // background, waits
      client.getDatasetRowCount("work", "b"), // overtakes it
    ];
    for (let i = 0; i < 3; i++) {
      await finishNext();
    }
    await Promise.all(jobs);
    expect(started).to.deep.equal(["count", "count", "profile"]);
  });

  it("keeps going after a job fails", async () => {
    const executor = sinon.stub();
    executor.onFirstCall().rejects(new Error("boom"));
    executor.onSecondCall().resolves(sentinelWrap("7"));
    const client = new SasClient(executor);
    const [first, second] = await Promise.allSettled([
      client.getDatasetRowCount("work", "a"),
      client.getDatasetRowCount("work", "b"),
    ]);
    expect(first.status).to.equal("rejected");
    expect(second).to.deep.equal({ status: "fulfilled", value: 7 });
  });
});

// ─── SasClient.getColumnProfileStats ─────────────────────────────────────────

describe("SasClient.getColumnProfileStats", () => {
  it("runs every profile query in one job and parses each section", async () => {
    const { client, executor } = makeClient({
      "~~SAS_START~~": sentinelWrap([
        "NC0=3",
        "STATS0=1|90|45|44|10",
        "SS0=19|2",
        "FTT0=19",
        "FT0=2|Alice",
        "FT0=1|Bob",
        "HS0=19|11|16|12|15|0",
      ].join("\n")),
    });
    const stats = await client.getColumnProfileStats("work", "class", {
      nullCounts: ["AGE"],
      numericStats: ["AGE"],
      stringStats: ["NAME"],
      frequencyTables: [{ column: "NAME", limit: 8 }],
      binning: ["AGE"],
    }, "AGE > 12");
    expect(executor.callCount).to.equal(1);
    expect(stats).to.deep.equal({
      nullCounts: [3],
      numericStats: [{ minValue: 1, maxValue: 90, meanValue: 45, medianValue: 44, stdevValue: 10 }],
      stringStats: [{ numUnique: 19, numEmpty: 2 }],
      frequencyTables: [{ values: ["Alice", "Bob"], counts: [2, 1], otherCount: 16 }],
      binning: [{ n: 19, min: 11, max: 16, q1: 12, q3: 15, nonInteger: 0 }],
    });
    const code = String(executor.firstCall.args[0]);
    // One sentinel block, after all the steps.
    expect(code.split("%put ~~SAS_START~~").length).to.equal(2);
    expect(code.indexOf("%put ~~SAS_START~~")).to.be.greaterThan(code.indexOf("proc means"));
    expect(code.match(/where AGE > 12/g)).to.have.length(5);
  });

  it("runs nothing when nothing is asked for", async () => {
    const { client, executor } = makeClient({});
    const stats = await client.getColumnProfileStats("work", "class", {
      nullCounts: [], numericStats: [], stringStats: [], frequencyTables: [], binning: [],
    });
    expect(executor.callCount).to.equal(0);
    expect(stats.nullCounts).to.deep.equal([]);
  });
});
