// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as path from "path";

import {
  TransportLibrefPool,
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
  ): Promise<unknown>;
}

/** A .sas7bdat file, described without VS Code types. */
export interface DataFile {
  /** Identifies the file, e.g. its URI as a string. */
  key: string;
  /** True when SAS can read the file at `filePath` itself. */
  local: boolean;
  /** The file system path (local files) or the URI path. */
  filePath: string;
  /** Reads the file, for files SAS can't read itself. */
  read(): Thenable<Uint8Array> | Promise<Uint8Array>;
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
