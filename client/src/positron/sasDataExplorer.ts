// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";
import { DATA_VIEW_PREFIX } from "./sasClient";
import type {
  BinningStats,
  ColumnInfo,
  HistogramBins,
  SasClient,
} from "./sasClient";

/**
 * Rows are read from SAS and cached in blocks of this many. Each row read
 * is a line in the SAS log, which has to come back to Positron, so blocks
 * about the size of the grid's requests keep a scroll to a far row quick.
 */
export const BLOCK_ROWS = 50;
/**
 * The first rows read, on opening and after a sort or filter, include at
 * most this many columns, as Positron asks for all columns soon after.
 */
export const PREFETCH_COLUMNS = 50;
/** Most blocks kept per explorer; the least recently used go first. */
const MAX_BLOCKS = 200;

/** Numbers the WORK tables that hold sorted or filtered views. */
let viewCounter = 0;

interface MaterializedView {
  table: string;
  rows: number;
}

/**
 * A view table being built, or built, for one sort and filter. When the
 * build fails, rows keep coming from the dataset for that sort and filter.
 */
interface ViewEntry {
  key: string;
  promise: Promise<MaterializedView>;
  /** Set once the table exists. */
  result?: MaterializedView;
}

/** Identifies a sort and filter, so a view table is built once for each. */
function viewKey(where?: string, orderBy?: string): string {
  return `${where ?? ""}\u0000${orderBy ?? ""}`;
}

// SAS date formats (stored as days since 1960-01-01)
const DATE_FORMATS = new Set([
  "DATE", "DDMMYY", "MMDDYY", "YYMMDD", "MONYY", "YYMM", "YYMON",
  "YYQ", "JULDAY", "JULIAN", "WEEKDATE", "WORDDATE", "WORDDATX",
]);

// SAS datetime formats (stored as seconds since 1960-01-01 00:00:00)
const DATETIME_FORMATS = new Set(["DATETIME", "DATEAMPM"]);

/**
 * Map a SAS column type and format to a Positron type_display string.
 * Positron's filter UI is driven by this value — the exact strings must
 * match the ColumnDisplayType enum in the data explorer protocol:
 *   "floating"  → numeric filters (=, >, between, etc.)
 *   "integer"   → numeric filters
 *   "string"    → string filters (contains, starts_with, regex, etc.)
 *   "date"      → date-range filters
 *   "datetime"  → datetime-range filters
 */
function sasColumnDisplayType(type: string, format: string): string {
  if (type.toLowerCase() === "char") {
    return "string";
  }
  // Strip trailing width/decimal spec, e.g. "DATE9." → "DATE"
  const fmtName = format.replace(/[\d.]+$/, "").toUpperCase();
  if (DATE_FORMATS.has(fmtName)) {
    return "date";
  }
  if (DATETIME_FORMATS.has(fmtName)) {
    return "datetime";
  }
  return "floating";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (v): v is Record<string, unknown> => typeof v === "object" && v !== null,
  );
}

// ─── Histogram binning ──────────────────────────────────────────────────────

/**
 * Choose histogram bins the way Positron's Python backend does for the
 * "freedman_diaconis" method: Freedman–Diaconis width capped at `numBins`
 * bins, Sturges when the IQR is 0, a single [v, v] bin for a constant column,
 * and no more bins than distinct integers for integer-valued columns.
 */
export function computeHistogramBins(
  stats: BinningStats,
  numBins: number,
): HistogramBins & { edges: number[] } {
  const { n, min, max, q1, q3, nonInteger } = stats;
  if (n <= 0 || min === null || max === null) {
    return { lo: 0, width: 0, nbins: 0, edges: [] };
  }
  if (min === max) {
    return { lo: min, width: 0, nbins: 1, edges: [min, max] };
  }
  const range = max - min;
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : 0;
  let nbins =
    iqr > 0
      ? Math.ceil(range / ((2 * iqr) / Math.cbrt(n)))
      : Math.ceil(Math.log2(n)) + 1;
  nbins = Math.max(1, Math.min(nbins, Math.max(1, Math.floor(numBins))));
  if (nonInteger === 0 && nbins > range) {
    nbins = Math.max(1, Math.min(Math.floor(range) + 1, Math.floor(numBins)));
  }
  const width = range / nbins;
  const edges = Array.from({ length: nbins + 1 }, (_, k) =>
    k === nbins ? max : min + k * width,
  );
  return { lo: min, width, nbins, edges };
}

const formatEdge = (value: number) => String(Number(value.toPrecision(10)));

const COLUMN_PROFILE_TYPES = [
  "null_count",
  "summary_stats",
  "small_histogram",
  "large_histogram",
  "small_frequency_table",
  "large_frequency_table",
];

// ─── Types for Positron Data Explorer protocol ──────────────────────────────

interface RowFilter {
  filter_type: string;
  column_schema: { column_index: number; column_name?: string };
  condition?: string;
  params?: Record<string, unknown>;
}

interface SortKey {
  column_index: number;
  ascending: boolean;
}

export interface DataExplorerEmitData {
  messageId: string;
  data: object;
}

// ─── Filter SQL generation ───────────────────────────────────────────────────

const VALID_OPS = new Set(["=", "!=", "<>", "<", "<=", ">", ">=",
  "eq", "ne", "lt", "le", "gt", "ge"]);

function formatValue(value: unknown, isNum: boolean): string | undefined {
  if (isNum) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function filterToCondition(
  filter: RowFilter,
  colName: string,
  isNum: boolean,
): string | undefined {
  const p = filter.params ?? {};
  switch (filter.filter_type) {
    case "compare": {
      const op = typeof p.op === "string" ? p.op.toLowerCase() : undefined;
      if (!op || !VALID_OPS.has(op)) {
        return undefined;
      }
      const val = formatValue(p.value, isNum);
      return val !== undefined ? `${colName} ${op} ${val}` : undefined;
    }
    case "between": {
      const left = formatValue(p.left_value, isNum);
      const right = formatValue(p.right_value, isNum);
      return left !== undefined && right !== undefined
        ? `${colName} between ${left} and ${right}`
        : undefined;
    }
    case "not_between": {
      const left = formatValue(p.left_value, isNum);
      const right = formatValue(p.right_value, isNum);
      return left !== undefined && right !== undefined
        ? `${colName} not between ${left} and ${right}`
        : undefined;
    }
    case "is_null":
      return `missing(${colName})`;
    case "not_null":
      return `not missing(${colName})`;
    case "is_empty":
      return `${colName} = ''`;
    case "not_empty":
      return `${colName} ne ''`;
    case "is_true":
      return `${colName} = 1`;
    case "is_false":
      return `${colName} = 0`;
    case "search": {
      const term = typeof p.term === "string" ? p.term : "";
      const ci = p.case_sensitive !== true;
      const col = ci ? `upcase(${colName})` : colName;
      const escaped = (ci ? term.toUpperCase() : term).replace(/'/g, "''");
      const likeEscaped = escaped.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      switch (p.search_type) {
        case "contains":
          return `${col} contains '${escaped}'`;
        case "not_contains":
          return `${col} not contains '${escaped}'`;
        case "starts_with":
          return `${col} like '${likeEscaped}%' escape '\\'`;
        case "ends_with":
          return `${col} like '%${likeEscaped}' escape '\\'`;
        case "regex_match": {
          const rxTerm = term.replace(/'/g, "''").replace(/\//g, "\\/");
          const flags = ci ? "i" : "";
          return `prxmatch('/${rxTerm}/${flags}', ${colName}) > 0`;
        }
        default:
          return `${col} contains '${escaped}'`;
      }
    }
    case "set_membership": {
      const values = Array.isArray(p.values) ? p.values : [];
      if (values.length === 0) {
        return undefined;
      }
      const formatted = values.map((v) => formatValue(v, isNum));
      if (formatted.some((v) => v === undefined)) {
        return undefined;
      }
      const op = p.inclusive === false ? "not in" : "in";
      return `${colName} ${op} (${formatted.join(", ")})`;
    }
    default:
      return undefined;
  }
}

// ─── SasDataExplorer ─────────────────────────────────────────────────────────

/**
 * Handles the Positron Data Explorer comm for a single SAS dataset.
 *
 * Translates JSON-RPC requests (get_state, get_schema, get_data_values, etc.)
 * into SAS queries via SasClient and emits responses and frontend events via
 * the onDidEmitData / onDidEmitEvent events.
 */
/** Whether two column lists have the same names, types, formats and labels. */
function sameColumns(
  a: ColumnInfo[] | undefined,
  b: ColumnInfo[],
): boolean {
  const key = (c: ColumnInfo) =>
    [c.name.toUpperCase(), c.type, c.format ?? "", c.label ?? ""].join("\u0000");
  return a !== undefined && a.length === b.length && a.every((c, i) => key(c) === key(b[i]));
}

export class SasDataExplorer {
  readonly id = uuidv4();

  private readonly emitter = new EventEmitter<DataExplorerEmitData>();
  readonly onDidEmitData = this.emitter.event;

  private readonly eventEmitter = new EventEmitter<object>();
  readonly onDidEmitEvent = this.eventEmitter.event;

  private sortKeys: SortKey[] = [];
  private rowFilters: RowFilter[] = [];
  private columns: ColumnInfo[] | undefined;
  private unfilteredRowCount: number | undefined;

  /** The dataset's change stamp when it was opened (see SasClient.getDatasetStamps). */
  stamp: string | undefined;

  /** Raw cell values by block and column index, in least recently used order. */
  private readonly blocks = new Map<number, Map<number, string[]>>();
  /** Bumped whenever the cached rows go stale, so fetches in flight are dropped. */
  private generation = 0;
  /** Serializes row reads, so a second request finds the first one's rows cached. */
  private rowChain: Promise<unknown> = Promise.resolve();
  /** The WORK table holding the current sort and filter, keyed by their clauses. */
  private view: ViewEntry | undefined;
  /** The row count for a filter, read before its view table is built. */
  private filteredCount: { where: string; rows: number } | undefined;
  /** Earlier view tables still to delete. */
  private staleTables: string[] = [];

  constructor(
    private readonly client: SasClient,
    readonly lib: string,
    readonly mem: string,
    /** The name Positron shows for the explorer, on its tab and elsewhere. */
    readonly title = `${lib}.${mem}`,
  ) {}

  /**
   * Read the columns, row count, change stamp and first block of rows in one
   * SAS job, so Positron's first get_state and get_data_values are answered
   * without further round trips. Retries once if nothing comes back (SSH
   * session warm-up race).
   */
  async warmUp(): Promise<void> {
    const open = () =>
      this.client.openDataset(this.lib, this.mem, {
        rows: BLOCK_ROWS,
        maxColumns: PREFETCH_COLUMNS,
      });
    let opened = await open();
    if (opened.columns.length === 0 || opened.rowCount === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      opened = await open();
    }
    this.columns = opened.columns;
    this.unfilteredRowCount = opened.rowCount;
    this.stamp = opened.stamp;
    // Only a complete first block can be cached: a short one would look
    // like the end of the table.
    if (
      opened.rowColumns > 0 &&
      opened.rows.length === Math.min(BLOCK_ROWS, opened.rowCount)
    ) {
      const indices = opened.columns.slice(0, opened.rowColumns).map((_, i) => i);
      this.storeBlocks(0, indices, opened.rows);
    }
  }

  sendMessage(messageId: string, message: Record<string, unknown>): void {
    const method = String(message.method ?? "");
    const params = toRecord(message.params);

    // get_column_profiles is fire-and-forget: result arrives as an event, not a reply.
    if (method === "get_column_profiles") {
      this.getColumnProfiles(params).catch(() => {
        this.eventEmitter.fire({
          method: "return_column_profiles",
          params: { callback_id: params.callback_id, profiles: [] },
        });
      });
      this.emitter.fire({ messageId, data: { result: {} } });
      return;
    }

    this.dispatch(method, params)
      .then((result) => {
        this.emitter.fire({ messageId, data: { result } });
      })
      .catch((err: unknown) => {
        this.emitter.fire({
          messageId,
          data: {
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        });
      });
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "get_state":
        return this.getState();
      case "get_schema":
        return this.getSchema(params);
      case "get_data_values":
        return this.getDataValues(params);
      case "set_sort_columns":
        return this.setSortColumns(params);
      case "set_row_filters":
        return this.setRowFilters(params);
      case "export_data_selection":
        return null;
      case "suggest_code_syntax":
        return { code_syntax_name: "sas" };
      case "convert_to_code":
        return this.convertToCode();
      default:
        return null;
    }
  }

  private async getColumns(): Promise<ColumnInfo[]> {
    if (!this.columns) {
      this.columns = await this.client.getDatasetColumns(this.lib, this.mem);
    }
    return this.columns;
  }

  private buildWhereClause(): string | undefined {
    if (this.rowFilters.length === 0 || !this.columns) {
      return undefined;
    }
    let expr = "";
    for (const filter of this.rowFilters) {
      const col = this.columns[filter.column_schema.column_index];
      if (!col) {
        continue;
      }
      const isNum = col.type === "num";
      const condition = filterToCondition(filter, col.name, isNum);
      if (!condition) {
        continue;
      }
      if (expr === "") {
        expr = condition;
      } else {
        const joiner = filter.condition === "or" ? "or" : "and";
        expr = `(${expr}) ${joiner} ${condition}`;
      }
    }
    return expr !== "" ? expr : undefined;
  }

  private buildOrderByClause(): string | undefined {
    if (this.sortKeys.length === 0 || !this.columns) {
      return undefined;
    }
    const terms = this.sortKeys
      .map((key) => {
        const col = this.columns![key.column_index];
        return col ? `${col.name} ${key.ascending ? "asc" : "desc"}` : undefined;
      })
      .filter((t): t is string => t !== undefined);
    return terms.length > 0 ? terms.join(", ") : undefined;
  }

  private async getState(): Promise<Record<string, unknown>> {
    const columns = await this.getColumns();
    const where = this.buildWhereClause();

    // Use cached row count when no filter is active to avoid a redundant
    // count(*) scan that blocks get_data_values in the serial queue.
    // For large datasets (e.g. 70K rows), this scan can take several seconds,
    // causing Positron to timeout waiting for cell data.
    // With a filter, count the rows that pass it, unless its view table is
    // already built and knows.
    let filteredRows: number;
    if (where) {
      const view = this.view?.key === viewKey(where, this.buildOrderByClause())
        ? this.view.result
        : undefined;
      if (view) {
        filteredRows = view.rows;
      } else if (this.filteredCount?.where === where) {
        filteredRows = this.filteredCount.rows;
      } else {
        filteredRows = await this.client.getDatasetRowCount(this.lib, this.mem, where);
        this.filteredCount = { where, rows: filteredRows };
      }
    } else if (this.unfilteredRowCount !== undefined) {
      filteredRows = this.unfilteredRowCount;
    } else {
      filteredRows = await this.client.getDatasetRowCount(this.lib, this.mem);
    }
    if (this.unfilteredRowCount === undefined) {
      this.unfilteredRowCount = where
        ? await this.client.getDatasetRowCount(this.lib, this.mem)
        : filteredRows;
    }
    const unfilteredRows = where ? this.unfilteredRowCount : filteredRows;

    return {
      display_name: this.title,
      table_shape: { num_rows: filteredRows, num_columns: columns.length },
      table_unfiltered_shape: { num_rows: unfilteredRows, num_columns: columns.length },
      has_row_labels: false,
      column_filters: [],
      row_filters: this.rowFilters,
      sort_keys: this.sortKeys,
      supported_features: {
        search_schema: { support_status: "unsupported", supported_types: [] },
        set_column_filters: { support_status: "unsupported", supported_types: [] },
        set_row_filters: {
          support_status: "supported",
          supports_conditions: "supported",
          supported_types: [
            "between", "compare", "is_empty", "is_false", "is_null",
            "is_true", "not_between", "not_empty", "not_null", "search",
            "set_membership",
          ],
        },
        set_sort_columns: { support_status: "supported" },
        get_column_profiles: {
          support_status: "supported",
          supported_types: COLUMN_PROFILE_TYPES.map((profile_type) => ({
            profile_type,
            support_status: "supported",
          })),
        },
        export_data_selection: {
          support_status: "unsupported",
          supported_formats: [],
        },
        convert_to_code: {
          support_status: "supported",
          code_syntaxes: [{ code_syntax_name: "sas" }],
        },
      },
    };
  }

  private async getSchema(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const columns = await this.getColumns();
    const indices: number[] = Array.isArray(params.column_indices)
      ? params.column_indices.filter((v): v is number => typeof v === "number")
      : columns.map((_, i) => i);

    return {
      columns: indices
        .filter((i) => i >= 0 && i < columns.length)
        .map((i) => {
          const col = columns[i];
          const display = sasColumnDisplayType(col.type, col.format ?? "");
          return {
            column_index: i,
            column_name: col.name,
            type_name: col.type === "num" ? "numeric" : "character",
            type_display: display,
            description: "",
            // Shown when hovering over the column name.
            ...(col.label ? { column_label: col.label } : {}),
          };
        }),
    };
  }

  private async getDataValues(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const columns = await this.getColumns();
    const selections = toRecordArray(params.columns).map((s) => {
      const spec = toRecord(s.spec);
      return {
        column_index: typeof s.column_index === "number" ? s.column_index : -1,
        first_index: typeof spec.first_index === "number" ? spec.first_index : 0,
        last_index: typeof spec.last_index === "number" ? spec.last_index : 99,
      };
    }).filter((s) => s.column_index >= 0);

    const requestedIndices = (
      selections.length > 0
        ? selections.map((s) => s.column_index)
        : columns.map((_, i) => i)
    ).filter((i) => i >= 0 && i < columns.length);

    if (requestedIndices.length === 0) {
      return { columns: [], row_labels: [] };
    }
    const rowStart = selections.length > 0
      ? Math.min(...selections.map((s) => s.first_index))
      : 0;
    const rowEnd = selections.length > 0
      ? Math.max(...selections.map((s) => s.last_index))
      : 99;

    await this.serializeRows(() => this.loadRows(requestedIndices, rowStart, rowEnd));

    // Rows past the end of the table aren't in the cache.
    const first = requestedIndices[0];
    let available = 0;
    while (rowStart + available <= rowEnd && this.cell(rowStart + available, first) !== undefined) {
      available++;
    }
    const columnData: (string | number)[][] = requestedIndices.map((ci) => {
      const isNum = columns[ci].type === "num";
      const values: (string | number)[] = [];
      for (let r = rowStart; r < rowStart + available; r++) {
        const raw = (this.cell(r, ci) ?? "").trimEnd();
        if (isNum && (raw === "" || /^\.[A-Z_]?$/.test(raw))) {
          values.push(0); // Positron sentinel for NULL
        } else if (!isNum && raw === "") {
          values.push(0);
        } else {
          values.push(raw.trim());
        }
      }
      return values;
    });

    return {
      columns: columnData,
      row_labels: Array.from({ length: available }, (_, i) => [String(rowStart + i)]),
    };
  }

  private serializeRows<T>(task: () => Promise<T>): Promise<T> {
    const result = this.rowChain.then(task, task);
    this.rowChain = result.catch(() => undefined);
    return result;
  }

  /** A cached cell value, or undefined when it isn't cached or past the end. */
  private cell(row: number, column: number): string | undefined {
    return this.blocks.get(Math.floor(row / BLOCK_ROWS))?.get(column)?.[row % BLOCK_ROWS];
  }

  /**
   * Make sure the cache holds the given columns for rows rowStart..rowEnd,
   * reading what's missing in one SAS job: the missing columns, for the run
   * of blocks that lacks any of them.
   */
  private async loadRows(
    indices: number[],
    rowStart: number,
    rowEnd: number,
    retried = false,
  ): Promise<void> {
    const firstBlock = Math.floor(rowStart / BLOCK_ROWS);
    // Blocks past the end of the table hold nothing to read.
    const total = this.knownRowCount();
    const lastBlock = Math.min(
      Math.floor(rowEnd / BLOCK_ROWS),
      total === undefined ? Infinity : Math.floor((total - 1) / BLOCK_ROWS),
    );
    const missingColumns = new Set<number>();
    const missingBlocks: number[] = [];
    for (let b = firstBlock; b <= lastBlock; b++) {
      const block = this.blocks.get(b);
      if (block) {
        // Most recently used goes last.
        this.blocks.delete(b);
        this.blocks.set(b, block);
      }
      const missing = indices.filter((i) => !block?.has(i));
      if (missing.length > 0) {
        missing.forEach((i) => missingColumns.add(i));
        missingBlocks.push(b);
      }
    }
    if (missingBlocks.length === 0) {
      return;
    }
    const columns = this.columns ?? [];
    // Nothing cached (a new sort or filter): read the other columns too.
    if (this.blocks.size === 0) {
      columns.slice(0, PREFETCH_COLUMNS).forEach((_, i) => missingColumns.add(i));
    }
    const fetchColumns = [...missingColumns].sort((a, b) => a - b);
    const from = missingBlocks[0];
    const to = missingBlocks[missingBlocks.length - 1];
    const generation = this.generation;
    const start = from * BLOCK_ROWS;
    const { rows, view } = await this.readRows(
      fetchColumns.map((i) => columns[i].name),
      start,
      (to - from + 1) * BLOCK_ROWS,
    );
    if (generation !== this.generation) {
      return;
    }
    // The view table can vanish, e.g. when the user deletes everything in
    // WORK. Rebuild it once rather than show an empty grid.
    if (rows.length === 0 && view && start < view.rows && !retried) {
      this.retireView();
      return this.loadRows(indices, rowStart, rowEnd, true);
    }
    this.storeBlocks(from, fetchColumns, rows, to);
  }

  /** The number of rows with the current filter, when it's known without a query. */
  private knownRowCount(): number | undefined {
    const where = this.buildWhereClause();
    if (!where) {
      return this.unfilteredRowCount;
    }
    if (this.view?.result && this.view.key === viewKey(where, this.buildOrderByClause())) {
      return this.view.result.rows;
    }
    return this.filteredCount?.where === where ? this.filteredCount.rows : undefined;
  }

  /** Cache rows (as getDatasetRows returns them) starting at block `from`. */
  private storeBlocks(
    from: number,
    indices: number[],
    rows: string[],
    to = from + Math.max(0, Math.ceil(rows.length / BLOCK_ROWS) - 1),
  ): void {
    const cells = rows.map((row) => row.split("|").slice(1));
    for (let b = from; b <= to; b++) {
      const slice = cells.slice((b - from) * BLOCK_ROWS, (b - from + 1) * BLOCK_ROWS);
      const block = this.blocks.get(b) ?? new Map<number, string[]>();
      indices.forEach((ci, k) => block.set(ci, slice.map((c) => c[k] ?? "")));
      this.blocks.delete(b);
      this.blocks.set(b, block);
    }
    while (this.blocks.size > MAX_BLOCKS) {
      this.blocks.delete(this.blocks.keys().next().value!);
    }
  }

  /** Drop the cached rows, e.g. when the sort, filter or data changed. */
  private clearRows(): void {
    this.blocks.clear();
    this.generation++;
  }

  /**
   * Read rows for the current sort and filter. Without either, from the
   * dataset itself. With one, from a WORK table that holds the sorted and
   * filtered rows, so that scrolling doesn't sort the dataset again for each
   * page. The first read after a change builds that table and returns its
   * rows in the same job, which costs what sorting into a throwaway table
   * would. If the table can't be built, pages come from the dataset with the
   * WHERE and ORDER BY clauses, one job each.
   */
  private async readRows(
    columns: string[],
    start: number,
    count: number,
  ): Promise<{ rows: string[]; view?: MaterializedView }> {
    const where = this.buildWhereClause();
    const orderBy = this.buildOrderByClause();
    if (!where && !orderBy) {
      this.retireView();
      return { rows: await this.client.getDatasetRows(this.lib, this.mem, columns, start, count) };
    }
    const key = viewKey(where, orderBy);
    if (this.view?.key !== key) {
      try {
        return { rows: await this.buildView(key, where, orderBy, { columns, start, count }) };
      } catch {
        // Fall through: the failed build is remembered, the dataset is read.
      }
    }
    const view = await this.view?.promise.catch(() => undefined);
    if (view) {
      return {
        rows: await this.client.getDatasetRows("WORK", view.table, columns, start, count),
        view,
      };
    }
    return {
      rows: await this.client.getDatasetRows(
        this.lib, this.mem, columns, start, count, where, orderBy,
      ),
    };
  }

  /**
   * Build the view table for a sort and filter, replacing the current one
   * (deleted in the same job), and return the rows `read` asks for.
   */
  private buildView(
    key: string,
    where: string | undefined,
    orderBy: string | undefined,
    read: { columns: string[]; start: number; count: number },
  ): Promise<string[]> {
    const previous = this.view;
    const stale = this.staleTables.splice(0);
    const table = `${DATA_VIEW_PREFIX}${++viewCounter}`;
    const job = (previous
      ? previous.promise.then(({ table: old }) => [old], () => [])
      : Promise.resolve([])
    ).then((old) =>
      this.client.materializeDataset(
        this.lib, this.mem, table, where, orderBy, [...stale, ...old], read,
      ),
    );
    const promise = job.then(({ rows }) => ({ table, rows }));
    const view: ViewEntry = { key, promise };
    this.view = view;
    promise.then(
      (result) => {
        view.result = result;
      },
      () => {
        this.staleTables.push(table);
      },
    );
    return job.then(({ data }) => data);
  }

  /** Forget the current view table; it's deleted with the next one, or on dispose. */
  private retireView(): void {
    const view = this.view;
    this.view = undefined;
    view?.promise.then(
      ({ table }) => this.staleTables.push(table),
      () => undefined,
    );
  }

  private async setSortColumns(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const keys = Array.isArray(params.sort_keys) ? params.sort_keys : [];
    this.sortKeys = keys.filter((k): k is SortKey =>
      typeof k === "object" && k !== null &&
      typeof toRecord(k).column_index === "number",
    );
    this.clearRows();
    return this.getState();
  }

  private async setRowFilters(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const filters = Array.isArray(params.filters) ? params.filters : [];
    this.rowFilters = filters.filter((f): f is RowFilter => {
      if (typeof f !== "object" || f === null) {
        return false;
      }
      const schema = toRecord(toRecord(f).column_schema);
      return typeof schema.column_index === "number";
    });
    this.clearRows();
    // Reload state (filtered row count changes with new filters).
    return this.getState();
  }

  private async getColumnProfiles(
    params: Record<string, unknown>,
  ): Promise<void> {
    const columns = await this.getColumns();
    const requests = toRecordArray(params.profiles);
    const callbackId = params.callback_id;
    const where = this.buildWhereClause();

    const nullCountIndices: number[] = [];
    const numericStatsIndices: number[] = [];
    const stringStatsIndices: number[] = [];
    const histograms: Array<{ colIdx: number; type: string; numBins: number }> = [];
    const frequencyTables: Array<{ colIdx: number; type: string; limit: number }> = [];
    const addUnique = (list: number[], colIdx: number) => {
      if (!list.includes(colIdx)) {
        list.push(colIdx);
      }
    };

    for (const raw of requests) {
      const colIdx = typeof raw.column_index === "number" ? raw.column_index : -1;
      if (colIdx < 0 || colIdx >= columns.length) {
        continue;
      }
      const isNum = columns[colIdx].type === "num";
      for (const spec of toRecordArray(raw.profiles)) {
        const pt = String(spec.profile_type ?? "");
        const specParams = toRecord(spec.params);
        if (pt === "null_count") {
          addUnique(nullCountIndices, colIdx);
        } else if (pt === "summary_stats") {
          addUnique(isNum ? numericStatsIndices : stringStatsIndices, colIdx);
        } else if ((pt === "small_histogram" || pt === "large_histogram") && isNum) {
          const numBins = typeof specParams.num_bins === "number" ? specParams.num_bins : 20;
          histograms.push({ colIdx, type: pt, numBins });
        } else if (pt === "small_frequency_table" || pt === "large_frequency_table") {
          const limit = typeof specParams.limit === "number" ? specParams.limit : 8;
          frequencyTables.push({ colIdx, type: pt, limit });
        }
      }
    }

    const names = (indices: number[]) => indices.map((i) => columns[i].name);
    const histogramColumns = [...new Set(histograms.map((h) => h.colIdx))];

    // Two background jobs: everything but the histogram counts, which need
    // the bins computed from the first job's statistics. Background jobs
    // wait while row reads are queued, so profiles don't hold up the grid.
    const {
      nullCounts,
      numericStats,
      stringStats,
      frequencyTables: freqTables,
      binning: binningStats,
    } = await this.client.getColumnProfileStats(
      this.lib,
      this.mem,
      {
        nullCounts: names(nullCountIndices),
        numericStats: names(numericStatsIndices),
        stringStats: names(stringStatsIndices),
        frequencyTables: frequencyTables.map((f) => ({
          column: columns[f.colIdx].name,
          limit: f.limit,
        })),
        binning: names(histogramColumns),
      },
      where,
    );

    // Bin each requested histogram, then count all of them in one query.
    const binned = histograms.map((h) => {
      const stats = binningStats[histogramColumns.indexOf(h.colIdx)];
      return { ...h, stats, bins: computeHistogramBins(stats, h.numBins) };
    });
    const binCounts = await this.client.getColumnHistogramCounts(
      this.lib,
      this.mem,
      binned.map((b) => ({ column: columns[b.colIdx].name, bins: b.bins })),
      where,
      "background",
    );

    const profiles = requests.map((raw) => {
      const colIdx = typeof raw.column_index === "number" ? raw.column_index : -1;
      const col = columns[colIdx];
      const result: Record<string, unknown> = {};
      for (const spec of toRecordArray(raw.profiles)) {
        const pt = String(spec.profile_type ?? "");
        if (pt === "null_count") {
          result.null_count = nullCounts[nullCountIndices.indexOf(colIdx)] ?? 0;
        } else if (pt === "summary_stats" && col) {
          const typeDisplay = sasColumnDisplayType(col.type, col.format ?? "");
          const s = numericStats[numericStatsIndices.indexOf(colIdx)];
          const ss = stringStats[stringStatsIndices.indexOf(colIdx)];
          if (s) {
            result.summary_stats = {
              type_display: typeDisplay,
              number_stats: {
                min_value: s.minValue !== null ? String(s.minValue) : undefined,
                max_value: s.maxValue !== null ? String(s.maxValue) : undefined,
                mean: s.meanValue !== null ? String(s.meanValue) : undefined,
                median: s.medianValue !== null ? String(s.medianValue) : undefined,
                stdev: s.stdevValue !== null ? String(s.stdevValue) : undefined,
              },
            };
          } else if (ss) {
            result.summary_stats = {
              type_display: typeDisplay,
              string_stats: { num_empty: ss.numEmpty, num_unique: ss.numUnique },
            };
          }
        } else if (pt === "small_histogram" || pt === "large_histogram") {
          const k = binned.findIndex((b) => b.colIdx === colIdx && b.type === pt);
          if (k >= 0) {
            const { bins, stats } = binned[k];
            result[pt] = {
              bin_edges: bins.edges.map(formatEdge),
              // A constant column has one zero-width bin holding every value.
              bin_counts: bins.width === 0 && bins.nbins === 1 ? [stats.n] : binCounts[k],
              quantiles: [],
            };
          }
        } else if (pt === "small_frequency_table" || pt === "large_frequency_table") {
          const k = frequencyTables.findIndex((f) => f.colIdx === colIdx && f.type === pt);
          if (k >= 0) {
            const table = freqTables[k];
            result[pt] = {
              values: table.values,
              counts: table.counts,
              other_count: table.otherCount,
            };
          }
        }
      }
      return result;
    });

    this.eventEmitter.fire({
      method: "return_column_profiles",
      params: { callback_id: callbackId, profiles },
    });
  }

  private async convertToCode(): Promise<{ converted_code: string[] }> {
    await this.getColumns(); // ensure columns are loaded for buildWhereClause
    const where = this.buildWhereClause();
    const orderBy = this.buildOrderByClause();

    const lines: string[] = ["proc sql;", `  select * from ${this.lib}.${this.mem}`];

    if (where) {
      lines.push(`  where ${where}`);
    }
    if (orderBy) {
      lines.push(`  order by ${orderBy}`);
    }

    lines.push(";", "quit;");

    return { converted_code: lines };
  }

  /**
   * Reload after the dataset changed: re-read its columns, then tell Positron
   * to fetch the schema again when they changed (sorts and filters are
   * dropped, as they may name columns that are gone), or else the data.
   * Does nothing when the dataset is gone.
   */
  async refresh(): Promise<void> {
    const columns = await this.client.getDatasetColumns(this.lib, this.mem);
    if (columns.length === 0) {
      return;
    }
    const schemaChanged = !sameColumns(this.columns, columns);
    this.columns = columns;
    this.unfilteredRowCount = undefined;
    this.filteredCount = undefined;
    this.clearRows();
    this.retireView();
    if (schemaChanged) {
      this.sortKeys = [];
      this.rowFilters = [];
      this.eventEmitter.fire({ method: "schema_update", params: {} });
    } else {
      this.eventEmitter.fire({ method: "data_update", params: {} });
    }
  }

  /** Clear cached counts and rows so the next requests re-read them from SAS. */
  invalidateCache(): void {
    this.unfilteredRowCount = undefined;
    this.filteredCount = undefined;
    this.clearRows();
  }

  dispose(): void {
    this.emitter.dispose();
    this.eventEmitter.dispose();
    this.clearRows();
    // Delete the view tables in WORK, once any build in flight is done.
    const view = this.view;
    this.view = undefined;
    const stale = this.staleTables.splice(0);
    const current = view
      ? view.promise.then(({ table }) => [table], () => [])
      : Promise.resolve([]);
    current.then((tables) => {
      const all = [...stale, ...tables];
      if (all.length > 0) {
        this.client.deleteWorkTables(all).catch(() => undefined);
      }
    });
  }
}
