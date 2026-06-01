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
  it("returns library names parsed from pipe-delimited output", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("WORK|SASHELP|SASUSER"),
    });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal(["WORK", "SASHELP", "SASUSER"]);
  });

  it("returns empty array when output has no sentinel", async () => {
    const { client } = makeClient({ "~~SAS_START~~": "some noise\nno markers" });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal([]);
  });

  it("filters empty tokens", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("WORK||SASHELP"),
    });
    const libs = await client.getLibraryList();
    expect(libs).to.deep.equal(["WORK", "SASHELP"]);
  });
});

// ─── SasClient.getLibraryMembers ──────────────────────────────────────────────

describe("SasClient.getLibraryMembers", () => {
  it("returns members with type", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("CLASS|CARS\nDATA|DATA"),
    });
    const members = await client.getLibraryMembers("sashelp");
    expect(members).to.deep.equal([
      { name: "CLASS", type: "DATA" },
      { name: "CARS", type: "DATA" },
    ]);
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

  it("returns empty array when sentinel block has fewer than 2 lines", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("CLASS"),
    });
    const members = await client.getLibraryMembers("work");
    expect(members).to.deep.equal([]);
  });
});

// ─── SasClient.getDatasetColumns ──────────────────────────────────────────────

describe("SasClient.getDatasetColumns", () => {
  it("returns parsed column metadata", async () => {
    const { client } = makeClient({
      "~~SAS_START~~": sentinelWrap("NAME|AGE\nchar|num\n20|8\n$|BEST12."),
    });
    const cols = await client.getDatasetColumns("work", "class");
    expect(cols).to.deep.equal([
      { name: "NAME", type: "char", length: 20, format: "$" },
      { name: "AGE", type: "num", length: 8, format: "BEST12." },
    ]);
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
    const executor = sinon.stub().resolves(sentinelWrap("ID\nnum\n8\n"));
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
      "~~SAS_START~~": sentinelWrap("X\nnum\n8\n"),
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
    const executor = sinon.stub().resolves(
      sentinelWrap("NC_NAME=0\nNC_AGE=3"),
    );
    const client = new SasClient(executor);
    const counts = await client.getColumnNullCounts("work", "class", ["NAME", "AGE"]);
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
    const executor = sinon.stub().resolves(sentinelWrap("NC_NAME=2"));
    const client = new SasClient(executor);
    const counts = await client.getColumnNullCounts("work", "t", ["NAME", "AGE"]);
    expect(counts).to.deep.equal([2, 0]);
  });
});

// ─── SasClient.getColumnSummaryStats ──────────────────────────────────────────

describe("SasClient.getColumnSummaryStats", () => {
  it("parses min/max/mean/median/stdev", async () => {
    const executor = sinon.stub().resolves(
      sentinelWrap("STATS_AGE=5|90|47.5|45|20.3"),
    );
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
    const executor = sinon.stub().resolves(
      sentinelWrap("STATS_X=.|.|.|.|."),
    );
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
