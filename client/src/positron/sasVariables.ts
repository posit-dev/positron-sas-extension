// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "vscode";

import type {
  ColumnInfo,
  MacroVariable,
  SessionSnapshot,
  WorkTable,
} from "./sasClient";

/**
 * The positron.variables comm of a SAS console (posit-dev/positron-sas-extension#158).
 * The Variables pane shows the session's GLOBAL macro variables, its
 * AUTOMATIC ones grouped under one entry, and its WORK datasets, which open
 * in the Data Explorer. Posit Assistant reads the same list through
 * positron.runtime.getSessionVariables.
 */

/** What the comm needs from the SAS session. */
export interface SasVariablesBackend {
  snapshot(): Promise<SessionSnapshot>;
  getColumns(lib: string, mem: string): Promise<ColumnInfo[]>;
  deleteMacroVariables(names: string[]): Promise<void>;
  deleteWorkTables(names: string[]): Promise<void>;
  /** Open a Data Explorer and return its comm id. */
  openDataExplorer(lib: string, mem: string): string;
}

/** A variable as the positron.variables comm describes it. */
export interface PositronVariable {
  access_key: string;
  display_name: string;
  display_value: string;
  display_type: string;
  type_info: string;
  kind: string;
  length: number;
  size: number;
  has_children: boolean;
  has_viewer: boolean;
  is_truncated: boolean;
  updated_time: number;
}

export interface VariablesEmitData {
  messageId: string;
  data: object;
}

/** The access key of the entry that holds the AUTOMATIC macro variables. */
export const AUTOMATIC_KEY = "(automatic)";

/** The longest value the pane shows; the full value is copied. */
const MAX_DISPLAY = 1000;

/** GLOBAL macro variables that Clear leaves alone: the session's identity. */
const KEEP_ON_CLEAR = /^(POSIT_\w+|_SASPROGRAMFILE)$/i;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function tableKey(name: string): string {
  return `WORK.${name}`;
}

/** The WORK member name of a table access key, or undefined. */
function tableName(key: string): string | undefined {
  return /^WORK\.(\w+)$/i.exec(key)?.[1];
}

function macroVariable(m: MacroVariable, updated: number): PositronVariable {
  const truncated = m.value.length > MAX_DISPLAY;
  return {
    access_key: m.name,
    display_name: m.name,
    display_value: truncated ? m.value.slice(0, MAX_DISPLAY) : m.value,
    display_type: "macro variable",
    type_info: `${m.scope} macro variable, ${m.value.length} characters`,
    kind: NUMBER.test(m.value.trim()) ? "number" : "string",
    length: m.value.length,
    size: Buffer.byteLength(m.value, "utf8"),
    has_children: false,
    has_viewer: false,
    is_truncated: truncated,
    updated_time: updated,
  };
}

function automaticGroup(count: number, updated: number): PositronVariable {
  return {
    access_key: AUTOMATIC_KEY,
    display_name: "Automatic macro variables",
    display_value: `${count} variables`,
    display_type: "AUTOMATIC",
    type_info: "Macro variables SAS defines",
    kind: "map",
    length: count,
    size: 0,
    has_children: true,
    has_viewer: false,
    is_truncated: false,
    updated_time: updated,
  };
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

function workTable(t: WorkTable, updated: number): PositronVariable {
  const shape =
    t.memtype === "VIEW"
      ? `[view${t.columns !== undefined ? `, ${plural(t.columns, "var")}` : ""}]`
      : `[${t.rows !== undefined ? t.rows.toLocaleString("en-US") : "?"} obs x ${
          t.columns !== undefined ? plural(t.columns, "var") : "? vars"
        }]`;
  return {
    access_key: tableKey(t.name),
    display_name: tableKey(t.name),
    display_value: t.label ? `${shape} ${t.label}` : shape,
    display_type: t.memtype === "VIEW" ? "SAS view" : "SAS dataset",
    type_info: t.label ?? "",
    kind: "table",
    length: t.rows ?? 0,
    size: 0,
    has_children: true,
    has_viewer: true,
    is_truncated: false,
    updated_time: updated,
  };
}

function columnVariable(c: ColumnInfo): PositronVariable {
  const type = c.type === "num" ? "num" : "char";
  const details = [c.format, c.label].filter(Boolean).join(" ");
  return {
    access_key: c.name,
    display_name: c.name,
    display_value: details,
    display_type: c.length ? `${type}(${c.length})` : type,
    type_info: [type, c.format, c.informat].filter(Boolean).join(" "),
    kind: type === "num" ? "number" : "string",
    length: 0,
    size: 0,
    has_children: false,
    has_viewer: false,
    is_truncated: false,
    updated_time: 0,
  };
}

/** The `%let` statement that recreates a macro variable. */
export function letStatement(m: MacroVariable): string {
  // %STR keeps leading and trailing blanks, which %LET would drop.
  const value = /^\s|\s$/.test(m.value) ? `%str(${m.value})` : m.value;
  return `%let ${m.name}=${value};`;
}

/** What a snapshot entry looks like when deciding whether it changed. */
function signatures(snapshot: SessionSnapshot): Map<string, string> {
  const result = new Map<string, string>();
  const automatic: string[] = [];
  for (const m of snapshot.macros) {
    if (m.scope === "GLOBAL") {
      result.set(m.name, m.value);
    } else {
      automatic.push(`${m.name}=${m.value}`);
    }
  }
  result.set(AUTOMATIC_KEY, automatic.join("\n"));
  for (const t of snapshot.tables) {
    result.set(
      tableKey(t.name),
      [t.memtype, t.rows, t.columns, t.modified, t.label].join("|"),
    );
  }
  return result;
}

export class SasVariables {
  private readonly dataEmitter = new EventEmitter<VariablesEmitData>();
  /** Replies to Positron's requests. */
  readonly onDidEmitData = this.dataEmitter.event;

  private readonly eventEmitter = new EventEmitter<object>();
  /** Events Positron didn't ask for: update and refresh. */
  readonly onDidEmitEvent = this.eventEmitter.event;

  private snapshot: SessionSnapshot = { macros: [], tables: [] };
  private signatures = new Map<string, string>();
  /** When each top-level entry last changed. */
  private readonly updated = new Map<string, number>();
  private version = 0;
  /** Serialises snapshots, so updates arrive in order. */
  private pending: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly backend: SasVariablesBackend,
    private readonly now: () => number = Date.now,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.dataEmitter.dispose();
    this.eventEmitter.dispose();
  }

  /**
   * Read the session again and tell Positron what changed. Called after
   * each submission.
   */
  refresh(): Promise<void> {
    return this.serialise(async () => {
      const { assigned, removed } = await this.load();
      if (!this.disposed && (assigned.length > 0 || removed.length > 0)) {
        this.eventEmitter.fire({
          method: "update",
          params: { assigned, unevaluated: [], removed, version: this.version },
        });
      }
    });
  }

  /**
   * Read the session again and send Positron the whole list (a "refresh"
   * event), not only what changed. Called when Positron has created the
   * comm: Positron doesn't ask for the list itself then, so without it the
   * pane stays empty until the first submission or a click on reload.
   */
  reload(): Promise<void> {
    return this.serialise(async () => {
      await this.load();
      if (!this.disposed) {
        const variables = this.topLevel();
        this.eventEmitter.fire({
          method: "refresh",
          params: { variables, length: variables.length, version: this.version },
        });
      }
    });
  }

  sendMessage(messageId: string, message: Record<string, unknown>): void {
    const method = String(message.method ?? "");
    const params: Record<string, unknown> =
      typeof message.params === "object" && message.params !== null
        ? Object.fromEntries(Object.entries(message.params))
        : {};
    this.handle(method, params).then(
      (result) => this.reply(messageId, { result: result ?? null }),
      (error: unknown) =>
        this.reply(messageId, {
          error: {
            code: error instanceof RpcError ? error.code : -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    );
  }

  private reply(messageId: string, data: object): void {
    if (!this.disposed) {
      this.dataEmitter.fire({ messageId, data });
    }
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const run = this.pending.then(task, task);
    this.pending = run.catch(() => undefined);
    return run;
  }

  private async handle(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const path = Array.isArray(params.path) ? params.path.map(String) : [];
    switch (method) {
      case "list":
        return this.serialise(async () => {
          await this.load();
          const variables = this.topLevel();
          return { variables, length: variables.length, version: this.version };
        });
      case "inspect":
        return this.inspect(path);
      case "clipboard_format":
        return { content: this.clipboard(path) };
      case "view":
        return this.view(path);
      case "delete":
        return this.delete(
          Array.isArray(params.names) ? params.names.map(String) : [],
        );
      case "clear":
        await this.clear();
        return null;
      case "query_table_summary":
        return this.tableSummary(path);
      default:
        throw new RpcError(-32601, `Unknown method: ${method}`);
    }
  }

  /** Take a snapshot and work out which top-level entries changed. */
  private async load(): Promise<{
    assigned: PositronVariable[];
    removed: string[];
  }> {
    const snapshot = await this.backend.snapshot();
    const next = signatures(snapshot);
    const time = this.now();
    const changed: string[] = [];
    for (const [key, signature] of next) {
      if (this.signatures.get(key) !== signature) {
        changed.push(key);
        this.updated.set(key, time);
      }
    }
    const removed = [...this.signatures.keys()].filter((k) => !next.has(k));
    removed.forEach((k) => this.updated.delete(k));
    this.snapshot = snapshot;
    this.signatures = next;
    this.version++;
    const changedKeys = new Set(changed);
    return {
      assigned: this.topLevel().filter((v) => changedKeys.has(v.access_key)),
      removed,
    };
  }

  private updatedTime(key: string): number {
    return this.updated.get(key) ?? 0;
  }

  /** The pane's top level, sorted: macro variables, the group, tables. */
  private topLevel(): PositronVariable[] {
    const globals = this.snapshot.macros
      .filter((m) => m.scope === "GLOBAL")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => macroVariable(m, this.updatedTime(m.name)));
    const automatic = this.snapshot.macros.filter((m) => m.scope === "AUTOMATIC");
    const tables = [...this.snapshot.tables]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => workTable(t, this.updatedTime(tableKey(t.name))));
    return [
      ...globals,
      ...(automatic.length > 0
        ? [automaticGroup(automatic.length, this.updatedTime(AUTOMATIC_KEY))]
        : []),
      ...tables,
    ];
  }

  private automatic(): MacroVariable[] {
    return this.snapshot.macros
      .filter((m) => m.scope === "AUTOMATIC")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private findTable(key: string | undefined): WorkTable | undefined {
    const name = key && tableName(key);
    return name
      ? this.snapshot.tables.find((t) => t.name.toUpperCase() === name.toUpperCase())
      : undefined;
  }

  /** The macro variable at a path: a GLOBAL name, or [group, AUTOMATIC name]. */
  private findMacro(path: string[]): MacroVariable | undefined {
    if (path.length === 1) {
      return this.snapshot.macros.find(
        (m) => m.scope === "GLOBAL" && m.name === path[0],
      );
    }
    if (path.length === 2 && path[0] === AUTOMATIC_KEY) {
      return this.automatic().find((m) => m.name === path[1]);
    }
    return undefined;
  }

  private async inspect(path: string[]): Promise<object> {
    if (path.length === 1 && path[0] === AUTOMATIC_KEY) {
      const children = this.automatic().map((m) => macroVariable(m, 0));
      return { children, length: children.length };
    }
    const table = path.length === 1 ? this.findTable(path[0]) : undefined;
    if (table) {
      const columns = await this.backend.getColumns("WORK", table.name);
      const children = columns.map(columnVariable);
      return { children, length: children.length };
    }
    throw new RpcError(-32602, `Nothing to inspect at ${path.join(".")}`);
  }

  private clipboard(path: string[]): string {
    const macro = this.findMacro(path);
    if (macro) {
      return letStatement(macro);
    }
    if (path.length === 1 && path[0] === AUTOMATIC_KEY) {
      return this.automatic().map(letStatement).join("\n");
    }
    const table = this.findTable(path[0]);
    if (table) {
      return path.length === 1 ? tableKey(table.name) : path[path.length - 1];
    }
    throw new RpcError(-32602, `No variable at ${path.join(".")}`);
  }

  private view(path: string[]): string {
    const table = path.length === 1 ? this.findTable(path[0]) : undefined;
    if (!table) {
      throw new RpcError(-32602, `${path.join(".")} can't be viewed`);
    }
    return this.backend.openDataExplorer("WORK", table.name);
  }

  private async delete(keys: string[]): Promise<string[]> {
    const macros = keys.filter((k) =>
      this.snapshot.macros.some((m) => m.scope === "GLOBAL" && m.name === k),
    );
    const tables = keys
      .map((k) => this.findTable(k)?.name)
      .filter((n): n is string => n !== undefined);
    if (macros.length > 0) {
      await this.backend.deleteMacroVariables(macros);
    }
    if (tables.length > 0) {
      await this.backend.deleteWorkTables(tables);
    }
    await this.refresh();
    return [...macros, ...tables.map(tableKey)];
  }

  /** Delete the user's GLOBAL macro variables and WORK tables. */
  private async clear(): Promise<void> {
    const macros = this.snapshot.macros
      .filter((m) => m.scope === "GLOBAL" && !KEEP_ON_CLEAR.test(m.name))
      .map((m) => m.name);
    const tables = this.snapshot.tables.map((t) => t.name);
    if (macros.length > 0) {
      await this.backend.deleteMacroVariables(macros);
    }
    if (tables.length > 0) {
      await this.backend.deleteWorkTables(tables);
    }
    await this.refresh();
  }

  private async tableSummary(path: string[]): Promise<object> {
    const table = path.length === 1 ? this.findTable(path[0]) : undefined;
    if (!table) {
      throw new RpcError(-32602, `${path.join(".")} is not a table`);
    }
    const columns = await this.backend.getColumns("WORK", table.name);
    return {
      num_rows: table.rows ?? 0,
      num_columns: columns.length,
      column_schemas: columns.map((c, i) =>
        JSON.stringify({
          column_name: c.name,
          column_index: i,
          type_name: c.type === "num" ? "numeric" : "character",
          type_display: c.type === "num" ? "number" : "string",
          ...(c.label ? { column_label: c.label } : {}),
        }),
      ),
      column_profiles: [],
    };
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
