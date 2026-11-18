// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as path from "path";

import {
  TRANSPORT_HEADER_BYTES,
  TransportLibrefPool,
  buildTransportLoadCode,
  detectTransportFormat,
  findSasErrors,
  quoteLocalPath,
  workPathLiteral,
} from "./xptFormat";

// No VS Code imports: this module is unit-tested without VS Code.

/** The SAS session calls a data file needs. */
export interface DataFileSession {
  runSilent(code: string): Promise<string>;
  uploadToWork(
    subdir: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<string>;
  listMembers(lib: string): Promise<Array<{ name: string }>>;
}

/** A .sas7bdat or .xpt file, described without VS Code types. */
export interface DataFile {
  /** Identifies the file, e.g. its URI as a string. */
  key: string;
  /** True when SAS can read the file at `filePath` itself. */
  local: boolean;
  /** The file system path (local files) or the URI path. */
  filePath: string;
  /** Reads the file, for files SAS can't read itself. */
  read(): Thenable<Uint8Array> | Promise<Uint8Array>;
  /**
   * Reads the start of a file SAS can read itself, when it isn't on this
   * machine (files on the SAS server); by default, from `filePath`.
   */
  readHeader?(): Promise<Uint8Array>;
}

export interface DataFileLibrary {
  libref: string;
  member: string;
}

// One libref per folder for local files (_FVIEW1, _FVIEW2, ...), so a file
// from another folder never re-points the library of a file that is still
// open in the Data Explorer.
const localLibrefs = new TransportLibrefPool("_FVIEW");
// Files from non-local views (Clinical Repository, SAS Content) are copied
// into WORK, one directory and libref per file.
const uploadLibrefs = new TransportLibrefPool("_FVW");

const EXISTS_MARKER = "_SASFEXIST=";

/**
 * Whether an existence check found what it looked for: false when the log
 * says 0, true otherwise (also when the check didn't run).
 */
function checkPassed(log: string): boolean {
  const match = new RegExp(`${EXISTS_MARKER}(\\d+)`).exec(log);
  return !match || match[1] !== "0";
}

/**
 * Assign a libref through which SAS reads a .sas7bdat file, copying the file
 * into WORK first when SAS can't read it where it is: a file from a view,
 * or a file on this machine that a SAS server can't see.
 */
export async function assignDataFileLibrary(
  session: DataFileSession,
  file: DataFile,
): Promise<DataFileLibrary> {
  const ext = path.extname(file.filePath);
  const member = path.basename(file.filePath, ext).toUpperCase();
  if (file.local) {
    const dir = path.dirname(file.filePath);
    const libref = localLibrefs.librefFor(dir);
    const log = await session.runSilent(
      [
        `libname ${libref} ${quoteLocalPath(dir)};`,
        `%put ${EXISTS_MARKER}%sysfunc(max(%sysfunc(exist(${libref}.${member})), %sysfunc(exist(${libref}.${member}, VIEW))));`,
      ].join("\n"),
    );
    if (findSasErrors(log).length === 0 && checkPassed(log)) {
      return { libref, member };
    }
    // SAS doesn't see the file there, e.g. SAS on a server without this
    // machine's disk: copy it into WORK as for files from views.
  }
  // SAS on UNIX only finds datasets whose file names are lowercase.
  const libref = uploadLibrefs.librefFor(file.key);
  await session.uploadToWork(
    libref.toLowerCase(),
    `${member.toLowerCase()}${ext.toLowerCase()}`,
    await file.read(),
  );
  const errors = findSasErrors(
    await session.runSilent(
      `libname ${libref} ${workPathLiteral(libref.toLowerCase())};`,
    ),
  );
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
  return { libref, member };
}

/** Whether SAS can read the file at `filePath` itself. */
async function sasSeesFile(
  session: DataFileSession,
  filePath: string,
): Promise<boolean> {
  return checkPassed(
    await session.runSilent(
      `%put ${EXISTS_MARKER}%sysfunc(fileexist(${quoteLocalPath(filePath)}));`,
    ),
  );
}

// One libref per transport file (_FXPT1, _FXPT2, ...).
const transportLibrefs = new TransportLibrefPool();

/** Read the first bytes of a file without loading all of it. */
async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = new Uint8Array(TRANSPORT_HEADER_BYTES);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      TRANSPORT_HEADER_BYTES,
      0,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The file is not an XPORT or CPORT transport file. */
export class NotTransportFileError extends Error {}

/**
 * Unpack a transport file (XPORT v5, v8/9 or CPORT) into a library of its
 * own, and list its datasets. Files SAS can't read where they are are
 * copied into WORK first.
 */
export async function loadTransportFile(
  session: DataFileSession,
  file: DataFile,
): Promise<{ libref: string; members: string[] }> {
  // A file on this machine that a SAS server can't see is copied into WORK,
  // as files from views are.
  const content =
    !file.local || !(await sasSeesFile(session, file.filePath))
      ? await file.read()
      : undefined;
  const format = detectTransportFormat(
    content
      ? content.subarray(0, TRANSPORT_HEADER_BYTES)
      : await (file.readHeader?.() ?? readHeader(file.filePath)),
  );
  if (!format) {
    throw new NotTransportFileError(
      `${path.basename(file.filePath)} is not a SAS transport file (XPORT or CPORT).`,
    );
  }
  const libref = transportLibrefs.librefFor(file.key);
  const source = content
    ? await session.uploadToWork(
        "_fxptsrc",
        `${libref.toLowerCase()}.xpt`,
        content,
      )
    : quoteLocalPath(file.filePath);
  const errors = findSasErrors(
    await session.runSilent(buildTransportLoadCode(format, source, libref)),
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const members = (await session.listMembers(libref)).map((m) => m.name);
  return { libref, members };
}
