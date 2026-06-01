// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";
import type { SasClient, ColumnInfo } from "./sasClient";

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

  constructor(
    private readonly client: SasClient,
    readonly lib: string,
    readonly mem: string,
  ) {}

  /**
   * Pre-fetch columns and row count so the first get_state/get_data_values
   * from Positron responds instantly without waiting for SAS round-trips.
   * Retries if columns come back empty (SSH session warm-up race).
   */
  async warmUp(): Promise<void> {
    this.columns = await this.client.getDatasetColumns(this.lib, this.mem);
    if (this.columns.length === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      this.columns = await this.client.getDatasetColumns(this.lib, this.mem);
    }
    this.unfilteredRowCount = await this.client.getDatasetRowCount(
      this.lib, this.mem,
    );
    if (this.unfilteredRowCount === 0 && this.columns.length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      this.unfilteredRowCount = await this.client.getDatasetRowCount(
        this.lib, this.mem,
      );
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
    let filteredRows: number;
    if (!where && this.unfilteredRowCount !== undefined) {
      filteredRows = this.unfilteredRowCount;
    } else {
      filteredRows = await this.client.getDatasetRowCount(
        this.lib, this.mem, where,
      );
    }
    if (this.unfilteredRowCount === undefined) {
      this.unfilteredRowCount = where
        ? await this.client.getDatasetRowCount(this.lib, this.mem)
        : filteredRows;
    }
    const unfilteredRows = where ? this.unfilteredRowCount : filteredRows;

    return {
      display_name: `${this.lib}.${this.mem}`,
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
          supported_types: ["null_count", "summary_stats"],
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

    const rowStart = selections.length > 0 ? selections[0].first_index : 0;
    const rowEnd = selections.length > 0 ? selections[0].last_index : 99;
    const numRows = rowEnd - rowStart + 1;

    const requestedIndices = (
      selections.length > 0
        ? selections.map((s) => s.column_index)
        : columns.map((_, i) => i)
    ).filter((i) => i >= 0 && i < columns.length);

    if (requestedIndices.length === 0) {
      return { columns: [], row_labels: [] };
    }

    const requestedCols = requestedIndices.map((i) => columns[i]);
    const colNames = requestedCols.map((c) => c.name);
    const where = this.buildWhereClause();
    const orderBy = this.buildOrderByClause();

    const effectiveRows = numRows;
    const rows = await this.client.getDatasetRows(
      this.lib, this.mem, colNames, rowStart, effectiveRows, where, orderBy,
    );

    // Each row is a pipe-delimited string: "|col1|col2|col3".
    // Split on "|" and skip the leading empty element from the leading pipe.
    const columnData: (string | number)[][] = requestedCols.map(() => []);
    for (const row of rows) {
      const cells = row.split("|").slice(1);
      for (let ci = 0; ci < requestedCols.length; ci++) {
        const raw = (cells[ci] ?? "").trimEnd();
        const isNum = requestedCols[ci].type === "num";
        if (isNum && (raw === "" || /^\.[A-Z_]?$/.test(raw))) {
          columnData[ci].push(0); // Positron sentinel for NULL
        } else if (!isNum && raw === "") {
          columnData[ci].push(0);
        } else {
          columnData[ci].push(raw.trim());
        }
      }
    }

    return {
      columns: columnData,
      row_labels: Array.from({ length: rows.length }, (_, i) => [String(rowStart + i)]),
    };
  }

  private async setSortColumns(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const keys = Array.isArray(params.sort_keys) ? params.sort_keys : [];
    this.sortKeys = keys.filter((k): k is SortKey =>
      typeof k === "object" && k !== null &&
      typeof toRecord(k).column_index === "number",
    );
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
    // Reload state (filtered row count changes with new filters).
    return this.getState();
  }

  private async getColumnProfiles(
    params: Record<string, unknown>,
  ): Promise<void> {
    const columns = await this.getColumns();
    const requests = Array.isArray(params.profiles) ? params.profiles : [];
    const callbackId = params.callback_id;
    const where = this.buildWhereClause();

    const nullCountIndices: number[] = [];
    const summaryStatsIndices: number[] = [];

    for (const raw of toRecordArray(requests)) {
      const colIdx = typeof raw.column_index === "number" ? raw.column_index : -1;
      if (colIdx < 0 || colIdx >= columns.length) {
        continue;
      }
      for (const spec of toRecordArray(raw.profiles)) {
        const pt = String(spec.profile_type ?? "");
        if (pt === "null_count") {
          nullCountIndices.push(colIdx);
        } else if (pt === "summary_stats" && columns[colIdx].type === "num") {
          summaryStatsIndices.push(colIdx);
        }
      }
    }

    const nullCountMap = new Map<number, number>();
    const summaryMap = new Map<number, {
      minValue: number | null; maxValue: number | null;
      meanValue: number | null; stdevValue: number | null; medianValue: number | null;
    }>();

    const fetches: Promise<void>[] = [];

    if (nullCountIndices.length > 0) {
      fetches.push(
        this.client
          .getColumnNullCounts(
            this.lib, this.mem,
            nullCountIndices.map((i) => columns[i].name),
            where,
          )
          .then((counts) => {
            counts.forEach((count, idx) => {
              nullCountMap.set(nullCountIndices[idx], count);
            });
          }),
      );
    }

    if (summaryStatsIndices.length > 0) {
      fetches.push(
        this.client
          .getColumnSummaryStats(
            this.lib, this.mem,
            summaryStatsIndices.map((i) => columns[i].name),
            where,
          )
          .then((statsArr) => {
            statsArr.forEach((s, idx) => {
              summaryMap.set(summaryStatsIndices[idx], s);
            });
          }),
      );
    }

    await Promise.all(fetches);

    const profiles = toRecordArray(requests).map((raw) => {
      const colIdx = typeof raw.column_index === "number" ? raw.column_index : -1;
      const result: Record<string, unknown> = {};
      for (const spec of toRecordArray(raw.profiles)) {
        const pt = String(spec.profile_type ?? "");
        if (pt === "null_count") {
          result.null_count = nullCountMap.get(colIdx) ?? 0;
        } else if (pt === "summary_stats") {
          const s = summaryMap.get(colIdx);
          if (s) {
            const col = columns[colIdx];
            result.summary_stats = {
              type_display: col
                ? sasColumnDisplayType(col.type, col.format ?? "")
                : "floating",
              number_stats: {
                min_value: s.minValue !== null ? String(s.minValue) : undefined,
                max_value: s.maxValue !== null ? String(s.maxValue) : undefined,
                mean: s.meanValue !== null ? String(s.meanValue) : undefined,
                median: s.medianValue !== null ? String(s.medianValue) : undefined,
                stdev: s.stdevValue !== null ? String(s.stdevValue) : undefined,
              },
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

  /** Clear cached counts so the next get_state re-queries from SAS. */
  invalidateCache(): void {
    this.unfilteredRowCount = undefined;
  }

  dispose(): void {
    this.emitter.dispose();
    this.eventEmitter.dispose();
  }
}
