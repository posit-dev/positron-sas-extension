// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import { SasClient, sasIdent } from "../../src/positron/sasClient";

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
        "COL=NAME|char|20|$\nCOL=AGE|num|8|BEST12.",
      ),
    });
    const cols = await client.getDatasetColumns("work", "class");
    expect(cols).to.deep.equal([
      { name: "NAME", type: "char", length: 20, format: "$" },
      { name: "AGE", type: "num", length: 8, format: "BEST12." },
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
