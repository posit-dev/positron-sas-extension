// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Helpers for opening SAS transport files (.xpt) in the Data Explorer.
 * Kept free of `vscode` imports so they can be unit tested.
 */

/** The transport file flavours the SAS server can read back. */
export type TransportFormat = "xport5" | "xport8" | "cport";

/** Number of header bytes needed by {@link detectTransportFormat}. */
export const TRANSPORT_HEADER_BYTES = 80;

const XPORT5_HEADER = "HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!";
const XPORT8_HEADER = "HEADER RECORD*******LIBV8   HEADER RECORD!!!!!!!";
const CPORT_HEADER = "**COMPRESSED** **COMPRESSED**";

/**
 * Identify a transport file from its first bytes. XPORT files (written by the
 * XPORT engine or %LOC2XPT) start with a fixed library header record; PROC
 * CPORT files start with a run of "**COMPRESSED**" markers.
 */
export function detectTransportFormat(
  header: Uint8Array,
): TransportFormat | undefined {
  const text = Buffer.from(header).toString("latin1");
  if (text.startsWith(XPORT5_HEADER)) {
    return "xport5";
  }
  if (text.startsWith(XPORT8_HEADER)) {
    return "xport8";
  }
  if (text.startsWith(CPORT_HEADER)) {
    return "cport";
  }
  return undefined;
}

function sasQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SAS code that unpacks a transport file into `libref`, a library in its own
 * directory under WORK. The data is copied once because the XPORT engine is
 * sequential, while the Data Explorer re-reads pages, counts and dictionary
 * metadata on every request.
 */
export function buildTransportLoadCode(
  format: TransportFormat,
  filePath: string,
  libref: string,
): string {
  const dir = libref.toLowerCase();
  const file = sasQuote(filePath);
  const setup = [
    `data _null_; length d $1024; d=dcreate("${dir}", pathname("work")); run;`,
    `libname ${libref} "%sysfunc(pathname(work))/${dir}";`,
    `proc datasets lib=${libref} kill nolist nowarn; quit;`,
  ];
  switch (format) {
    case "xport5":
      return [
        ...setup,
        `libname _XPTIN xport ${file};`,
        `proc copy in=_XPTIN out=${libref} memtype=data; run;`,
        `libname _XPTIN clear;`,
      ].join("\n");
    case "xport8":
      return [...setup, `%xpt2loc(libref=${libref}, filespec=${file})`].join(
        "\n",
      );
    case "cport":
      return [
        ...setup,
        `filename _XPTIN ${file};`,
        `proc cimport infile=_XPTIN library=${libref} memtype=data; run;`,
        `filename _XPTIN clear;`,
      ].join("\n");
  }
}

/** ERROR lines from a SAS log, e.g. "ERROR: ..." or "ERROR 22-322: ...". */
export function findSasErrors(log: string): string[] {
  return log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^ERROR(\s+\d+-\d+)?:/.test(line));
}

/**
 * Hands out one libref per transport file (`_FXPT1`, `_FXPT2`, ...), so
 * reopening a file refreshes its own library and never clobbers a dataset
 * from another file that is still open in the Data Explorer.
 */
export class TransportLibrefPool {
  private readonly librefs = new Map<string, string>();

  librefFor(filePath: string): string {
    let libref = this.librefs.get(filePath);
    if (!libref) {
      // Librefs are at most 8 characters: "_FXPT" plus up to three digits.
      const next = (this.librefs.size % 999) + 1;
      libref = `_FXPT${next}`;
      this.librefs.set(filePath, libref);
    }
    return libref;
  }
}
