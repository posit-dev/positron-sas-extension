// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// SAS data files and Positron's own readers for them (#141). Positron 2026.12
// opens .sas7bdat and .xpt files in the Data Explorer without a session, with
// the DuckDB readers of its `dataExplorer.fileReaders` setting.

// No VS Code imports: this module is unit-tested without VS Code.

/** The SAS data file kinds, by file extension (lower case, no dot). */
export const SAS_DATA_FILE_VIEWERS = {
  sas7bdat: "sas.sas7bdatViewer",
  xpt: "sas.xptViewer",
} as const;

export type SasDataFileKind = keyof typeof SAS_DATA_FILE_VIEWERS;

/** Positron's Data Explorer editor, for `vscode.openWith`. */
export const POSITRON_DATA_EXPLORER_EDITOR =
  "workbench.editor.positronDataExplorer";

/** The extension of a path, lower case and without the dot. */
export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The kind of a SAS data file, whatever the case of its extension. */
export function sasDataFileKind(path: string): SasDataFileKind | undefined {
  const ext = fileExtension(path);
  return ext === "sas7bdat" || ext === "xpt" ? ext : undefined;
}

/** The extension's viewer for a SAS data file. */
export function sasViewerFor(path: string): string | undefined {
  const kind = sasDataFileKind(path);
  return kind && SAS_DATA_FILE_VIEWERS[kind];
}

// As Positron validates `dataExplorer.fileReaders` values: `[repo/]ext[:fn]`;
// an empty value turns the reader off.
const READER_VALUE = /^((core|community)\/)?[a-z0-9_]+(:[a-z0-9_]+)?$/;

/**
 * Whether Positron's `dataExplorer.fileReaders` setting (`readers`) has a
 * reader for the file at `path`. The setting exists from Positron 2026.12.
 */
export function positronHasReader(readers: unknown, path: string): boolean {
  if (!readers || typeof readers !== "object") {
    return false;
  }
  const ext = fileExtension(path);
  if (!ext || !Object.prototype.hasOwnProperty.call(readers, ext)) {
    return false;
  }
  const value: unknown = Object.getOwnPropertyDescriptor(readers, ext)?.value;
  return typeof value === "string" && READER_VALUE.test(value);
}

/**
 * The Data Connections node kind of a SAS data file on the SAS server, which
 * the session can open in the Data Explorer; undefined for other files.
 */
export function serverDataFileKind(name: string): "table" | "view" | undefined {
  switch (fileExtension(name)) {
    case "sas7bdat":
    case "xpt":
      return "table";
    case "sas7bvew":
      return "view";
    default:
      return undefined;
  }
}

/** The `SAS.dataFiles.openWith` setting. */
export type DataFilesOpenWith = "sasWhenSessionRuns" | "positron";

/**
 * The SAS viewer to reopen a Data Explorer with, when Positron opened a SAS
 * data file itself (`fileUri`, no session behind it) while a SAS session
 * runs and the setting asks for SAS; undefined to leave it.
 */
export function viewerToReopenWith(
  openWith: string | undefined,
  sasSessionRunning: boolean,
  source: { sessionId?: string; fileUri?: string } | undefined,
): string | undefined {
  if (openWith === "positron" || !sasSessionRunning || !source?.fileUri) {
    return undefined;
  }
  if (source.sessionId) {
    return undefined;
  }
  return sasViewerFor(source.fileUri.replace(/[?#].*$/, ""));
}
