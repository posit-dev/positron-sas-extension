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

/**
 * Assign a libref through which SAS reads a .sas7bdat file, copying the file
 * into WORK first when SAS can't read it where it is.
 */
export async function assignDataFileLibrary(
  session: DataFileSession,
  file: DataFile,
): Promise<DataFileLibrary> {
  const ext = path.extname(file.filePath);
  const member = path.basename(file.filePath, ext).toUpperCase();
  let libref: string;
  let location: string;
  if (file.local) {
    const dir = path.dirname(file.filePath);
    libref = localLibrefs.librefFor(dir);
    location = quoteLocalPath(dir);
  } else {
    // SAS on UNIX only finds datasets whose file names are lowercase.
    libref = uploadLibrefs.librefFor(file.key);
    await session.uploadToWork(
      libref.toLowerCase(),
      `${member.toLowerCase()}${ext.toLowerCase()}`,
      await file.read(),
    );
    location = workPathLiteral(libref.toLowerCase());
  }
  const errors = findSasErrors(
    await session.runSilent(`libname ${libref} ${location};`),
  );
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
  return { libref, member };
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
  const content = file.local ? undefined : await file.read();
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
