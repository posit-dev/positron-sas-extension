// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect } from "chai";
import sinon from "sinon";

import { SasDataExplorer } from "../../src/positron/sasDataExplorer";
import type { SasClient } from "../../src/positron/sasClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_COLUMNS = [
  { name: "NAME", type: "char", length: 20 },
  { name: "AGE",  type: "num",  length: 8  },
  { name: "HEIGHT", type: "num", length: 8 },
];

function makeClient(overrides: Partial<SasClient> = {}): SasClient {
  return {
    getLibraryList: sinon.stub().resolves([]),
    getLibraryMembers: sinon.stub().resolves([]),
    getDatasetColumns: sinon.stub().resolves(SAMPLE_COLUMNS),
    getDatasetRowCount: sinon.stub().resolves(100),
    getDatasetRows: sinon.stub().resolves([]),
    getColumnNullCounts: sinon.stub().resolves([0, 3, 0]),
    getColumnSummaryStats: sinon.stub().resolves([
      { minValue: 1, maxValue: 90, meanValue: 45, medianValue: 44, stdevValue: 10 },
      { minValue: 100, maxValue: 200, meanValue: 150, medianValue: 148, stdevValue: 20 },
    ]),
    clearColumnCache: sinon.stub(),
    ...overrides,
  } as unknown as SasClient;
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

  it("reports unfiltered and filtered counts separately when filters are active", async () => {
    // set_row_filters triggers getState internally (2 calls: filtered + unfiltered).
    // We then call get_state explicitly (2 more calls).  Use alternating values so
    // the final explicit call returns 50 (filtered) and 100 (unfiltered).
    const rowCount = sinon.stub();
    rowCount.resolves(100); // default: unfiltered
    rowCount.withArgs("WORK", "CLASS", sinon.match.string).resolves(50); // filtered (has WHERE)
    const client = makeClient({ getDatasetRowCount: rowCount });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpc(explorer, "set_row_filters", {
      filters: [makeFilter(1, "compare", { op: ">", value: 10 })],
    });

    const { result } = await sendRpc(explorer, "get_state") as { result: Record<string, unknown> };
    const filtered = result.table_shape as Record<string, unknown>;
    const unfiltered = result.table_unfiltered_shape as Record<string, unknown>;
    expect(filtered.num_rows).to.equal(50);
    expect(unfiltered.num_rows).to.equal(100);
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

  it("passes ORDER BY clause to getDatasetRows", async () => {
    const getRows = sinon.stub().resolves([]);
    const client = makeClient({ getDatasetRows: getRows });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpc(explorer, "set_sort_columns", {
      sort_keys: [{ column_index: 1, ascending: true }],
    });
    await sendRpc(explorer, "get_data_values", {
      columns: [{ column_index: 0, spec: { first_index: 0, last_index: 4 } }],
    });

    const orderBy: string = getRows.firstCall.args[6];
    expect(orderBy).to.equal("AGE asc");
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

    return getRows.firstCall.args[5] as string | undefined;
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
    const where: string = getRows.firstCall.args[5];
    expect(where).to.include("AGE > 10");
    expect(where).to.include("HEIGHT < 200");
    expect(where).to.include("and");
  });
});

// ─── get_column_profiles ──────────────────────────────────────────────────────

describe("SasDataExplorer.get_column_profiles", () => {
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

  it("skips summary_stats for character columns", async () => {
    const getSummary = sinon.stub().resolves([]);
    const client = makeClient({ getColumnSummaryStats: getSummary });
    const explorer = new SasDataExplorer(client, "WORK", "CLASS");

    await sendRpcForEvent(explorer, "get_column_profiles", {
      callback_id: "cb-3",
      profiles: [{ column_index: 0, profiles: [{ profile_type: "summary_stats" }] }],
    });
    expect(getSummary.callCount).to.equal(0);
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
