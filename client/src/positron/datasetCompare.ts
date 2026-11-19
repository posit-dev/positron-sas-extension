// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { sasIdent } from "./sasClient";

// No VS Code imports: this module is unit-tested without VS Code.

/** A dataset as SAS sees it, and the name to show for it. */
export interface DatasetRef {
  lib: string;
  mem: string;
  /** Shown to the user, e.g. `WORK.CLASS` or `adsl.sas7bdat`. */
  label: string;
}

export interface CompareOptions {
  base: DatasetRef;
  compare: DatasetRef;
  /** Variables that match observations; none matches them by position. */
  idVars: string[];
  /** Largest absolute difference of numeric values counted as equal. */
  tolerance?: number;
}

/** The dataset that holds the differing observations of the last compare. */
export const COMPARE_OUT = { lib: "WORK", mem: "_COMPARE" };

/**
 * The sorted copy of a dataset, named after it (`_B_ADSL`, `_C_ADSL`) because
 * the report names the datasets it compared.
 */
function sortedCopy(prefix: "_B_" | "_C_", mem: string): string {
  return `${prefix}${sasIdent(mem).slice(0, 32 - prefix.length)}`;
}

/** A string as a single-quoted SAS literal, which SAS doesn't macro-resolve. */
function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function datasetName(ref: DatasetRef): string {
  return `${sasIdent(ref.lib)}.${sasIdent(ref.mem)}`;
}

/** The title of a compare report. */
export function compareTitle(options: CompareOptions): string {
  return `Compare ${options.base.label} (base) with ${options.compare.label}`;
}

/**
 * The SAS code of a compare, run in the console so the user sees it. With
 * ID variables, both datasets are sorted into WORK first, as PROC COMPARE
 * needs. The differing observations go to WORK._COMPARE (OUTNOEQUAL), and
 * the return code to the macro variable _SAS_CMPRC.
 */
export function buildCompareCode(options: CompareOptions): string {
  const base = datasetName(options.base);
  const compare = datasetName(options.compare);
  const ids = options.idVars.map(sasIdent);
  const tolerance = options.tolerance;
  if (
    tolerance !== undefined &&
    (!Number.isFinite(tolerance) || tolerance < 0)
  ) {
    throw new Error(`Invalid tolerance: ${tolerance}`);
  }

  const lines: string[] = [];
  let baseData = base;
  let compareData = compare;
  const sortedCopies: string[] = [];
  if (ids.length > 0) {
    const by = ids.join(" ");
    const sortedBase = sortedCopy("_B_", options.base.mem);
    const sortedCompare = sortedCopy("_C_", options.compare.mem);
    lines.push(
      `proc sort data=${base} out=WORK.${sortedBase}; by ${by}; run;`,
      `proc sort data=${compare} out=WORK.${sortedCompare}; by ${by}; run;`,
    );
    baseData = `WORK.${sortedBase}`;
    compareData = `WORK.${sortedCompare}`;
    sortedCopies.push(sortedBase, sortedCompare);
  }
  const method =
    tolerance !== undefined && tolerance > 0
      ? ` method=absolute criterion=${tolerance}`
      : "";
  // PROC COMPARE writes a text report, centered on the line size (often
  // 256): left-align it on 132 columns so the Viewer shows it, then restore
  // the user's options.
  lines.push(
    "%let _sas_cmpopt=%sysfunc(getoption(center)) ls=%sysfunc(getoption(linesize));",
    "options nocenter ls=132;",
    `title ${quote(compareTitle(options))};`,
    `proc compare base=${baseData} compare=${compareData} listall${method}`,
    `    out=${COMPARE_OUT.lib}.${COMPARE_OUT.mem} outnoequal outbase outcomp outdif;`,
  );
  if (ids.length > 0) {
    lines.push(`  id ${ids.join(" ")};`);
  }
  lines.push(
    "run;",
    "%let _sas_cmprc=&sysinfo;",
    "title;",
    "options &_sas_cmpopt;",
  );
  if (sortedCopies.length > 0) {
    lines.push(
      `proc datasets lib=WORK nolist nowarn; delete ${sortedCopies.join(" ")}; quit;`,
    );
  }
  return lines.join("\n");
}

/**
 * Silent code run before a compare, so a failed compare never reports the
 * result of an earlier one.
 */
export const COMPARE_PREP_CODE = `proc datasets lib=WORK nolist nowarn; delete _COMPARE; quit;
%symdel _sas_cmprc / nowarn;`;

/** Silent code that reports the return code and the number of differences. */
export const COMPARE_STATUS_CODE = `options nosource nonotes;
%let _sas_cmpn=0;
proc sql noprint; select count(*) into :_sas_cmpn trimmed from WORK._COMPARE; quit;
%macro _sas_cmpst;
  %if %symexist(_sas_cmprc) %then %put CMPSTATUS=&_sas_cmprc|&_sas_cmpn;
  %else %put CMPSTATUS=|&_sas_cmpn;
%mend;
%_sas_cmpst
options notes source;`;

export interface CompareStatus {
  /** PROC COMPARE's return code (&SYSINFO), if it ran. */
  returnCode?: number;
  /** Observations in WORK._COMPARE. */
  differenceRows: number;
}

/** Read the line that COMPARE_STATUS_CODE writes to the log. */
export function parseCompareStatus(log: string): CompareStatus | undefined {
  const match = /^CMPSTATUS=(\d*)\|(\d+)\s*$/m.exec(log);
  if (!match) {
    return undefined;
  }
  return {
    returnCode: match[1] === "" ? undefined : parseInt(match[1], 10),
    differenceRows: parseInt(match[2], 10),
  };
}

// The bits of PROC COMPARE's return code, in the order SAS documents them.
const RESULT_BITS: Array<[number, string]> = [
  [1, "the dataset labels differ"],
  [2, "the dataset types differ"],
  [4, "variables have different informats"],
  [8, "variables have different formats"],
  [16, "variables have different lengths"],
  [32, "variables have different labels"],
  [64, "observations only in the base dataset"],
  [128, "observations only in the compare dataset"],
  [256, "BY groups only in the base dataset"],
  [512, "BY groups only in the compare dataset"],
  [1024, "variables only in the base dataset"],
  [2048, "variables only in the compare dataset"],
  [4096, "unequal values"],
  [8192, "variables with conflicting types"],
  [16384, "BY variables don't match"],
];

const FATAL = 32768;

export interface CompareResult {
  identical: boolean;
  /** PROC COMPARE stopped with a fatal error and compared nothing. */
  fatal: boolean;
  /** What differs, in words. */
  differences: string[];
}

/** Decode PROC COMPARE's return code (&SYSINFO). */
export function describeCompareResult(returnCode: number): CompareResult {
  const fatal = (returnCode & FATAL) !== 0;
  const differences = RESULT_BITS.filter(
    ([bit]) => (returnCode & bit) !== 0,
  ).map(([, text]) => text);
  return { identical: returnCode === 0, fatal, differences };
}

/**
 * The columns both datasets have, in the base dataset's order, for picking
 * ID variables. SAS names compare without regard to case.
 */
export function commonColumns(
  base: Array<{ name: string }>,
  compare: Array<{ name: string }>,
): string[] {
  const names = new Set(compare.map((c) => c.name.toUpperCase()));
  return base.map((c) => c.name).filter((n) => names.has(n.toUpperCase()));
}

/**
 * The label of a Data Explorer tab for a title: Positron shows
 * `Data: <title>`, with titles over 30 characters cut to 27 and `...`.
 */
export function dataExplorerTabLabel(title: string): string {
  return `Data: ${title.length > 30 ? `${title.substring(0, 27)}...` : title}`;
}
