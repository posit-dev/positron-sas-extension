// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect } from "chai";
import sinon from "sinon";

import {
  SasDataExplorer,
  computeHistogramBins,
} from "../../src/positron/sasDataExplorer";
import type { ProfileStatsRequest, SasClient } from "../../src/positron/sasClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_COLUMNS = [
  { name: "NAME", type: "char", length: 20 },
  { name: "AGE",  type: "num",  length: 8  },
  { name: "HEIGHT", type: "num", length: 8 },
];

function makeClient(overrides: Partial<SasClient> = {}): SasClient {
  const client = {
    getLibraryList: sinon.stub().resolves([]),
    getLibraryMembers: sinon.stub().resolves([]),
    getDatasetColumns: sinon.stub().resolves(SAMPLE_COLUMNS),
    getDatasetRowCount: sinon.stub().resolves(100),
    getDatasetRows: sinon.stub().resolves([]),
    openDataset: sinon.stub().resolves({
      memtype: "DATA",
      columns: SAMPLE_COLUMNS,
      rowCount: 100,
      stamp: "2000000000|100|3",
      rows: [],
      rowColumns: 0,
    }),
    materializeDataset: sinon.stub().resolves(50),
    deleteWorkTables: sinon.stub().resolves(),
    getColumnNullCounts: sinon.stub().resolves([0, 3, 0]),
    getColumnSummaryStats: sinon.stub().resolves([
      { minValue: 1, maxValue: 90, meanValue: 45, medianValue: 44, stdevValue: 10 },
      { minValue: 100, maxValue: 200, meanValue: 150, medianValue: 148, stdevValue: 20 },
    ]),
    getColumnStringStats: sinon.stub().resolves([]),
    getColumnFrequencyTables: sinon.stub().resolves([]),
    getColumnBinningStats: sinon.stub().resolves([]),
    getColumnHistogramCounts: sinon.stub().resolves([]),
    clearColumnCache: sinon.stub(),
    ...overrides,
  } as unknown as SasClient;
  // The combined profile query delegates to the single ones, so tests can
  // stub and inspect those.
  if (!overrides.getColumnProfileStats) {
    Object.assign(client, {
      getColumnProfileStats: sinon.stub().callsFake(
        async (lib: string, mem: string, request: ProfileStatsRequest, where?: string) => ({
          nullCounts: await client.getColumnNullCounts(lib, mem, request.nullCounts, where),
          numericStats: await client.getColumnSummaryStats(lib, mem, request.numericStats, where),
          stringStats: await client.getColumnStringStats(lib, mem, request.stringStats, where),
          frequencyTables: await client.getColumnFrequencyTables(
            lib, mem, request.frequencyTables, where,
          ),
          binning: await client.getColumnBinningStats(lib, mem, request.binning, where),
        }),
      ),
    });
  }
  return client;
}

/** `count` rows of SAMPLE_COLUMNS, as getDatasetRows returns them, from row `start`. */
function sampleRows(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `|N${start + i}|${start + i}|1.5`);
}

let msgCounter = 0;

function sendRpc(
  explorer: SasDataExplorer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const msgId = `msg-${++msgCounter}`;
    const sub = explorer.onDidEmitData((e) => {
      sub.dispose();
      resolve((e as { data: Record<string, unknown> }).data);
    });
    explorer.sendMessage(msgId, { method, params });
  });
}

function sendRpcForEvent(
  explorer: SasDataExplorer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const msgId = `msg-${++msgCounter}`;
    const sub = explorer.onDidEmitEvent((e) => {
      sub.dispose();
      resolve(e as Record<string, unknown>);
    });
    explorer.sendMessage(msgId, { method, params });
  });
}

/** Build a RowFilter in the correct protocol shape (column_schema nested). */
function makeFilter(
  colIdx: number,
  filterType: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    filter_type: filterType,
    column_schema: { column_index: colIdx },
    ...(params ? { params } : {}),
  };
}

// ─── get_state ────────────────────────────────────────────────────────────────

describe("SasDataExplorer.get_state", () => {
  it("returns table shape and supported features", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "get_state") as { result: Record<string, unknown> };
    const shape = result.table_shape as Record<string, unknown>;
    expect(shape.num_rows).to.equal(100);
    expect(shape.num_columns).to.equal(3);
    expect(result.display_name).to.equal("WORK.CLASS");
  });

  it("reports its title as the display name", async () => {
    const explorer = new SasDataExplorer(makeClient(), "_XPT1", "ADSL", "adsl.xpt: ADSL");
    const { result } = await sendRpc(explorer, "get_state") as { result: Record<string, unknown> };
    expect(result.display_name).to.equal("adsl.xpt: ADSL");
  });

  it("advertises column profile types as {profile_type, support_status} objects", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "get_state") as { result: Record<string, unknown> };
    const features = result.supported_features as Record<string, Record<string, unknown>>;
    const types = features.get_column_profiles.supported_types as Array<Record<string, unknown>>;
    expect(types.map((t) => t.profile_type)).to.have.members([
      "null_count", "summary_stats", "small_histogram", "large_histogram",
      "small_frequency_table", "large_frequency_table",
    ]);
    expect(types.every((t) => t.support_status === "supported")).to.be.true;
  });

  it("reports unfiltered and filtered counts separately when filters are active", async () => {
    // The filtered count comes from building the filtered view (50 rows),
    // the unfiltered one from a count (100).
    const client = makeClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpc(explorer, "set_row_filters", {
      filters: [makeFilter(1, "compare", { op: ">", value: 10 })],
    });

    const { result } = await sendRpc(explorer, "get_state") as { result: Record<string, unknown> };
    const filtered = result.table_shape as Record<string, unknown>;
    const unfiltered = result.table_unfiltered_shape as Record<string, unknown>;
    expect(filtered.num_rows).to.equal(50);
    expect(unfiltered.num_rows).to.equal(100);
    // The view is built once for both get_state calls.
    expect(client.materializeDataset).to.have.property("callCount", 1);
  });
});

// ─── get_schema ───────────────────────────────────────────────────────────────

describe("SasDataExplorer.get_schema", () => {
  it("returns all columns when no indices are specified", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "get_schema") as { result: Record<string, unknown> };
    const cols = result.columns as Array<Record<string, unknown>>;
    expect(cols).to.have.length(3);
    expect(cols[0].column_name).to.equal("NAME");
    expect(cols[0].type_display).to.equal("string"); // char → string
    expect(cols[1].column_name).to.equal("AGE");
    expect(cols[1].type_display).to.equal("floating"); // num → floating
  });

  it("returns only requested column indices", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "get_schema", {
      column_indices: [0, 2],
    }) as { result: Record<string, unknown> };
    const cols = result.columns as Array<Record<string, unknown>>;
    expect(cols).to.have.length(2);
    expect(cols[0].column_name).to.equal("NAME");
    expect(cols[1].column_name).to.equal("HEIGHT");
  });

  it("ignores out-of-bounds indices", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "get_schema", {
      column_indices: [0, 99],
    }) as { result: Record<string, unknown> };
    const cols = result.columns as Array<Record<string, unknown>>;
    expect(cols).to.have.length(1);
  });
});

// ─── set_sort_columns ─────────────────────────────────────────────────────────

describe("SasDataExplorer.set_sort_columns", () => {
  it("stores sort keys and returns updated state", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const { result } = await sendRpc(explorer, "set_sort_columns", {
      sort_keys: [
        { column_index: 1, ascending: false },
        { column_index: 0, ascending: true },
      ],
    }) as { result: Record<string, unknown> };
    const keys = result.sort_keys as Array<Record<string, unknown>>;
    expect(keys).to.have.length(2);
    expect(keys[0].column_index).to.equal(1);
    expect(keys[0].ascending).to.equal(false);
  });

  it("reads pages from a view built once with the ORDER BY clause", async () => {
    const getRows = sinon.stub().callsFake(
      async (_lib, _mem, _cols, start: number, n: number) =>
        sampleRows(start, Math.max(0, Math.min(n, 1000 - start))),
    );
    const materialize = sinon.stub().resolves(1000);
    const client = makeClient({ getDatasetRows: getRows, materializeDataset: materialize });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpc(explorer, "set_sort_columns", {
      sort_keys: [{ column_index: 1, ascending: true }],
    });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 0, last_index: 4 } }],
    });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 500, last_index: 504 } }],
    });

    expect(materialize.callCount).to.equal(1);
    const [lib, mem, table, where, orderBy] = materialize.firstCall.args;
    expect([lib, mem, where, orderBy]).to.deep.equal(["WORK", "CLASS", undefined, "AGE asc"]);
    expect(table).to.match(/^_SASDV\d+$/);
    // Pages are read from the view, without sorting again.
    for (const call of getRows.getCalls()) {
      expect(call.args.slice(0, 2)).to.deep.equal(["WORK", table]);
      expect(call.args[5]).to.be.undefined;
      expect(call.args[6]).to.be.undefined;
    }
  });

  it("deletes the old view when the sort changes", async () => {
    const materialize = sinon.stub().resolves(100);
    const getRows = sinon.stub().callsFake(
      async (_lib, _mem, _cols, start: number, n: number) =>
        sampleRows(start, Math.max(0, Math.min(n, 100 - start))),
    );
    const client = makeClient({ materializeDataset: materialize, getDatasetRows: getRows });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    const page = { columns: [{ column_index: 0, spec: { first_index: 0, last_index: 4 } }] };

    await sendRpc(explorer, "set_sort_columns", { sort_keys: [{ column_index: 1, ascending: true }] });
    await sendRpc(explorer, "get_data_values", page);
    await sendRpc(explorer, "set_sort_columns", { sort_keys: [{ column_index: 1, ascending: false }] });
    await sendRpc(explorer, "get_data_values", page);

    expect(materialize.callCount).to.equal(2);
    const first = materialize.firstCall.args[2];
    expect(materialize.secondCall.args[4]).to.equal("AGE desc");
    expect(materialize.secondCall.args[5]).to.deep.equal([first]);
  });
});

// ─── set_row_filters / buildWhereClause ───────────────────────────────────────

describe("SasDataExplorer filter → WHERE clause", () => {
  async function getWhereClause(
    filter: Record<string, unknown>,
  ): Promise<string | undefined> {
    const getRows = sinon.stub().resolves([]);
    const client = makeClient({ getDatasetRows: getRows });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpc(explorer, "set_row_filters", { filters: [filter] });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 0, last_index: 0 } }],
    });

    // The filter goes into the view the rows are read from.
    const materialize = client.materializeDataset as sinon.SinonStub;
    return materialize.firstCall?.args[3] as string | undefined;
  }

  it("compare: numeric >", async () => {
    expect(await getWhereClause(makeFilter(1, "compare", { op: ">", value: 18 })))
      .to.equal("AGE > 18");
  });

  it("compare: string =", async () => {
    expect(await getWhereClause(makeFilter(0, "compare", { op: "=", value: "Alice" })))
      .to.equal("NAME = 'Alice'");
  });

  it("between: numeric", async () => {
    expect(await getWhereClause(makeFilter(1, "between", { left_value: 10, right_value: 20 })))
      .to.equal("AGE between 10 and 20");
  });

  it("not_between", async () => {
    expect(await getWhereClause(makeFilter(1, "not_between", { left_value: 10, right_value: 20 })))
      .to.equal("AGE not between 10 and 20");
  });

  it("is_null", async () => {
    expect(await getWhereClause(makeFilter(1, "is_null")))
      .to.equal("missing(AGE)");
  });

  it("not_null", async () => {
    expect(await getWhereClause(makeFilter(1, "not_null")))
      .to.equal("not missing(AGE)");
  });

  it("is_empty (char column)", async () => {
    expect(await getWhereClause(makeFilter(0, "is_empty")))
      .to.equal("NAME = ''");
  });

  it("not_empty (char column)", async () => {
    expect(await getWhereClause(makeFilter(0, "not_empty")))
      .to.equal("NAME ne ''");
  });

  it("is_true / is_false (numeric)", async () => {
    expect(await getWhereClause(makeFilter(1, "is_true"))).to.equal("AGE = 1");
    expect(await getWhereClause(makeFilter(1, "is_false"))).to.equal("AGE = 0");
  });

  it("search: contains (case-insensitive)", async () => {
    expect(await getWhereClause(makeFilter(0, "search",
      { term: "alice", search_type: "contains", case_sensitive: false })))
      .to.equal("upcase(NAME) contains 'ALICE'");
  });

  it("search: starts_with", async () => {
    expect(await getWhereClause(makeFilter(0, "search",
      { term: "Al", search_type: "starts_with", case_sensitive: true })))
      .to.equal("NAME like 'Al%' escape '\\'");
  });

  it("search: ends_with", async () => {
    expect(await getWhereClause(makeFilter(0, "search",
      { term: "ice", search_type: "ends_with", case_sensitive: true })))
      .to.equal("NAME like '%ice' escape '\\'");
  });

  it("search: regex_match", async () => {
    expect(await getWhereClause(makeFilter(0, "search",
      { term: "^Al", search_type: "regex_match", case_sensitive: true })))
      .to.equal("prxmatch('/^Al/', NAME) > 0");
  });

  it("set_membership: inclusive", async () => {
    expect(await getWhereClause(makeFilter(1, "set_membership",
      { values: [1, 2, 3], inclusive: true })))
      .to.equal("AGE in (1, 2, 3)");
  });

  it("set_membership: exclusive", async () => {
    expect(await getWhereClause(makeFilter(1, "set_membership",
      { values: [99], inclusive: false })))
      .to.equal("AGE not in (99)");
  });

  it("ignores a filter with invalid op (SQL injection guard)", async () => {
    const getRows = sinon.stub().resolves([]);
    const client = makeClient({ getDatasetRows: getRows });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await sendRpc(explorer, "set_row_filters", {
      filters: [makeFilter(1, "compare", { op: "DROP TABLE", value: 1 })],
    });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 0, last_index: 0 } }],
    });
    expect(getRows.firstCall.args[5]).to.be.undefined;
  });

  it("chains multiple filters with AND", async () => {
    const getRows = sinon.stub().resolves([]);
    const client = makeClient({ getDatasetRows: getRows });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await sendRpc(explorer, "set_row_filters", {
      filters: [
        makeFilter(1, "compare", { op: ">", value: 10 }),
        makeFilter(2, "compare", { op: "<", value: 200 }),
      ],
    });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 0, last_index: 0 } }],
    });
    const where: string = (client.materializeDataset as sinon.SinonStub).firstCall.args[3];
    expect(where).to.include("AGE > 10");
    expect(where).to.include("HEIGHT < 200");
    expect(where).to.include("and");
  });
});

// ─── get_column_profiles ──────────────────────────────────────────────────────

describe("SasDataExplorer.get_column_profiles", () => {
  it("runs the profile queries as one background job, then the histogram counts", async () => {
    const client = makeClient({
      getColumnBinningStats: sinon.stub().resolves([{ n: 5, min: 1, max: 9, q1: 2, q3: 7, nonInteger: 0 }]),
    });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-seq",
      profiles: [
        { column_index: 0, profiles: [{ profile_type: "null_count" }, { profile_type: "small_frequency_table", params: { limit: 8 } }] },
        { column_index: 1, profiles: [{ profile_type: "summary_stats" }, { profile_type: "small_histogram", params: { num_bins: 80 } }] },
      ],
    });
    const combined = client.getColumnProfileStats as sinon.SinonStub;
    expect(combined.callCount).to.equal(1);
    expect(combined.firstCall.args[2]).to.deep.equal({
      nullCounts: ["NAME"],
      numericStats: ["AGE"],
      stringStats: [],
      frequencyTables: [{ column: "NAME", limit: 8 }],
      binning: ["AGE"],
    });
    const counts = client.getColumnHistogramCounts as sinon.SinonStub;
    expect(counts.callCount).to.equal(1);
    expect(counts.firstCall.args[4]).to.equal("background");
  });

  it("fires return_column_profiles event with null counts", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-1",
      profiles: [
        { column_index: 0, profiles: [{ profile_type: "null_count" }] },
        { column_index: 1, profiles: [{ profile_type: "null_count" }] },
      ],
    }) as Record<string, unknown>;

    expect(event.method).to.equal("return_column_profiles");
    const p = event.params as Record<string, unknown>;
    expect(p.callback_id).to.equal("cb-1");
    const profiles = p.profiles as Array<Record<string, unknown>>;
    expect(profiles[0].null_count).to.equal(0);
    expect(profiles[1].null_count).to.equal(3);
  });

  it("fires return_column_profiles with summary_stats for numeric columns", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-2",
      profiles: [{ column_index: 1, profiles: [{ profile_type: "summary_stats" }] }],
    }) as Record<string, unknown>;

    const p = event.params as Record<string, unknown>;
    const profiles = p.profiles as Array<Record<string, unknown>>;
    const stats = profiles[0].summary_stats as Record<string, unknown>;
    expect(stats).to.exist;
    const nums = stats.number_stats as Record<string, unknown>;
    expect(nums.min_value).to.equal("1");
    expect(nums.max_value).to.equal("90");
  });

  it("returns string_stats for character columns", async () => {
    const getSummary = sinon.stub().resolves([]);
    const getStringStats = sinon.stub().resolves([{ numUnique: 19, numEmpty: 2 }]);
    const client = makeClient({ getColumnSummaryStats: getSummary, getColumnStringStats: getStringStats });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-3",
      profiles: [{ column_index: 0, profiles: [{ profile_type: "summary_stats" }] }],
    });
    expect(getSummary.firstCall.args[2]).to.deep.equal([]);
    expect(getStringStats.firstCall.args[2]).to.deep.equal(["NAME"]);
    const profiles = (event.params as Record<string, unknown>).profiles as Array<Record<string, unknown>>;
    expect(profiles[0].summary_stats).to.deep.equal({
      type_display: "string",
      string_stats: { num_empty: 2, num_unique: 19 },
    });
  });

  it("returns small and large histograms for a numeric column", async () => {
    const getBinningStats = sinon.stub().resolves([
      { n: 19, min: 11, max: 16, q1: 12, q3: 15, nonInteger: 0 },
    ]);
    const getCounts = sinon.stub().callsFake(async (_lib, _mem, requests) =>
      requests.map((r: { bins: { nbins: number } }) => new Array(r.bins.nbins).fill(1)),
    );
    const client = makeClient({ getColumnBinningStats: getBinningStats, getColumnHistogramCounts: getCounts });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-h",
      profiles: [{
        column_index: 1,
        profiles: [
          { profile_type: "small_histogram", params: { method: "freedman_diaconis", num_bins: 80 } },
          { profile_type: "large_histogram", params: { method: "freedman_diaconis", num_bins: 200 } },
        ],
      }],
    });

    // Binning stats are fetched once for both histograms.
    expect(getBinningStats.callCount).to.equal(1);
    expect(getBinningStats.firstCall.args[2]).to.deep.equal(["AGE"]);
    const profile = ((event.params as Record<string, unknown>).profiles as Array<Record<string, unknown>>)[0];
    const small = profile.small_histogram as { bin_edges: string[]; bin_counts: number[]; quantiles: unknown[] };
    expect(small.bin_edges[0]).to.equal("11");
    expect(small.bin_edges[small.bin_edges.length - 1]).to.equal("16");
    expect(small.bin_counts).to.have.length(small.bin_edges.length - 1);
    expect(small.quantiles).to.deep.equal([]);
    expect(profile.large_histogram).to.exist;
  });

  it("returns one bin holding every value for a constant column", async () => {
    const client = makeClient({
      getColumnBinningStats: sinon.stub().resolves([{ n: 7, min: 3, max: 3, q1: 3, q3: 3, nonInteger: 0 }]),
      getColumnHistogramCounts: sinon.stub().resolves([[0]]),
    });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-c",
      profiles: [{ column_index: 2, profiles: [{ profile_type: "small_histogram", params: { num_bins: 80 } }] }],
    });
    const profile = ((event.params as Record<string, unknown>).profiles as Array<Record<string, unknown>>)[0];
    expect(profile.small_histogram).to.deep.equal({ bin_edges: ["3", "3"], bin_counts: [7], quantiles: [] });
  });

  it("returns frequency tables for a character column", async () => {
    const getFreq = sinon.stub().resolves([
      { values: ["Alfred", "Alice"], counts: [1, 1], otherCount: 17 },
    ]);
    const explorer = new SasDataExplorer(makeClient({ getColumnFrequencyTables: getFreq }), "WORK", "CLASS");
    const event = await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-f",
      profiles: [{ column_index: 0, profiles: [{ profile_type: "small_frequency_table", params: { limit: 8 } }] }],
    });
    expect(getFreq.firstCall.args[2]).to.deep.equal([{ column: "NAME", limit: 8 }]);
    const profile = ((event.params as Record<string, unknown>).profiles as Array<Record<string, unknown>>)[0];
    expect(profile.small_frequency_table).to.deep.equal({
      values: ["Alfred", "Alice"], counts: [1, 1], other_count: 17,
    });
  });

  it("passes the active row filter to every profile query", async () => {
    const client = makeClient({
      getColumnBinningStats: sinon.stub().resolves([{ n: 5, min: 1, max: 9, q1: 2, q3: 7, nonInteger: 0 }]),
    });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await sendRpc(explorer, "set_row_filters", {
      filters: [{
        filter_type: "compare",
        column_schema: { column_index: 1 },
        params: { op: ">", value: "12" },
      }],
    });
    await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-w",
      profiles: [{
        column_index: 1,
        profiles: [
          { profile_type: "null_count" },
          { profile_type: "small_histogram", params: { num_bins: 80 } },
        ],
      }],
    });
    for (const stub of ["getColumnNullCounts", "getColumnBinningStats", "getColumnHistogramCounts"] as const) {
      expect((client[stub] as sinon.SinonStub).lastCall.args[3], stub).to.equal("AGE > 12");
    }
  });

  it("returns {} as RPC result immediately (fire-and-forget pattern)", async () => {
    const explorer = new SasDataExplorer(makeClient(), "WORK", "CLASS");
    const rpcReply = await sendRpc(explorer, "get_column_profiles", {
      callback_id: "cb-4",
      profiles: [],
    });
    expect(rpcReply.result).to.deep.equal({});
  });
});

// ─── computeHistogramBins ─────────────────────────────────────────────────────

describe("computeHistogramBins", () => {
  const stats = (o: Partial<{ n: number; min: number | null; max: number | null; q1: number | null; q3: number | null; nonInteger: number }>) => ({
    n: 100, min: 0, max: 10, q1: 2.5, q3: 7.5, nonInteger: 100, ...o,
  });

  it("uses the Freedman-Diaconis width", () => {
    // width = 2 * 5 / cbrt(1000) = 1  →  10 bins over [0, 10]
    const bins = computeHistogramBins(stats({ n: 1000 }), 80);
    expect(bins.nbins).to.equal(10);
    expect(bins.width).to.equal(1);
    expect(bins.edges).to.have.length(11);
    expect(bins.edges[0]).to.equal(0);
    expect(bins.edges[10]).to.equal(10);
  });

  it("caps the number of bins at num_bins", () => {
    const bins = computeHistogramBins(stats({ n: 1e6, max: 1000 }), 80);
    expect(bins.nbins).to.equal(80);
  });

  it("falls back to Sturges when the IQR is 0", () => {
    const bins = computeHistogramBins(stats({ n: 64, q1: 5, q3: 5 }), 80);
    expect(bins.nbins).to.equal(7); // ceil(log2(64)) + 1
  });

  it("uses one [v, v] bin for a constant column", () => {
    expect(computeHistogramBins(stats({ min: 4, max: 4 }), 80)).to.deep.equal({
      lo: 4, width: 0, nbins: 1, edges: [4, 4],
    });
  });

  it("uses no more bins than distinct integers for integer columns", () => {
    // FD would ask for 1000 * 5 / ... bins; integers 0..4 need at most 5.
    const bins = computeHistogramBins(stats({ n: 1e6, max: 4, q1: 1, q3: 3, nonInteger: 0 }), 80);
    expect(bins.nbins).to.equal(5);
  });

  it("returns an empty histogram when there are no values", () => {
    expect(computeHistogramBins(stats({ n: 0, min: null, max: null }), 80).nbins).to.equal(0);
  });
});

// ─── labels and refresh ───────────────────────────────────────────────────────

describe("SasDataExplorer labels and refresh", () => {
  it("sends column labels", async () => {
    const explorer = new SasDataExplorer(
      makeClient({
        getDatasetColumns: sinon.stub().resolves([
          { name: "AGE", type: "num", length: 8, label: "Age in years" },
          { name: "NAME", type: "char", length: 8 },
        ]),
      }),
      "WORK",
      "CLASS",
    );
    const { result } = (await sendRpc(explorer, "get_schema")) as {
      result: { columns: Array<{ column_label?: string }> };
    };
    expect(result.columns.map((c) => c.column_label)).to.deep.equal([
      "Age in years",
      undefined,
    ]);
  });

  it("sends data_update when only the rows changed", async () => {
    const client = makeClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();
    const events: unknown[] = [];
    explorer.onDidEmitEvent((e) => events.push(e));
    await explorer.refresh();
    expect(events).to.deep.equal([{ method: "data_update", params: {} }]);
    // The row count is read again.
    await sendRpc(explorer, "get_state");
    expect(client.getDatasetRowCount).to.have.property("callCount", 1);
  });

  it("sends schema_update and drops sorts when the columns changed", async () => {
    const getDatasetColumns = sinon.stub().resolves(SAMPLE_COLUMNS);
    const explorer = new SasDataExplorer(
      makeClient({ getDatasetColumns }),
      "WORK",
      "CLASS",
    );
    await explorer.warmUp();
    await sendRpc(explorer, "set_sort_columns", {
      sort_keys: [{ column_index: 2, ascending: true }],
    });
    getDatasetColumns.resolves(SAMPLE_COLUMNS.slice(0, 2));
    const events: unknown[] = [];
    explorer.onDidEmitEvent((e) => events.push(e));
    await explorer.refresh();
    expect(events).to.deep.equal([{ method: "schema_update", params: {} }]);
    const { result } = (await sendRpc(explorer, "get_state")) as {
      result: { sort_keys: unknown[]; table_shape: { num_columns: number } };
    };
    expect(result.sort_keys).to.deep.equal([]);
    expect(result.table_shape.num_columns).to.equal(2);
  });

  it("does nothing when the dataset is gone", async () => {
    const getDatasetColumns = sinon.stub().resolves(SAMPLE_COLUMNS);
    const explorer = new SasDataExplorer(
      makeClient({ getDatasetColumns }),
      "WORK",
      "CLASS",
    );
    await explorer.warmUp();
    getDatasetColumns.resolves([]);
    const events: unknown[] = [];
    explorer.onDidEmitEvent((e) => events.push(e));
    await explorer.refresh();
    expect(events).to.deep.equal([]);
  });
});

// ─── opening and the row cache ────────────────────────────────────────────────

describe("SasDataExplorer opening and row cache", () => {
  function openedClient(rowCount = 1000, overrides: Partial<SasClient> = {}) {
    const getRows = sinon.stub().callsFake(
      async (_lib, _mem, cols: string[], start: number, n: number) =>
        sampleRows(start, Math.max(0, Math.min(n, rowCount - start))).map((row) =>
          // Only the requested columns, in order.
          "|" + cols.map((c) => row.split("|")[1 + SAMPLE_COLUMNS.findIndex((s) => s.name === c)]).join("|"),
        ),
    );
    return makeClient({
      openDataset: sinon.stub().resolves({
        memtype: "DATA",
        columns: SAMPLE_COLUMNS,
        rowCount,
        stamp: "2000000000|1000|3",
        rows: sampleRows(0, Math.min(200, rowCount)),
        rowColumns: 3,
      }),
      getDatasetRows: getRows,
      ...overrides,
    });
  }

  const page = (first: number, last: number, columns = [0, 1, 2]) => ({
    columns: columns.map((column_index) => ({
      column_index,
      spec: { first_index: first, last_index: last },
    })),
  });

  it("reads columns, row count, stamp and first rows in one job", async () => {
    const client = openedClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();

    expect(client.openDataset).to.have.property("callCount", 1);
    expect((client.openDataset as sinon.SinonStub).firstCall.args).to.deep.equal([
      "WORK", "CLASS", { rows: 200, maxColumns: 50 },
    ]);
    expect(explorer.stamp).to.equal("2000000000|1000|3");

    const { result: state } = (await sendRpc(explorer, "get_state")) as {
      result: { table_shape: { num_rows: number } };
    };
    expect(state.table_shape.num_rows).to.equal(1000);
    const { result } = (await sendRpc(explorer, "get_data_values", page(0, 2))) as {
      result: { columns: unknown[][]; row_labels: string[][] };
    };
    expect(result.columns).to.deep.equal([["N0", "N1", "N2"], ["0", "1", "2"], ["1.5", "1.5", "1.5"]]);
    expect(result.row_labels).to.deep.equal([["0"], ["1"], ["2"]]);
    // Everything came from the opening job.
    for (const stub of ["getDatasetColumns", "getDatasetRowCount", "getDatasetRows"] as const) {
      expect(client[stub], stub).to.have.property("callCount", 0);
    }
  });

  it("fetches only the missing block, once", async () => {
    const client = openedClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();

    const { result } = (await sendRpc(explorer, "get_data_values", page(195, 204))) as {
      result: { columns: unknown[][] };
    };
    expect(result.columns[1]).to.deep.equal(
      Array.from({ length: 10 }, (_, i) => String(195 + i)),
    );
    await sendRpc(explorer, "get_data_values", page(250, 260));

    const getRows = client.getDatasetRows as sinon.SinonStub;
    expect(getRows.callCount).to.equal(1);
    expect(getRows.firstCall.args.slice(0, 5)).to.deep.equal([
      "WORK", "CLASS", ["NAME", "AGE", "HEIGHT"], 200, 200,
    ]);
  });

  it("reads concurrent requests for the same rows once", async () => {
    const client = openedClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await Promise.all([
      sendRpc(explorer, "get_data_values", page(400, 450)),
      sendRpc(explorer, "get_data_values", page(400, 450)),
    ]);
    expect(client.getDatasetRows).to.have.property("callCount", 1);
  });

  it("stops at the end of the table", async () => {
    const client = openedClient(5);
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();
    const { result } = (await sendRpc(explorer, "get_data_values", page(0, 99, [1]))) as {
      result: { columns: unknown[][]; row_labels: string[][] };
    };
    expect(result.columns[0]).to.deep.equal(["0", "1", "2", "3", "4"]);
    expect(result.row_labels).to.have.length(5);
    expect(client.getDatasetRows).to.have.property("callCount", 0);
  });

  it("re-reads rows after a refresh", async () => {
    const client = openedClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();
    await explorer.refresh();
    await sendRpc(explorer, "get_data_values", page(0, 2));
    expect(client.getDatasetRows).to.have.property("callCount", 1);
  });

  it("doesn't cache a short first block of a longer table", async () => {
    // Fewer rows than expected came back: don't mistake that for the end.
    const client = openedClient(1000, {
      openDataset: sinon.stub().resolves({
        memtype: "DATA", columns: SAMPLE_COLUMNS, rowCount: 1000, stamp: "s",
        rows: sampleRows(0, 10), rowColumns: 3,
      }),
    });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();
    await sendRpc(explorer, "get_data_values", page(0, 2));
    expect(client.getDatasetRows).to.have.property("callCount", 1);
  });

  it("deletes its view table on dispose", async () => {
    const client = openedClient();
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");
    await explorer.warmUp();
    await sendRpc(explorer, "set_sort_columns", { sort_keys: [{ column_index: 1, ascending: false }] });
    await sendRpc(explorer, "get_data_values", page(0, 2));
    const table = (client.materializeDataset as sinon.SinonStub).firstCall.args[2];
    explorer.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect((client.deleteWorkTables as sinon.SinonStub).firstCall.args[0]).to.deep.equal([table]);
  });
});
