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

/** A local path as a SAS string literal; single quotes keep `&` and `%` inert. */
export function quoteLocalPath(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const PLAIN_NAME = /^[\w.-]+$/;

/**
 * A directory or file under WORK as a SAS string literal. SAS resolves the
 * WORK path itself: reading it back from the log is unreliable, because
 * %PUT output wraps at the line size and long WORK paths get cut.
 */
export function workPathLiteral(subdir: string, name?: string): string {
  for (const part of [subdir, name ?? "x"]) {
    if (!PLAIN_NAME.test(part)) {
      throw new Error(`Unsupported file name for WORK: ${part}`);
    }
  }
  return `"%sysfunc(pathname(work))/${subdir}${name ? `/${name}` : ""}"`;
}

/**
 * SAS code that unpacks a transport file into `libref`, a library in its own
 * directory under WORK. The data is copied once because the XPORT engine is
 * sequential, while the Data Explorer re-reads pages, counts and dictionary
 * metadata on every request.
 */
export function buildTransportLoadCode(
  format: TransportFormat,
  file: string,
  libref: string,
): string {
  const dir = libref.toLowerCase();
  const setup = [
    buildWorkSubdirCode(dir),
    `libname ${libref} ${workPathLiteral(dir)};`,
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

/**
 * ERROR messages from a SAS log, e.g. "ERROR: ..." or "ERROR 22-322: ...".
 * SAS wraps long messages onto indented continuation lines; those are
 * joined back on.
 */
export function findSasErrors(log: string): string[] {
  const errors: string[] = [];
  let current: string | undefined;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^ERROR(\s+\d+-\d+)?:/.test(line)) {
      current = line;
      errors.push(current);
    } else if (current !== undefined && /^\s+\S/.test(raw)) {
      current = `${current} ${line}`;
      errors[errors.length - 1] = current;
    } else {
      current = undefined;
    }
  }
  return errors;
}

/**
 * Hands out one libref per file (`_FXPT1`, `_FXPT2`, ...), so reopening a
 * file refreshes its own library and never clobbers a dataset from another
 * file that is still open in the Data Explorer.
 */
export class TransportLibrefPool {
  private readonly librefs = new Map<string, string>();
  // Librefs are at most 8 characters: the prefix plus a counter.
  private readonly max: number;

  constructor(private readonly prefix = "_FXPT") {
    this.max = 10 ** (8 - prefix.length) - 1;
  }

  librefFor(key: string): string {
    let libref = this.librefs.get(key);
    if (!libref) {
      libref = `${this.prefix}${(this.librefs.size % this.max) + 1}`;
      this.librefs.set(key, libref);
    }
    return libref;
  }
}

/** SAS code that creates `subdir` under WORK if it doesn't exist yet. */
export function buildWorkSubdirCode(subdir: string): string {
  workPathLiteral(subdir);
  return `data _null_; length d $1024; d=dcreate("${subdir}", pathname("work")); run;`;
}

// Files are sent to SAS as base64 in DATALINES: 57 bytes per 76-character
// line (no semicolons in the base64 alphabet), about 1 MB of code per chunk.
const BYTES_PER_LINE = 57;
const LINES_PER_CHUNK = 13_000;
export const BYTES_PER_CHUNK = BYTES_PER_LINE * LINES_PER_CHUNK;

/**
 * SAS code that decodes one chunk of base64 lines and writes the raw bytes
 * to `file` (a SAS string literal). The first chunk creates the file; later
 * ones append.
 * This only needs SAS to be able to write the target (WORK always is), so it
 * works on every connection type and when SAS runs in lockdown.
 */
export function buildBase64WriteCode(
  file: string,
  chunk: Uint8Array,
  append: boolean,
): string {
  const lines: string[] = [];
  for (let i = 0; i < chunk.length; i += BYTES_PER_LINE) {
    lines.push(
      Buffer.from(
        chunk.buffer,
        chunk.byteOffset + i,
        Math.min(BYTES_PER_LINE, chunk.length - i),
      ).toString("base64"),
    );
  }
  return [
    "options nosource nonotes;",
    "data _null_;",
    "  infile datalines truncover;",
    "  input line $76.;",
    "  length raw $57;",
    `  file ${file} recfm=n${append ? " mod" : ""};`,
    "  n = length(line);",
    "  if n < 4 then return;",
    '  pad = (char(line, n) = "=") + (char(line, n - 1) = "=");',
    '  raw = inputc(substr(line, 1, n), cats("$base64x", n, "."));',
    "  rawlen = n / 4 * 3 - pad;",
    "  put raw $varying57. rawlen;",
    "datalines;",
    ...lines,
    ";",
    "run;",
    "options notes source;",
  ].join("\n");
}

/** Split file content into chunks for {@link buildBase64WriteCode}. */
export function splitIntoChunks(content: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < content.length; i += BYTES_PER_CHUNK) {
    chunks.push(content.subarray(i, i + BYTES_PER_CHUNK));
  }
  return chunks.length > 0 ? chunks : [new Uint8Array()];
}
