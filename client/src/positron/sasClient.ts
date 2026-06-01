// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Sentinel markers wrapping silent execution output to isolate it from log noise. */
const SENTINEL_START = "~~SAS_START~~";
const SENTINEL_END = "~~SAS_END~~";

export interface ColumnInfo {
  name: string;
  type: string; // "num" or "char"
  length?: number;
  format?: string;
}

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

  constructor(
    private readonly execute: (code: string) => Promise<string>,
  ) {}

  /** Return the names of all assigned SAS libraries (excluding map libraries). */
  async getLibraryList(): Promise<string[]> {
    const output = await this.execute(`
options nosource nonotes;
%let _sas_libs=;
proc sql noprint;
  select distinct libname
  into :_sas_libs separated by '|'
  from sashelp.vlibnam
  where libname not in ('MAPS','MAPSSAS','MAPSGFK');
quit;
%put ${SENTINEL_START};
%put &_sas_libs;
%put ${SENTINEL_END};
options notes source;
`);
    const lines = parseSentinelOutput(output);
    if (lines.length === 0) {
      return [];
    }
    return lines[0].split("|").map((s) => s.trim()).filter(Boolean);
  }

  /** Return all DATA/VIEW members of a library. */
  async getLibraryMembers(lib: unknown): Promise<LibraryMember[]> {
    const libname = sasIdent(lib);
    const output = await this.execute(`
options nosource nonotes;
%let _sas_mems=;
%let _sas_types=;
proc sql noprint;
  select memname, memtype
  into :_sas_mems separated by '|',
       :_sas_types separated by '|'
  from dictionary.tables
  where upcase(libname)=upcase("${libname}")
    and memtype in ('DATA','VIEW')
  order by memname;
quit;
%put ${SENTINEL_START};
%put &_sas_mems;
%put &_sas_types;
%put ${SENTINEL_END};
options notes source;
`);
    const lines = parseSentinelOutput(output);
    if (lines.length < 2) {
      return [];
    }
    const names = lines[0].split("|").map((s) => s.trim()).filter(Boolean);
    const types = lines[1].split("|").map((s) => s.trim());
    return names.map((name, i) => ({ name, type: types[i] || "DATA" }));
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
options nosource nonotes;
%let _sas_names=;
%let _sas_types=;
%let _sas_lens=;
%let _sas_fmts=;
proc sql noprint;
  select name, type, length, format
  into :_sas_names separated by '|',
       :_sas_types separated by '|',
       :_sas_lens  separated by '|',
       :_sas_fmts  separated by '|'
  from dictionary.columns
  where upcase(libname)=upcase("${libname}")
    and upcase(memname)=upcase("${memname}")
  order by varnum;
quit;
%put ${SENTINEL_START};
%put &_sas_names;
%put &_sas_types;
%put &_sas_lens;
%put &_sas_fmts;
%put ${SENTINEL_END};
options notes source;
`);
    const lines = parseSentinelOutput(output);
    if (lines.length < 2) {
      return [];
    }
    const names = lines[0].split("|").map((s) => s.trim()).filter(Boolean);
    const types = lines[1].split("|").map((s) => s.trim());
    const lens = lines[2] ? lines[2].split("|").map((s) => s.trim()) : [];
    const fmts = lines[3] ? lines[3].split("|").map((s) => s.trim()) : [];
    return names.map((name, i) => ({
      name,
      type: types[i] || "char",
      length: lens[i] ? parseInt(lens[i], 10) : undefined,
      format: fmts[i] || undefined,
    }));
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
   * Return rows from a dataset as SOH-delimited strings (one per row).
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
    const colCatCode = columnNames
      .map((col) => `_row_ = cats(_row_, "|", strip(vvalue(${col})));`)
      .join("\n    ");

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
options nosource nonotes nomprint nosymbolgen nomlogic ls=max ps=max;
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
%macro _emit_dr;
  %if %symexist(_drn) %then %do;
    %do _i = 1 %to &_drn;
      %put DATAROW=%superq(_dr&_i);
    %end;
  %end;
%mend;
%_emit_dr;
%put ${SENTINEL_END};
proc datasets library=work nolist; delete ${tmpTable}; quit;
options notes source nomprint nosymbolgen nomlogic;
`)
      : await this.execute(`
options nosource nonotes nomprint nosymbolgen nomlogic ls=max ps=max;
data _null_;
  set ${libname}.${memname}(firstobs=${firstObs} obs=${lastObs});
  length _row_ $32767;
  _row_ = "";
  ${colCatCode}
  call symputx(cats('_dr', _n_), _row_, 'L');
  call symputx('_drn', _n_, 'L');
run;
%put ${SENTINEL_START};
%macro _emit_dr;
  %if %symexist(_drn) %then %do;
    %do _i = 1 %to &_drn;
      %put DATAROW=%superq(_dr&_i);
    %end;
  %end;
%mend;
%_emit_dr;
%put ${SENTINEL_END};
options notes source nomprint nosymbolgen nomlogic;
`);

    // Each line between sentinels prefixed with DATAROW= is one data row.
    const PREFIX = "DATAROW=";
    return parseSentinelOutput(output)
      .filter((l) => l.startsWith(PREFIX))
      .map((l) => l.slice(PREFIX.length));
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
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const whereClause = where ? `where ${where}` : "";

    const selectExprs = columnNames
      .map((col) => `nmiss(${col}) as _nc_${col}`)
      .join(", ");
    const intoExprs = columnNames.map((col) => `:_nc_${col}`).join(", ");
    const putLines = columnNames
      .map((col) => `%put NC_${col}=&_nc_${col};`)
      .join("\n");

    const initLines = columnNames.map((col) => `%let _nc_${col}=0;`).join("\n");

    const output = await this.execute(`
options nosource nonotes;
${initLines}
proc sql noprint;
  select ${selectExprs}
  into ${intoExprs}
  from ${libname}.${memname}
  ${whereClause};
quit;
%put ${SENTINEL_START};
${putLines}
%put ${SENTINEL_END};
options notes source;
`);
    const lines = parseSentinelOutput(output);
    return columnNames.map((col) => {
      const line = lines.find((l) => l.startsWith(`NC_${col}=`));
      if (!line) {
        return 0;
      }
      return parseInt(line.split("=")[1]?.trim() ?? "0", 10) || 0;
    });
  }

  /** Return summary stats for a set of numeric columns (batched into one query). */
  async getColumnSummaryStats(
    lib: unknown,
    mem: unknown,
    columnNames: string[],
    where?: string,
  ): Promise<
    Array<{
      minValue: number | null;
      maxValue: number | null;
      meanValue: number | null;
      stdevValue: number | null;
      medianValue: number | null;
    }>
  > {
    if (columnNames.length === 0) {
      return [];
    }
    const libname = sasIdent(lib);
    const memname = sasIdent(mem);
    const whereClause = where ? `where ${where}` : "";

    const selectExprs = columnNames
      .map(
        (col) =>
          `min(${col}) as _min_${col}, max(${col}) as _max_${col}, ` +
          `mean(${col}) as _mean_${col}, median(${col}) as _med_${col}, ` +
          `std(${col}) as _std_${col}`,
      )
      .join(", ");

    const intoExprs = columnNames
      .map(
        (col) =>
          `:_min_${col}, :_max_${col}, :_mean_${col}, :_med_${col}, :_std_${col}`,
      )
      .join(", ");

    const putLines = columnNames
      .map(
        (col) =>
          `%put STATS_${col}=&_min_${col}|&_max_${col}|&_mean_${col}|&_med_${col}|&_std_${col};`,
      )
      .join("\n");

    const initLines = columnNames
      .map((col) => `%let _min_${col}=; %let _max_${col}=; %let _mean_${col}=; %let _med_${col}=; %let _std_${col}=;`)
      .join("\n");

    const output = await this.execute(`
options nosource nonotes;
${initLines}
proc sql noprint;
  select ${selectExprs}
  into ${intoExprs}
  from ${libname}.${memname}
  ${whereClause};
quit;
%put ${SENTINEL_START};
${putLines}
%put ${SENTINEL_END};
options notes source;
`);

    const lines = parseSentinelOutput(output);
    return columnNames.map((col) => {
      const line = lines.find((l) => l.startsWith(`STATS_${col}=`));
      if (!line) {
        return {
          minValue: null,
          maxValue: null,
          meanValue: null,
          stdevValue: null,
          medianValue: null,
        };
      }
      const vals = line.split("=")[1]?.split("|") ?? [];
      const parseNum = (s: string | undefined): number | null => {
        if (!s || s.trim() === "" || s.trim() === ".") {
          return null;
        }
        const n = parseFloat(s.trim());
        return isNaN(n) ? null : n;
      };
      return {
        minValue: parseNum(vals[0]),
        maxValue: parseNum(vals[1]),
        meanValue: parseNum(vals[2]),
        medianValue: parseNum(vals[3]),
        stdevValue: parseNum(vals[4]),
      };
    });
  }
}
