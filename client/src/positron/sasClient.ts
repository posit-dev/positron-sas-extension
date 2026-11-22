// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Sentinel markers wrapping silent execution output to isolate it from log noise. */
const SENTINEL_START = "~~SAS_START~~";
const SENTINEL_END = "~~SAS_END~~";

export interface ColumnInfo {
  name: string;
  type: string; // "num" or "char"
  length?: number;
  format?: string;
  informat?: string;
  label?: string;
}

/** What dictionary.tables says about a dataset or view. */
export interface DatasetProperties {
  lib: string;
  mem: string;
  /** "DATA" or "VIEW". */
  memtype: string;
  label?: string;
  /** Creation and modification times, as SAS shows them (ISO 8601). */
  created?: string;
  modified?: string;
  /** Rows, without deleted ones; unknown for views. */
  rows?: number;
  deletedRows?: number;
  columns?: number;
  /** Bytes per row. */
  rowLength?: number;
  fileSize?: number;
  compression?: string;
  encoding?: string;
  dataRepresentation?: string;
  /** The variables the data is sorted by, from dictionary.columns. */
  sortedBy: string[];
}

/** When a dataset last changed, to tell whether an open Data Explorer is stale. */
export interface DatasetStamp {
  memtype: string;
  /** Modification time, rows and columns; changes when the data does. */
  stamp: string;
}

/**
 * SAS code that sets line and page size for long %put lines and keeps the
 * user's values in _SAS_OPT, which RESTORE_OPTIONS puts back.
 */
const SAVE_OPTIONS = `%let _sas_opt=%sysfunc(getoption(ls,keyword)) %sysfunc(getoption(ps,keyword)) %sysfunc(getoption(mprint)) %sysfunc(getoption(symbolgen)) %sysfunc(getoption(mlogic));
options nosource nonotes nomprint nosymbolgen nomlogic ls=max ps=max;`;
const RESTORE_OPTIONS = `options notes source &_sas_opt;`;

export interface LibraryMember {
  name: string;
  type: string; // "DATA", "VIEW", etc.
}

/**
 * Extract lines between sentinel markers.
 * Skips lines not containing delimiter when one is given.
 */
function parseSentinelOutput(stdout: string, delimiter?: string): string[] {
  const lines = stdout.split("\n");
  const result: string[] = [];
  let capturing = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === SENTINEL_START) {
      capturing = true;
      continue;
    }
    if (line === SENTINEL_END) {
      break;
    }
    if (capturing && line.length > 0) {
      if (delimiter && !line.includes(delimiter)) {
        continue;
      }
      result.push(line);
    }
  }
  return result;
}

/**
 * Extract `PREFIX=a|b|c` records between sentinel markers, one per line.
 *
 * Metadata queries emit one short record per %put so results survive log
 * line wrapping (LINESIZE, SSH pty width) regardless of how many items exist.
 */
function parsePrefixedRecords(stdout: string, prefix: string): string[][] {
  const marker = `${prefix}=`;
  return parseSentinelOutput(stdout)
    .filter((l) => l.startsWith(marker))
    .map((l) => l.slice(marker.length).split("|").map((s) => s.trim()));
}

/**
 * Group `PREFIX<i>=rest` lines between sentinel markers by index i, keeping
 * every line for an index in order. Used by the indexed metadata queries.
 */
function parseIndexedRecords(
  stdout: string,
  prefix: string,
): Map<number, string[]> {
  const pattern = new RegExp(`^${prefix}(\\d+)=(.*)$`);
  const records = new Map<number, string[]>();
  for (const line of parseSentinelOutput(stdout)) {
    const match = pattern.exec(line);
    if (!match) {
      continue;
    }
    const i = parseInt(match[1], 10);
    records.set(i, [...(records.get(i) ?? []), match[2]]);
  }
  return records;
}

/** Parse the `COL=name|type|length|format|informat|label` records of a column query. */
function parseColumnRecords(output: string): ColumnInfo[] {
  return parsePrefixedRecords(output, "COL")
    .filter(([name]) => name)
    .map(([name, type, len, fmt, inf, ...label]) => ({
      name,
      type: type || "char",
      length: len ? parseInt(len, 10) : undefined,
      format: fmt || undefined,
      informat: inf || undefined,
      label: label.join("|") || undefined,
    }));
}

/** Parse a SAS numeric value from the log; missing (".", ".A") is null. */
function parseSasNumber(value: string | undefined): number | null {
  const v = value?.trim() ?? "";
  if (v === "" || /^\.[A-Z_]?$/i.test(v)) {
    return null;
  }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

export interface BinningStats {
  n: number;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  nonInteger: number;
}

export interface HistogramBins {
  lo: number;
  width: number;
  nbins: number;
}

export interface FrequencyTable {
  values: string[];
  counts: number[];
  otherCount: number;
}

/** Validate a SAS identifier (libname, memname). Returns uppercased value or throws. */
export function sasIdent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string for SAS identifier, got ${typeof value}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SAS identifier: '${value}'`);
  }
  return value.toUpperCase();
}

/** Background jobs only run when no foreground job is waiting. */
export type Priority = "foreground" | "background";

interface QueuedJob {
  code: string;
  resolve: (output: string) => void;
  reject: (err: unknown) => void;
}

/**
 * Helper tables the Data Explorer keeps in WORK for a sorted or filtered
 * view. They're hidden from the Variables and Connections panes.
 */
export const DATA_VIEW_PREFIX = "_SASDV";

export function isInternalTableName(name: string): boolean {
  return name.toUpperCase().startsWith(DATA_VIEW_PREFIX);
}

/**
 * The dictionary.tables columns that change when a dataset does, joined with
 * catx('|', ...) into a dataset's change stamp.
 */
const STAMP_FIELDS = "put(modate, 20.), put(nlobs, 20.), put(nvar, 20.)";

/** What SasClient.openDataset returns: everything to show a dataset's first rows. */
export interface OpenedDataset {
  /** "DATA" or "VIEW"; undefined when the dataset doesn't exist. */
  memtype?: string;
  columns: ColumnInfo[];
  rowCount: number;
  /** Change stamp, as in getDatasetStamps. */
  stamp?: string;
  /** The first rows of the first `rowColumns` columns, as getDatasetRows returns them. */
  rows: string[];
  rowColumns: number;
}

/**
 * A macro that writes the rows held in macro variables _dr1.._dr<_drn> to the
 * log as `DR<i>=|chunk` lines of up to VALUE_CHUNK characters, so log line
 * wrapping can't split a wide row. The leading "|" keeps leading blanks.
 */
function emitRowsMacro(name: string): string {
  return `%macro ${name};
  %local _i _j _len;
  %if %symexist(_drn) %then %do;
    %do _i = 1 %to &_drn;
      %let _len = %length(%superq(_dr&_i));
      %do _j = 1 %to &_len %by ${VALUE_CHUNK};
        %put DR&_i=|%qsubstr(%superq(_dr&_i), &_j, %sysfunc(min(${VALUE_CHUNK}, %eval(&_len - &_j + 1))));
      %end;
      %symdel _dr&_i / nowarn;
    %end;
    %symdel _drn / nowarn;
  %end;
%mend;`;
}

/** Parse the rows written by emitRowsMacro, in order. */
export function parseDataRows(output: string): string[] {
  const records = parseIndexedRecords(output, "DR");
  return [...records.keys()]
    .sort((a, b) => a - b)
    .map((i) =>
      joinChunks(
        records.get(i)!.map((chunk) => (chunk.startsWith("|") ? chunk.slice(1) : chunk)),
        0,
      ),
    );
}

/** Data step statements that build `_row_` from the given columns. */
function rowBuilder(columnNames: string[]): string {
  return columnNames
    .map((col) => `_row_ = cats(_row_, "|", strip(vvalue(${col})));`)
    .join("\n    ");
}

// The properties read from dictionary.tables: output key, SQL expression.
const PROPERTY_FIELDS: Array<[string, string]> = [
  ["MEMTYPE", "memtype"],
  ["LABEL", "memlabel"],
  ["CREATED", "put(crdate, e8601dt19.)"],
  ["MODIFIED", "put(modate, e8601dt19.)"],
  ["ROWS", "put(nlobs, 20.)"],
  ["DELETED", "put(delobs, 20.)"],
  ["COLUMNS", "put(nvar, 20.)"],
  ["ROWLENGTH", "put(obslen, 20.)"],
  ["FILESIZE", "put(filesize, 20.)"],
  ["COMPRESS", "compress"],
  ["ENCODING", "encoding"],
  ["DATAREP", "datarep"],
];

/** Parse the output of SasClient.openDataset. */
export function parseOpenedDataset(output: string): OpenedDataset {
  const [head] = parsePrefixedRecords(output, "OPEN");
  const [memtype, rowColumns, rowCount, ...stamp] = head ?? [];
  return {
    memtype: memtype || undefined,
    columns: parseColumnRecords(output),
    rowCount: parseSasNumber(rowCount) ?? 0,
    stamp: memtype ? stamp.join("|") : undefined,
    rows: parseDataRows(output),
    rowColumns: parseSasNumber(rowColumns) ?? 0,
  };
}

/** Parse the output of getDatasetProperties. */
export function parseDatasetProperties(
  output: string,
  lib: string,
  mem: string,
): DatasetProperties | undefined {
  const values = new Map<string, string>();
  for (const line of parseSentinelOutput(output)) {
    const match = /^PROP_([A-Z]+)=(.*)$/.exec(line);
    if (match) {
      values.set(match[1], match[2].trim());
    }
  }
  if (!values.has("MEMTYPE")) {
    return undefined;
  }
  const text = (key: string) => {
    const value = values.get(key);
    return value && value !== "." ? value : undefined;
  };
  const number = (key: string) => {
    const value = Number(text(key));
    return text(key) !== undefined && Number.isFinite(value) ? value : undefined;
  };
  return {
    lib,
    mem,
    memtype: text("MEMTYPE") ?? "DATA",
    label: text("LABEL"),
    created: text("CREATED"),
    modified: text("MODIFIED"),
    rows: number("ROWS"),
    deletedRows: number("DELETED"),
    columns: number("COLUMNS"),
    rowLength: number("ROWLENGTH"),
    fileSize: number("FILESIZE"),
    compression: text("COMPRESS"),
    encoding: text("ENCODING"),
    dataRepresentation: text("DATAREP"),
    sortedBy: (text("SORTEDBY") ?? "").split(/\s+/).filter(Boolean),
  };
}

export interface SummaryStats {
  minValue: number | null;
  maxValue: number | null;
  meanValue: number | null;
  stdevValue: number | null;
  medianValue: number | null;
}

export interface StringStats {
  numUnique: number;
  numEmpty: number;
}

/** The column profile queries to run together, by column name. */
export interface ProfileStatsRequest {
  nullCounts: string[];
  numericStats: string[];
  stringStats: string[];
  frequencyTables: Array<{ column: string; limit: number }>;
  binning: string[];
}

/** The results of getColumnProfileStats, in request order. */
export interface ProfileStats {
  nullCounts: number[];
  numericStats: SummaryStats[];
  stringStats: StringStats[];
  frequencyTables: FrequencyTable[];
  binning: BinningStats[];
}

/**
 * One query of a job: SAS steps, the %put statements that write its results
 * between the sentinels, and steps that clean up after it. Several queries
 * can share a job; their macro variables and record prefixes are distinct.
 */
interface QueryParts {
  setup: string;
  emit: string;
  cleanup?: string;
}

function assembleQuery(parts: QueryParts[]): string {
  return `
options nosource nonotes;
${parts.map((p) => p.setup).join("\n")}
%put ${SENTINEL_START};
${parts.map((p) => p.emit).join("\n")}
%put ${SENTINEL_END};
${parts.map((p) => p.cleanup ?? "").join("\n")}
options notes source;
`;
}

/** `LIB.MEM`, validated. */
function dataSource(lib: unknown, mem: unknown): string {
  return `${sasIdent(lib)}.${sasIdent(mem)}`;
}

function nullCountQuery(source: string, columnNames: string[], where?: string): QueryParts {
  // Indexed macro names: `_nc_<column>` exceeds SAS's 32-character limit
  // for long column names.
  const selectExprs = columnNames
    .map((col, i) => `nmiss(${col}) as _nc${i}`)
    .join(", ");
  const intoExprs = columnNames.map((_, i) => `:_nc${i} trimmed`).join(", ");
  return {
    setup: `${columnNames.map((_, i) => `%let _nc${i}=0;`).join("\n")}
proc sql noprint;
  select ${selectExprs}
  into ${intoExprs}
  from ${source}
  ${where ? `where ${where}` : ""};
quit;`,
    emit: columnNames.map((_, i) => `%put NC${i}=&_nc${i};`).join("\n"),
  };
}

function parseNullCounts(output: string, count: number): number[] {
  const records = parseIndexedRecords(output, "NC");
  return Array.from(
    { length: count },
    (_, i) => parseInt(records.get(i)?.[0] ?? "0", 10) || 0,
  );
}

const SUMMARY_STATS = ["min", "max", "mean", "median", "std"];

function summaryStatsQuery(source: string, columnNames: string[], where?: string): QueryParts {
  // Indexed macro names, see nullCountQuery.
  const selectExprs = columnNames
    .map((col, i) =>
      SUMMARY_STATS.map((fn, k) => `${fn}(${col}) as _s${i}_${k}`).join(", "),
    )
    .join(", ");
  const intoExprs = columnNames
    .map((_, i) => SUMMARY_STATS.map((_fn, k) => `:_s${i}_${k}`).join(", "))
    .join(", ");
  const initLines = columnNames
    .map((_, i) => SUMMARY_STATS.map((_fn, k) => `%let _s${i}_${k}=;`).join(" "))
    .join("\n");
  return {
    setup: `${initLines}
proc sql noprint;
  select ${selectExprs}
  into ${intoExprs}
  from ${source}
  ${where ? `where ${where}` : ""};
quit;`,
    emit: columnNames
      .map(
        (_, i) =>
          `%put STATS${i}=${SUMMARY_STATS.map((_fn, k) => `&_s${i}_${k}`).join("|")};`,
      )
      .join("\n"),
  };
}

function parseSummaryStats(output: string, count: number): SummaryStats[] {
  const records = parseIndexedRecords(output, "STATS");
  return Array.from({ length: count }, (_, i) => {
    const vals = records.get(i)?.[0]?.split("|") ?? [];
    return {
      minValue: parseSasNumber(vals[0]),
      maxValue: parseSasNumber(vals[1]),
      meanValue: parseSasNumber(vals[2]),
      medianValue: parseSasNumber(vals[3]),
      stdevValue: parseSasNumber(vals[4]),
    };
  });
}

function binningStatsQuery(source: string, columnNames: string[], where?: string): QueryParts {
  const idx = columnNames.map((_, i) => i);
  const names = (prefix: string) => idx.map((i) => `${prefix}${i}`).join(" ");
  return {
    setup: `${idx.map((i) => `%let _hs${i}=; %let _ni${i}=0;`).join("\n")}
proc sql;
  create view work._sas_hv as
  select ${columnNames.join(", ")} from ${source}
  ${where ? `where ${where}` : ""};
quit;
proc means data=work._sas_hv noprint;
  var ${columnNames.join(" ")};
  output out=work._sas_hs n=${names("_n")} min=${names("_lo")} max=${names("_hi")} q1=${names("_qa")} q3=${names("_qb")};
run;
proc sql noprint;
  select ${columnNames.map((col) => `sum(${col} ne int(${col}))`).join(", ")}
  into ${idx.map((i) => `:_ni${i} trimmed`).join(", ")}
  from work._sas_hv;
quit;
data _null_;
  set work._sas_hs;
  ${idx
    .map(
      (i) =>
        `call symputx('_hs${i}', catx('|', ${["_n", "_lo", "_hi", "_qa", "_qb"]
          .map((v) => `put(${v}${i}, best32.)`)
          .join(", ")}));`,
    )
    .join("\n  ")}
run;`,
    emit: idx.map((i) => `%put HS${i}=&_hs${i}|&_ni${i};`).join("\n"),
    cleanup: `proc datasets library=work nolist;
  delete _sas_hs;
  delete _sas_hv / memtype=view;
quit;`,
  };
}

function parseBinningStats(output: string, count: number): BinningStats[] {
  const records = parseIndexedRecords(output, "HS");
  return Array.from({ length: count }, (_, i) => {
    const vals = records.get(i)?.[0]?.split("|") ?? [];
    return {
      n: parseSasNumber(vals[0]) ?? 0,
      min: parseSasNumber(vals[1]),
      max: parseSasNumber(vals[2]),
      q1: parseSasNumber(vals[3]),
      q3: parseSasNumber(vals[4]),
      nonInteger: parseSasNumber(vals[5]) ?? 0,
    };
  });
}

function frequencyTablesQuery(
  source: string,
  requests: Array<{ column: string; limit: number }>,
  where?: string,
): QueryParts {
  // Each request reads its own alias (_fv<i>) from the view, so a column
  // named COUNT or PERCENT can't clash with PROC FREQ's output variables.
  const steps = requests
    .map(
      ({ limit }, i) => `proc freq data=work._sas_fv noprint;
  tables _fv${i} / out=work._sas_ft${i}(keep=_fv${i} count);
run;
proc sort data=work._sas_ft${i}; by descending count _fv${i}; run;
data _null_;
  set work._sas_ft${i}(obs=${Math.max(1, Math.floor(limit))});
  call symputx(cats('_ftv${i}_', _n_), substr(strip(vvalue(_fv${i})), 1, 60));
  call symputx(cats('_ftc${i}_', _n_), count);
  call symputx('_ftn${i}', _n_);
run;`,
    )
    .join("\n");
  return {
    setup: `${requests.map((_, i) => `%let _ftn${i}=0; %let _ftt${i}=0;`).join("\n")}
proc sql;
  create view work._sas_fv as
  select ${requests.map(({ column }, i) => `${column} as _fv${i}`).join(", ")}
  from ${source}
  ${where ? `where ${where}` : ""};
quit;
proc sql noprint;
  select ${requests.map((_, i) => `count(_fv${i})`).join(", ")}
  into ${requests.map((_, i) => `:_ftt${i} trimmed`).join(", ")}
  from work._sas_fv;
quit;
${steps}`,
    emit: `%macro _sas_emit_ft;
${requests
  .map(
    (_, i) => `  %put FTT${i}=&_ftt${i};
  %do _j = 1 %to &_ftn${i};
    %put FT${i}=&&_ftc${i}_&_j|%superq(_ftv${i}_&_j);
  %end;`,
  )
  .join("\n")}
%mend;
%_sas_emit_ft;`,
    cleanup: `proc datasets library=work nolist;
  delete ${requests.map((_, i) => `_sas_ft${i}`).join(" ")};
  delete _sas_fv / memtype=view;
quit;`,
  };
}

function parseFrequencyTables(output: string, count: number): FrequencyTable[] {
  const totals = parseIndexedRecords(output, "FTT");
  const records = parseIndexedRecords(output, "FT");
  return Array.from({ length: count }, (_, i) => {
    const values: string[] = [];
    const counts: number[] = [];
    for (const line of records.get(i) ?? []) {
      // Split on the first "|" only: values may contain "|".
      const sep = line.indexOf("|");
      const n = parseInt(sep >= 0 ? line.slice(0, sep) : line, 10);
      if (sep < 0 || isNaN(n)) {
        continue;
      }
      counts.push(n);
      values.push(line.slice(sep + 1));
    }
    const total = parseInt(totals.get(i)?.[0] ?? "0", 10) || 0;
    const shown = counts.reduce((sum, n) => sum + n, 0);
    return { values, counts, otherCount: Math.max(0, total - shown) };
  });
}

function stringStatsQuery(source: string, columnNames: string[], where?: string): QueryParts {
  const idx = columnNames.map((_, i) => i);
  return {
    setup: `${idx.map((i) => `%let _ssu${i}=0; %let _sse${i}=0;`).join("\n")}
proc sql noprint;
  select ${columnNames
    .map((col) => `count(distinct ${col}), sum(missing(${col}))`)
    .join(", ")}
  into ${idx.map((i) => `:_ssu${i} trimmed, :_sse${i} trimmed`).join(", ")}
  from ${source}
  ${where ? `where ${where}` : ""};
quit;`,
    emit: idx.map((i) => `%put SS${i}=&_ssu${i}|&_sse${i};`).join("\n"),
  };
}

function parseStringStats(output: string, count: number): StringStats[] {
  const records = parseIndexedRecords(output, "SS");
  return Array.from({ length: count }, (_, i) => {
    const [unique, empty] = records.get(i)?.[0]?.split("|") ?? [];
    return {
      numUnique: parseSasNumber(unique) ?? 0,
      numEmpty: parseSasNumber(empty) ?? 0,
    };
  });
}

/**
 * Encapsulates all SAS metadata queries used by the Positron integration.
 *
 * Takes an executor function that submits SAS code and returns stdout so it
 * can be used with different execution backends (normal run, silent run, etc.).
 *
 * IMPORTANT — sentinel placement: the SENTINEL_START marker is placed AFTER
 * all PROC SQL / DATA step code runs, immediately before the %put statements
 * that emit result values. This ensures that when `source` is on, the echoed
 * code lines appear in the log BEFORE the sentinel and are never captured as
 * data.
 */
export class SasClient {
  private readonly columnCache = new Map<string, Promise<ColumnInfo[]>>();
  private readonly foreground: QueuedJob[] = [];
  private readonly background: QueuedJob[] = [];
  private running = false;

  constructor(
    private readonly executor: (code: string) => Promise<string>,
  ) {}

  /**
   * Run SAS code through the executor, one job at a time. SAS runs the jobs
   * one by one anyway, so holding them here costs nothing, and it lets jobs
   * the user waits for (rows, counts) overtake background ones (column
   * profiles). Jobs held here also never fill the session's silent queue,
   * nor get rejected from it when the user runs code.
   */
  private execute(code: string, priority: Priority = "foreground"): Promise<string> {
    return new Promise((resolve, reject) => {
      (priority === "background" ? this.background : this.foreground).push({
        code,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.running) {
      return;
    }
    const job = this.foreground.shift() ?? this.background.shift();
    if (!job) {
      return;
    }
    this.running = true;
    let started: Promise<string>;
    try {
      started = this.executor(job.code);
    } catch (err) {
      started = Promise.reject(err);
    }
    started.then(job.resolve, job.reject).finally(() => {
      this.running = false;
      this.drain();
    });
  }

  /** Return the names of all assigned SAS libraries (excluding map libraries). */
  async getLibraryList(): Promise<string[]> {
    const output = await this.execute(`
options nosource nonotes;
%let _sas_n=0;
proc sql noprint;
  select distinct libname
  into :_sas_lib1-
  from sashelp.vlibnam
  where libname not in ('MAPS','MAPSSAS','MAPSGFK');
  %let _sas_n=&sqlobs;
quit;
%put ${SENTINEL_START};
%macro _sas_emit;
  %do _i = 1 %to &_sas_n;
    %put LIB=%superq(_sas_lib&_i);
    %symdel _sas_lib&_i / nowarn;
  %end;
%mend;
%_sas_emit;
%put ${SENTINEL_END};
options notes source;
`);
    return parsePrefixedRecords(output, "LIB")
      .map(([name]) => name)
      .filter(Boolean);
  }

  /** Return all DATA/VIEW members of a library. */
  async getLibraryMembers(lib: unknown): Promise<LibraryMember[]> {
    const libname = sasIdent(lib);
    const output = await this.execute(`
options nosource nonotes;
%let _sas_n=0;
proc sql noprint;
  select memname, memtype
  into :_sas_mem1-, :_sas_typ1-
  from dictionary.tables
  where libname="${libname}"
    and memtype in ('DATA','VIEW')
  order by memname;
  %let _sas_n=&sqlobs;
quit;
%put ${SENTINEL_START};
%macro _sas_emit;
  %do _i = 1 %to &_sas_n;
    %put MEM=%superq(_sas_mem&_i)|%superq(_sas_typ&_i);
    %symdel _sas_mem&_i _sas_typ&_i / nowarn;
  %end;
%mend;
%_sas_emit;
%put ${SENTINEL_END};
options notes source;
`);
    return parsePrefixedRecords(output, "MEM")
      .filter(([name]) => name && !(libname === "WORK" && isInternalTableName(name)))
      .map(([name, type]) => ({ name, type: type || "DATA" }));
  }

  /** Clear the column metadata cache (e.g. after a dataset is modified). */
  clearColumnCache(): void {
    this.columnCache.clear();
  }

  /** Return column metadata for a dataset, in variable-number order. Cached per table. */
  getDatasetColumns(lib: unknown, mem: unknown): Promise<ColumnInfo[]> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const key = `${libname}.${memname}`;
    const existing = this.columnCache.get(key);
    if (existing) {
      return existing;
    }
    const promise = this._fetchDatasetColumns(libname, memname).finally(() => {
      this.columnCache.delete(key);
    });
    this.columnCache.set(key, promise);
    return promise;
  }

  private async _fetchDatasetColumns(libname: string, memname: string): Promise<ColumnInfo[]> {
    const output = await this.execute(`
${SAVE_OPTIONS}
%let _sas_n=0;
proc sql noprint;
  select name, type, length, format, informat, label
  into :_sas_col1-, :_sas_typ1-, :_sas_len1-, :_sas_fmt1-, :_sas_inf1-, :_sas_lbl1-
  from dictionary.columns
  where libname="${libname}" and memname="${memname}"
  order by varnum;
  %let _sas_n=&sqlobs;
quit;
%put ${SENTINEL_START};
%macro _sas_emit;
  %do _i = 1 %to &_sas_n;
    %put COL=%superq(_sas_col&_i)|%superq(_sas_typ&_i)|%superq(_sas_len&_i)|%superq(_sas_fmt&_i)|%superq(_sas_inf&_i)|%superq(_sas_lbl&_i);
  %end;
%mend;
%_sas_emit;
%put ${SENTINEL_END};
${RESTORE_OPTIONS}
`);
    return parseColumnRecords(output);
  }

  /** Return what dictionary.tables says about a dataset or view. */
  async getDatasetProperties(
    lib: unknown,
    mem: unknown,
  ): Promise<DatasetProperties | undefined> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const fields = PROPERTY_FIELDS.map(([, expr]) => expr).join(",\n         ");
    const into = PROPERTY_FIELDS.map((_, i) => `:_sas_p${i + 1} trimmed`).join(", ");
    const emit = PROPERTY_FIELDS.map(
      ([key], i) => `    %put PROP_${key}=%superq(_sas_p${i + 1});`,
    ).join("\n");
    const output = await this.execute(`
${SAVE_OPTIONS}
%let _sas_pn=0;
%let _sas_sort=;
proc sql noprint;
  select ${fields}
    into ${into}
    from dictionary.tables
    where libname="${libname}" and memname="${memname}";
  %let _sas_pn=&sqlobs;
  select name into :_sas_sort separated by ' '
    from dictionary.columns
    where libname="${libname}" and memname="${memname}" and sortedby > 0
    order by sortedby;
quit;
%put ${SENTINEL_START};
%macro _sas_pemit;
  %if &_sas_pn > 0 %then %do;
${emit}
    %put PROP_SORTEDBY=%superq(_sas_sort);
  %end;
%mend;
%_sas_pemit;
%put ${SENTINEL_END};
${RESTORE_OPTIONS}
`);
    return parseDatasetProperties(output, libname, memname);
  }

  /**
   * Return the change stamps of datasets, keyed by `LIB.MEM`. Datasets that
   * don't exist are missing from the map.
   */
  async getDatasetStamps(
    datasets: Array<{ lib: unknown; mem: unknown }>,
  ): Promise<Map<string, DatasetStamp>> {
    const stamps = new Map<string, DatasetStamp>();
    if (datasets.length === 0) {
      return stamps;
    }
    const where = datasets
      .map(({ lib, mem }) => `(libname="${sasIdent(lib)}" and memname="${sasIdent(mem)}")`)
      .join("\n      or ");
    const output = await this.execute(`
options nosource nonotes;
%let _sas_n=0;
proc sql noprint;
  select catx('|', libname, memname, memtype, ${STAMP_FIELDS})
    into :_sas_st1-
    from dictionary.tables
    where ${where};
  %let _sas_n=&sqlobs;
quit;
%put ${SENTINEL_START};
%macro _sas_stemit;
  %do _i = 1 %to &_sas_n;
    %put STAMP=%superq(_sas_st&_i);
  %end;
%mend;
%_sas_stemit;
%put ${SENTINEL_END};
options notes source;
`);
    for (const [libname, memname, memtype, ...stamp] of parsePrefixedRecords(
      output,
      "STAMP",
    )) {
      stamps.set(`${libname}.${memname}`, { memtype, stamp: stamp.join("|") });
    }
    return stamps;
  }

  /** Return row count, optionally with a pre-built WHERE clause. */
  async getDatasetRowCount(
    lib: unknown,
    mem: unknown,
    where?: string,
  ): Promise<number> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const whereClause = where ? `where ${where}` : "";
    const output = await this.execute(`
options nosource nonotes;
%let _sas_nobs=0;
proc sql noprint;
  select count(*)
  into :_sas_nobs
  from ${libname}.${memname}
  ${whereClause};
quit;
%put ${SENTINEL_START};
%put &_sas_nobs;
%put ${SENTINEL_END};
options notes source;
`);
    const lines = parseSentinelOutput(output);
    if (lines.length === 0) {
      return 0;
    }
    return parseInt(lines[0].trim(), 10) || 0;
  }

  /**
   * Return rows from a dataset as `|a|b|c` strings (one per row).
   * Columns are in the order given by columnNames.
   *
   * Uses %put inside a macro loop so that data reaches the SAS log, which is
   * the only output channel guaranteed to be available across all connection
   * types (REST, SSH, ITC). DATA step `put` writes to the listing/print
   * destination which the REST API does not deliver.
   */
  async getDatasetRows(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    startIndex: number,
    numRows: number,
    where?: string,
    orderBy?: string,
  ): Promise<string[]> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const timestamp = Date.now();
    const tmpTable = `_dv_${timestamp}`;

    const whereClause = where ? `where ${where}` : "";
    const orderByClause = orderBy ? `order by ${orderBy}` : "";
    // Join column names with newlines to avoid SSH pty line-wrapping (80 char limit)
    const colList = columnNames.join(",\n    ");  // for PROC SQL SELECT

    // Build per-column concatenation. Use pipe as delimiter — it survives the
    // SAS log → REST JSON → JavaScript transport without encoding issues.
    const colCatCode = rowBuilder(columnNames);

    const firstObs = startIndex + 1;
    const lastObs  = startIndex + numRows;

    // When there is no filter or sort, read directly from the source dataset —
    // no temp table needed, one fewer SAS step.
    const needsTempTable = !!(whereClause || orderByClause);

    // Use call symputx + %put instead of putlog. On SSH connections, putlog
    // output can route through a different log stream (onSessionLogFn) than
    // %put output (onExecutionLogFn), causing the silent execution capture to
    // miss data rows on first use. Using %put ensures all output is captured
    // through the same channel that works for metadata queries.
    const output = needsTempTable
      ? await this.execute(`
${SAVE_OPTIONS}
proc sql noprint;
  create table work.${tmpTable} as
  select ${colList} from ${libname}.${memname}
  ${whereClause}
  ${orderByClause};
quit;
data _null_;
  set work.${tmpTable}(firstobs=${firstObs} obs=${lastObs});
  length _row_ $32767;
  _row_ = "";
  ${colCatCode}
  call symputx(cats('_dr', _n_), _row_, 'L');
  call symputx('_drn', _n_, 'L');
run;
%put ${SENTINEL_START};
${emitRowsMacro("_emit_dr")}
%_emit_dr;
%put ${SENTINEL_END};
proc datasets library=work nolist; delete ${tmpTable}; quit;
${RESTORE_OPTIONS}
`)
      : await this.execute(`
${SAVE_OPTIONS}
data _null_;
  set ${libname}.${memname}(firstobs=${firstObs} obs=${lastObs});
  length _row_ $32767;
  _row_ = "";
  ${colCatCode}
  call symputx(cats('_dr', _n_), _row_, 'L');
  call symputx('_drn', _n_, 'L');
run;
%put ${SENTINEL_START};
${emitRowsMacro("_emit_dr")}
%_emit_dr;
%put ${SENTINEL_END};
${RESTORE_OPTIONS}
`);

    return parseDataRows(output);
  }

  /**
   * Everything the Data Explorer needs to show a dataset, in one job: its
   * type, change stamp, columns, row count (dictionary.tables, or a count
   * for views) and the first `rows` rows of its first `maxColumns` columns.
   * Each job is a round trip to SAS, which on Viya is several HTTP requests.
   */
  async openDataset(
    lib: unknown,
    mem: unknown,
    { rows, maxColumns }: { rows: number; maxColumns: number },
  ): Promise<OpenedDataset> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const output = await this.execute(`
%macro _sas_open;
%local _sas_opt _sas_n _sas_k _sas_mt _sas_nobs _sas_stamp _drn _i;
${SAVE_OPTIONS}
%let _sas_n=0;
%let _sas_k=0;
%let _drn=0;
proc sql noprint;
  select memtype, put(nlobs, 20.), catx('|', ${STAMP_FIELDS})
    into :_sas_mt trimmed, :_sas_nobs trimmed, :_sas_stamp trimmed
    from dictionary.tables
    where libname="${libname}" and memname="${memname}";
  select name, type, length, format, informat, label
    into :_sas_col1-, :_sas_typ1-, :_sas_len1-, :_sas_fmt1-, :_sas_inf1-, :_sas_lbl1-
    from dictionary.columns
    where libname="${libname}" and memname="${memname}"
    order by varnum;
  %let _sas_n=&sqlobs;
quit;
%if %length(&_sas_mt) > 0 %then %do;
  %if &_sas_mt = VIEW or %length(&_sas_nobs) = 0 or %superq(_sas_nobs) = .
      or %index(%superq(_sas_nobs), -) > 0 %then %do;
    proc sql noprint;
      select count(*) into :_sas_nobs trimmed from ${libname}.${memname};
    quit;
  %end;
  %let _sas_k=%sysfunc(min(&_sas_n, ${Math.max(0, Math.floor(maxColumns))}));
  %if &_sas_k > 0 and ${Math.floor(rows)} > 0 %then %do;
    data _null_;
      set ${libname}.${memname}(obs=${Math.floor(rows)});
      length _row_ $32767;
      _row_ = "";
      %do _i = 1 %to &_sas_k;
        _row_ = cats(_row_, "|", strip(vvalue(&&_sas_col&_i)));
      %end;
      call symputx(cats('_dr', _n_), _row_, 'L');
      call symputx('_drn', _n_, 'L');
    run;
  %end;
%end;
%put ${SENTINEL_START};
%put OPEN=%superq(_sas_mt)|&_sas_k|%superq(_sas_nobs)|%superq(_sas_stamp);
%do _i = 1 %to &_sas_n;
  %put COL=%superq(_sas_col&_i)|%superq(_sas_typ&_i)|%superq(_sas_len&_i)|%superq(_sas_fmt&_i)|%superq(_sas_inf&_i)|%superq(_sas_lbl&_i);
%end;
%_sas_open_rows;
%put ${SENTINEL_END};
${RESTORE_OPTIONS}
%mend _sas_open;
${emitRowsMacro("_sas_open_rows")}
%_sas_open
%sysmacdelete _sas_open / nowarn;
%sysmacdelete _sas_open_rows / nowarn;
`);
    return parseOpenedDataset(output);
  }

  /**
   * Create `work.<table>` holding the rows of a dataset that pass `where`,
   * in `orderBy` order, and return how many there are. `drop` names earlier
   * WORK tables to delete in the same job.
   */
  async materializeDataset(
    lib: unknown,
    mem: unknown,
    table: string,
    where?: string,
    orderBy?: string,
    drop: string[] = [],
  ): Promise<number> {
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const target = sasIdent(table);
    const dropStep = drop.length > 0
      ? `proc datasets library=work nolist nowarn; delete ${drop.map(sasIdent).join(" ")}; quit;`
      : "";
    const output = await this.execute(`
${SAVE_OPTIONS}
%let _sas_nobs=0;
${dropStep}
proc sql noprint;
  create table work.${target} as
  select * from ${libname}.${memname}
  ${where ? `where ${where}` : ""}
  ${orderBy ? `order by ${orderBy}` : ""};
  %let _sas_nobs=&sqlobs;
quit;
%put ${SENTINEL_START};
%put &_sas_nobs;
%put ${SENTINEL_END};
%symdel _sas_nobs / nowarn;
${RESTORE_OPTIONS}
`);
    const lines = parseSentinelOutput(output);
    return parseInt(lines[0]?.trim() ?? "", 10) || 0;
  }

  /** Return null counts for a set of columns (batched into one query). */
  async getColumnNullCounts(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    where?: string,
  ): Promise<number[]> {
    if (columnNames.length === 0) {
      return [];
    }
    const output = await this.execute(
      assembleQuery([nullCountQuery(dataSource(lib, mem), columnNames, where)]),
    );
    return parseNullCounts(output, columnNames.length);
  }

  /** Return summary stats for a set of numeric columns (batched into one query). */
  async getColumnSummaryStats(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    where?: string,
  ): Promise<SummaryStats[]> {
    if (columnNames.length === 0) {
      return [];
    }
    const output = await this.execute(
      assembleQuery([summaryStatsQuery(dataSource(lib, mem), columnNames, where)]),
    );
    return parseSummaryStats(output, columnNames.length);
  }

  /**
   * Return the statistics needed to bin numeric columns for a histogram:
   * non-missing count, min, max, quartiles and the number of non-integer
   * values. The WHERE clause is applied in a PROC SQL view so that it has
   * the same semantics as the other queries (e.g. LIKE ... ESCAPE).
   */
  async getColumnBinningStats(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    where?: string,
  ): Promise<BinningStats[]> {
    if (columnNames.length === 0) {
      return [];
    }
    const output = await this.execute(
      assembleQuery([binningStatsQuery(dataSource(lib, mem), columnNames, where)]),
    );
    return parseBinningStats(output, columnNames.length);
  }

  /**
   * Count the values of numeric columns per histogram bin. Bin b covers
   * [lo + b*width, lo + (b+1)*width); values beyond the last edge (rounding)
   * are clamped into the last bin. Returns one array of `nbins` counts per
   * request.
   */
  async getColumnHistogramCounts(
    lib: unknown,
    mem: unknown,
    requests: Array<{ column: string; bins: HistogramBins }>,
    where?: string,
    priority: Priority = "foreground",
  ): Promise<number[][]> {
    const queried = requests
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.bins.nbins > 0 && r.bins.width > 0);
    const results = requests.map((r) => new Array<number>(r.bins.nbins).fill(0));
    if (queried.length === 0) {
      return results;
    }
    const source = dataSource(lib, mem);

    const queries = queried
      .map(({ column, bins, i }) => {
        const filter = `not missing(${column})${where ? ` and (${where})` : ""}`;
        const bin = `max(0, min(${bins.nbins - 1}, floor((${column} - (${bins.lo})) / (${bins.width}))))`;
        return `  select b, count(*) into :_hb${i}b1-, :_hb${i}n1-
  from (select ${bin} as b from ${source} where ${filter})
  group by b;
  %let _hbn${i}=&sqlobs;`;
      })
      .join("\n");

    const output = await this.execute(
      assembleQuery([
        {
          setup: `${queried.map(({ i }) => `%let _hbn${i}=0;`).join("\n")}
proc sql noprint;
${queries}
quit;`,
          emit: `%macro _sas_emit_hb;
${queried
  .map(
    ({ i }) => `  %do _j = 1 %to &_hbn${i};
    %put HB${i}=&&_hb${i}b&_j|&&_hb${i}n&_j;
  %end;`,
  )
  .join("\n")}
%mend;
%_sas_emit_hb;`,
        },
      ]),
      priority,
    );

    const records = parseIndexedRecords(output, "HB");
    for (const { i } of queried) {
      for (const line of records.get(i) ?? []) {
        const [b, n] = line.split("|").map((v) => parseInt(v, 10));
        if (b >= 0 && b < results[i].length && !isNaN(n)) {
          results[i][b] += n;
        }
      }
    }
    return results;
  }

  /**
   * Return the most frequent non-missing values of each column (ties ordered
   * by value) plus the count of all other non-missing values. Values are
   * truncated to 60 characters to stay clear of SSH terminal line wrapping.
   */
  async getColumnFrequencyTables(
    lib: unknown,
    mem: unknown,
    requests: Array<{ column: string; limit: number }>,
    where?: string,
  ): Promise<FrequencyTable[]> {
    if (requests.length === 0) {
      return [];
    }
    const output = await this.execute(
      assembleQuery([frequencyTablesQuery(dataSource(lib, mem), requests, where)]),
    );
    return parseFrequencyTables(output, requests.length);
  }

  /** Return distinct and empty (missing) value counts for character columns. */
  async getColumnStringStats(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    where?: string,
  ): Promise<StringStats[]> {
    if (columnNames.length === 0) {
      return [];
    }
    const output = await this.execute(
      assembleQuery([stringStatsQuery(dataSource(lib, mem), columnNames, where)]),
    );
    return parseStringStats(output, columnNames.length);
  }

  /**
   * Run the column profile queries the Data Explorer's summary panel needs
   * (null counts, summary stats, frequency tables and histogram binning
   * stats) as one background job instead of one job each.
   */
  async getColumnProfileStats(
    lib: unknown,
    mem: unknown,
    request: ProfileStatsRequest,
    where?: string,
  ): Promise<ProfileStats> {
    const source = dataSource(lib, mem);
    const parts: QueryParts[] = [];
    if (request.nullCounts.length > 0) {
      parts.push(nullCountQuery(source, request.nullCounts, where));
    }
    if (request.numericStats.length > 0) {
      parts.push(summaryStatsQuery(source, request.numericStats, where));
    }
    if (request.stringStats.length > 0) {
      parts.push(stringStatsQuery(source, request.stringStats, where));
    }
    if (request.frequencyTables.length > 0) {
      parts.push(frequencyTablesQuery(source, request.frequencyTables, where));
    }
    if (request.binning.length > 0) {
      parts.push(binningStatsQuery(source, request.binning, where));
    }
    const output =
      parts.length > 0 ? await this.execute(assembleQuery(parts), "background") : "";
    return {
      nullCounts: request.nullCounts.length > 0
        ? parseNullCounts(output, request.nullCounts.length)
        : [],
      numericStats: request.numericStats.length > 0
        ? parseSummaryStats(output, request.numericStats.length)
        : [],
      stringStats: request.stringStats.length > 0
        ? parseStringStats(output, request.stringStats.length)
        : [],
      frequencyTables: request.frequencyTables.length > 0
        ? parseFrequencyTables(output, request.frequencyTables.length)
        : [],
      binning: request.binning.length > 0
        ? parseBinningStats(output, request.binning.length)
        : [],
    };
  }

  /** Return the GLOBAL and AUTOMATIC macro variables and the WORK tables. */
  async getSessionSnapshot(): Promise<SessionSnapshot> {
    return parseSessionSnapshot(await this.execute(SNAPSHOT_CODE));
  }

  /** Delete GLOBAL macro variables. */
  async deleteMacroVariables(names: string[]): Promise<void> {
    const valid = names.filter((n) => /^[A-Za-z_]\w{0,31}$/.test(n));
    if (valid.length > 0) {
      await this.execute(`%symdel ${valid.join(" ")} / nowarn;`);
    }
  }

  /** Delete datasets and views from WORK. */
  async deleteWorkTables(names: string[]): Promise<void> {
    const valid = names.filter((n) => /^[A-Za-z_]\w{0,31}$/.test(n));
    if (valid.length > 0) {
      await this.execute(`${SAVE_OPTIONS}
proc datasets library=work nolist nowarn memtype=(data view);
  delete ${valid.join(" ")};
quit;
${RESTORE_OPTIONS}`);
    }
  }

  /**
   * Evaluate a macro expression, as on the right side of %LET. The caller
   * must check it with checkMacroExpression first.
   */
  async evaluateMacroExpression(expression: string): Promise<MacroExpressionResult> {
    const error = checkMacroExpression(expression);
    if (error) {
      throw new Error(error);
    }
    // The value goes out in 200-character chunks, so log line wrapping
    // can't split it.
    const output = await this.execute(`
%macro _sas_eval;
%local _sas_opt _sas_ev _sas_len _sas_i;
%let _sas_opt=%sysfunc(getoption(ls,keyword)) %sysfunc(getoption(ps,keyword));
options nosource ls=max ps=max;
%let _sas_ev=${expression};
%let _sas_len=%length(%superq(_sas_ev));
%put ${SENTINEL_START};
%put EVLEN=&_sas_len;
%do _sas_i = 1 %to &_sas_len %by ${VALUE_CHUNK};
  %put EV=|%qsubstr(%superq(_sas_ev), &_sas_i, %sysfunc(min(${VALUE_CHUNK}, %eval(&_sas_len - &_sas_i + 1))));
%end;
%put ${SENTINEL_END};
options source &_sas_opt;
%mend _sas_eval;
%_sas_eval
%sysmacdelete _sas_eval / nowarn;
`);
    return parseMacroExpression(output);
  }
}

/** A GLOBAL or AUTOMATIC macro variable of a SAS session. */
export interface MacroVariable {
  scope: "GLOBAL" | "AUTOMATIC";
  name: string;
  value: string;
}

/** A dataset or view in the WORK library. */
export interface WorkTable {
  name: string;
  memtype: "DATA" | "VIEW";
  /** Undefined for views, whose row count SAS doesn't know. */
  rows?: number;
  columns?: number;
  /** Modification time, ISO 8601. */
  modified?: string;
  label?: string;
}

/** What the Variables pane shows: macro variables and WORK tables. */
export interface SessionSnapshot {
  macros: MacroVariable[];
  tables: WorkTable[];
}

/**
 * Macro variables the extension's own hidden queries create, which aren't
 * the user's: `_SAS_*` and the indexed helpers of the Data Explorer queries.
 */
const INTERNAL_MACRO_NAME =
  /^(_SAS_\w*|_DRN?\d*|_(NC|NI|HS|HBN|SSU|SSE|FTT|FTN)\d+|_S\d+_\d+|_HB\d+[BN]\d+|_FT[VC]\d+_\d+)$/i;

export function isInternalMacroName(name: string): boolean {
  return INTERNAL_MACRO_NAME.test(name);
}

/** Values go to the log in chunks this long, so log line wrapping can't split them. */
const VALUE_CHUNK = 200;

/**
 * Parse the output of getSessionSnapshot. Each macro variable comes as a
 * `MN<i>=scope|name|length` line followed by `MX<i>=|chunk` lines of up to
 * 200 characters; WORK tables as `WT<i>=name|memtype|rows|columns|modified|label`.
 */
export function parseSessionSnapshot(stdout: string): SessionSnapshot {
  const heads = new Map<number, { scope: MacroVariable["scope"]; name: string; length: number }>();
  const chunks = new Map<number, string[]>();
  const tables: WorkTable[] = [];
  for (const line of parseSentinelOutput(stdout)) {
    const match = /^(MN|MX|WT)(\d+)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, kind, index, rest] = match;
    const i = Number(index);
    if (kind === "MN") {
      const [scopeText, name, length] = rest.split("|");
      const scope =
        scopeText === "GLOBAL" || scopeText === "AUTOMATIC" ? scopeText : undefined;
      if (scope && name) {
        heads.set(i, { scope, name, length: Number(length) || 0 });
      }
    } else if (kind === "MX") {
      // The leading "|" keeps leading blanks.
      chunks.set(i, [...(chunks.get(i) ?? []), rest.startsWith("|") ? rest.slice(1) : rest]);
    } else {
      const table = parseWorkTable(rest);
      if (table && !isInternalTableName(table.name)) {
        tables.push(table);
      }
    }
  }
  const macros: MacroVariable[] = [];
  for (const [i, { scope, name, length }] of heads) {
    if (!isInternalMacroName(name)) {
      const value = joinChunks(chunks.get(i) ?? [], length);
      macros.push({ scope, name, value: scope === "AUTOMATIC" ? cleanAutomatic(value) : value });
    }
  }
  return { macros, tables };
}

/**
 * Tidy an AUTOMATIC variable's value: SAS pads some (SYSLAST) with blanks,
 * and a few unset ones hold bytes that aren't text.
 */
export function cleanAutomatic(value: string): string {
  return value.replace(/\uFFFD/g, "").trimEnd();
}

/**
 * Join value chunks written to the log. The log drops trailing blanks, so
 * every chunk but the last is padded back to the chunk width, and the whole
 * value to its known length.
 */
function joinChunks(parts: string[], length: number): string {
  return parts
    .map((p, i) => (i < parts.length - 1 ? p.padEnd(VALUE_CHUNK, " ") : p))
    .join("")
    .padEnd(length, " ");
}

function parseWorkTable(record: string): WorkTable | undefined {
  const [name, memtype, rows, columns, modified, ...label] = record.split("|");
  if (!name || (memtype !== "DATA" && memtype !== "VIEW")) {
    return undefined;
  }
  const count = (value: string | undefined) => {
    const n = parseSasNumber(value);
    return n === null || n < 0 ? undefined : n;
  };
  const time = modified?.trim();
  return {
    name: name.trim(),
    memtype,
    rows: memtype === "VIEW" ? undefined : count(rows),
    columns: count(columns),
    modified: time && time !== "." ? time : undefined,
    label: label.join("|").trim() || undefined,
  };
}

/**
 * SAS code for the snapshot. Everything runs inside a temporary macro whose
 * locals all start with _SAS_, so nothing lands in the GLOBAL table and no
 * local hides a user's global of the same name. VMACRO is read first, before
 * anything else changes the automatic variables, and into a hash: creating
 * macro variables while the view is being read can make it loop. VMACRO
 * only gives the names; the values are written with %SUPERQ, because VMACRO
 * shows the raw bytes of macro-quoted values (%STR, %NRSTR).
 */
const SNAPSHOT_CODE = `
%macro _sas_vars;
%local _sas_opt _sas_mc _sas_wc _sas_i _sas_j _sas_nm _sas_len;
${SAVE_OPTIONS}
%let _sas_mc=0;
%let _sas_wc=0;
data _null_;
  length _s $9 _n $32;
  if _n_ = 1 then do;
    declare hash _h(ordered: 'a');
    _h.defineKey('_k');
    _h.defineData('_s', '_n');
    _h.defineDone();
  end;
  set sashelp.vmacro(where=(scope in ('GLOBAL', 'AUTOMATIC') and offset = 0)) end=_eof;
  _k + 1;
  _s = scope; _n = name;
  _h.add();
  if _eof then do;
    declare hiter _it('_h');
    _i = 0;
    _rc = _it.first();
    do while (_rc = 0);
      if upcase(substr(_n, 1, 5)) ne '_SAS_' then do;
        _i + 1;
        call symputx(cats('_sas_s', _i), _s, 'L');
        call symputx(cats('_sas_n', _i), _n, 'L');
      end;
      _rc = _it.next();
    end;
    call symputx('_sas_mc', _i, 'L');
  end;
run;
data _null_;
  set sashelp.vtable(where=(libname = 'WORK' and memtype in ('DATA', 'VIEW'))) end=_eof;
  call symputx(cats('_sas_w', _n_), strip(memname) || '|' || strip(memtype) || '|'
    || strip(put(nlobs, best20.)) || '|' || strip(put(nvar, best20.)) || '|'
    || strip(put(modate, e8601dt19.)) || '|' || substr(memlabel, 1, 120), 'L');
  if _eof then call symputx('_sas_wc', _n_, 'L');
run;
%put ${SENTINEL_START};
%do _sas_i = 1 %to &_sas_mc;
  %let _sas_nm = &&_sas_n&_sas_i;
  %let _sas_len = %length(%superq(&_sas_nm));
  %put MN&_sas_i=&&_sas_s&_sas_i|&_sas_nm|&_sas_len;
  %do _sas_j = 1 %to &_sas_len %by ${VALUE_CHUNK};
    %put MX&_sas_i=|%qsubstr(%superq(&_sas_nm), &_sas_j, %sysfunc(min(${VALUE_CHUNK}, %eval(&_sas_len - &_sas_j + 1))));
  %end;
%end;
%do _sas_i = 1 %to &_sas_wc;
  %put WT&_sas_i=%superq(_sas_w&_sas_i);
%end;
%put ${SENTINEL_END};
${RESTORE_OPTIONS}
%mend _sas_vars;
%_sas_vars
%sysmacdelete _sas_vars / nowarn;
`;

/**
 * Check a macro expression before it goes into hidden code. A semicolon
 * would end the %LET early, and an unbalanced quote or parenthesis would
 * leave the session waiting for the rest of a statement.
 * Returns an error message, or undefined when the expression is safe.
 */
export function checkMacroExpression(expression: string): string | undefined {
  if (expression.trim() === "") {
    return "Enter a macro expression.";
  }
  if (/[;\r\n]/.test(expression)) {
    return "The expression can't contain a semicolon or a line break.";
  }
  let quote: string | undefined;
  let depth = 0;
  for (const ch of expression) {
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (--depth < 0) {
        return "The expression has an unmatched closing parenthesis.";
      }
    }
  }
  if (quote) {
    return "The expression has an unmatched quote.";
  }
  if (depth > 0) {
    return "The expression has an unmatched opening parenthesis.";
  }
  if (/\/\*|\*\//.test(expression)) {
    return "The expression can't contain a comment.";
  }
  return undefined;
}

/** The result of evaluating a macro expression. */
export interface MacroExpressionResult {
  value: string;
  /** WARNING and ERROR lines from the log. */
  messages: string[];
}

/** Parse the output of evaluateMacroExpression. */
export function parseMacroExpression(stdout: string): MacroExpressionResult {
  const lines = stdout.split("\n").map((l) => l.trimEnd());
  const messages = lines.filter((l) => /^(ERROR|WARNING)( \d+-\d+)?:/.test(l));
  const parts: string[] = [];
  let length = 0;
  for (const line of parseSentinelOutput(stdout)) {
    const len = /^EVLEN=(\d+)$/.exec(line);
    if (len) {
      length = Number(len[1]);
    } else if (line.startsWith("EV=|")) {
      parts.push(line.slice(4));
    }
  }
  return { value: joinChunks(parts, length), messages: [...new Set(messages)] };
}

/** Whether a value has the shape of a SessionSnapshot. */
export function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "macros" in value &&
    "tables" in value &&
    Array.isArray(value.macros) &&
    Array.isArray(value.tables)
  );
}
