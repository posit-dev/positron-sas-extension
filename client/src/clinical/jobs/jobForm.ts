// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The clinical job editor's model: reading and writing .cjob text, paths
// relative to the job, validation, and the messages between the extension and
// the editor's webview. Shared by both sides, so no vscode import.
import type {
  ClinicalJob,
  JobParameter,
  ParameterType,
  ResourceLocation,
} from "./types";
import { parentPath, resolveJobPath } from "./utils";

export const PARAMETER_TYPES: ParameterType[] = [
  "CHARACTER",
  "CHARACTER_MASKED",
  "NUMERIC",
  "DATE",
  "FILE",
  "FOLDER",
];

/** A job file as the editor holds it: fields it does not know are kept. */
export type JobFile = ClinicalJob & Record<string, unknown>;

export type ParseResult = { job: JobFile } | { error: string };

/** Read the text of a .cjob file; an empty file is an empty job. */
export function parseJobText(text: string): ParseResult {
  if (!text.trim()) {
    return { job: {} };
  }
  try {
    const data: unknown = JSON.parse(text);
    if (!isJobFile(data)) {
      return { error: "The file is not a JSON object." };
    }
    return { job: data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function isJobFile(data: unknown): data is JobFile {
  return !!data && typeof data === "object" && !Array.isArray(data);
}

/** The text of a .cjob file, formatted like the service writes it. */
export function serializeJobFile(job: JobFile): string {
  return `${JSON.stringify(job, null, 2)}\n`;
}

/**
 * The path of `absolute` relative to the folder `location`, as the service
 * stores paths in a job: "./a.sas", "../programs/a.sas".
 */
export function relativeJobPath(location: string, absolute: string): string {
  const from = location.split("/").filter(Boolean);
  const to = absolute.split("/").filter(Boolean);
  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    from[common] === to[common]
  ) {
    common++;
  }
  const up = from.length - common;
  const rest = to.slice(common).join("/");
  if (!up) {
    return `./${rest}`;
  }
  return `${"../".repeat(up)}${rest}`.replace(/\/$/, "");
}

/** Where a path stored in the job points, for display and opening. */
export const absoluteJobPath = resolveJobPath;

/** The folder of a job file. */
export const jobFolder = parentPath;

// SAS macro variable names: parameters reach the programs as macro variables.
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export type ProblemKind =
  | "noPrograms"
  | "programPath"
  | "parameterName"
  | "parameterDuplicate"
  | "parameterNumber"
  | "parameterDate";

export interface JobProblem {
  kind: ProblemKind;
  /** The program or parameter it is about. */
  index?: number;
}

/** What is wrong with a job, as far as the editor can tell. */
export function validateJobFile(job: JobFile): JobProblem[] {
  const problems: JobProblem[] = [];
  const programs = job.programs ?? [];
  if (!programs.length) {
    problems.push({ kind: "noPrograms" });
  }
  programs.forEach((program, index) => {
    if (!program.path?.trim()) {
      problems.push({ kind: "programPath", index });
    }
  });
  const seen = new Set<string>();
  (job.parameters ?? []).forEach((param, index) => {
    if (!PARAMETER_NAME.test(param.name ?? "")) {
      problems.push({ kind: "parameterName", index });
    } else if (seen.has(param.name.toUpperCase())) {
      problems.push({ kind: "parameterDuplicate", index });
    }
    seen.add((param.name ?? "").toUpperCase());
    const value = param.defaultValue;
    if (typeof value === "string" && value.trim()) {
      if (param.type === "NUMERIC" && !Number.isFinite(Number(value))) {
        problems.push({ kind: "parameterNumber", index });
      }
      if (param.type === "DATE" && Number.isNaN(Date.parse(value))) {
        problems.push({ kind: "parameterDate", index });
      }
    }
  });
  return problems;
}

/** The default value a parameter of `type` starts with. */
export function emptyDefault(
  type: ParameterType,
): JobParameter["defaultValue"] {
  switch (type) {
    case "FILE":
      return { path: "" };
    case "FOLDER":
      return { path: "", includeSubfolders: false };
    default:
      return "";
  }
}

/** A date input's YYYY-MM-DD as the service stores date defaults. */
export const dateToDefault = (date: string): string =>
  date ? `${date}T00:00:00Z` : "";

/** A stored date default as YYYY-MM-DD for a date input. */
export const defaultToDate = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 10) : "";

/** Texts of the editor, translated by the extension. */
export interface EditorLabels {
  run: string;
  openAsJson: string;
  readOnly: string;
  invalidJson: string;
  general: string;
  description: string;
  programs: string;
  programsHint: string;
  addProgram: string;
  path: string;
  version: string;
  latest: string;
  open: string;
  moveUp: string;
  moveDown: string;
  remove: string;
  parameters: string;
  parametersHint: string;
  addParameter: string;
  name: string;
  label: string;
  type: string;
  defaultValue: string;
  includeSubfolders: string;
  browse: string;
  outputs: string;
  outputsHint: string;
  logsLocation: string;
  resultsLocation: string;
  manifestLocation: string;
  repository: string;
  repositoryHint: string;
  inputFiles: string;
  inputFolders: string;
  includeFiles: string;
  addFile: string;
  addFolder: string;
  checkin: string;
  checkinVersion: string;
  versionNone: string;
  versionMajor: string;
  versionMinor: string;
  versionNewFiles: string;
  checkinLocations: string;
  none: string;
  problems: Record<ProblemKind, string>;
  types: Record<ParameterType, string>;
}

/** Messages from the extension to the webview. */
export type ToEditor =
  | {
      type: "init";
      text: string;
      readOnly: boolean;
      /** The folder of the job, for relative paths. */
      location: string;
      resourceLocation: ResourceLocation;
      /** Whether paths can be picked and opened (CA files only). */
      canBrowse: boolean;
      fileName: string;
      labels: EditorLabels;
    }
  | { type: "text"; text: string }
  | { type: "picked"; requestId: number; path?: string };

/** Messages from the webview to the extension. */
export type FromEditor =
  | { type: "ready" }
  | { type: "edit"; text: string }
  | {
      type: "pick";
      requestId: number;
      mode: "file" | "folder";
      resourceLocation: ResourceLocation;
      startPath?: string;
    }
  | { type: "open"; path: string }
  | { type: "run" }
  | { type: "openText" };
