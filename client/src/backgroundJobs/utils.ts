// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Pure helpers for background jobs. Nothing here imports `vscode`, so it can be
// unit tested outside the extension host.
import { createHash } from "crypto";

import { SUBMITTER } from "./const";
import type { ExecutionJob, JobFile, Link } from "./types";

const FILE_URI = /^\/files\/files\/[^/]+$/;

/** Whether a value in a job's `results` map names a file in the Files service. */
export function isFileUri(value: string | undefined): boolean {
  return !!value && FILE_URI.test(value);
}

/** The file id in `/files/files/{id}`. */
export function fileIdOf(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/**
 * What a result key says the file is. The Compute provider names them after
 * the compute job, e.g. "B2BA8016-….log.txt", and uploads the log and the
 * listing twice, as JSON and as plain text.
 */
export function classifyResultKey(key: string): JobFile["kind"] {
  const lower = key.toLowerCase();
  if (lower.endsWith(".log.txt")) {
    return "log";
  }
  if (lower.endsWith(".log")) {
    return "logJson";
  }
  if (lower.endsWith(".listing.txt") || lower.endsWith(".lst")) {
    return "listing";
  }
  if (lower.endsWith(".listing")) {
    return "listingJson";
  }
  return "other";
}

/**
 * The files a finished job produced. Entries whose value is not a Files
 * service URI — COMPUTE_JOB, COMPUTE_SESSION, COMPUTE_CONTEXT — are left out;
 * they belong in the job's tooltip.
 */
export function jobFiles(job: ExecutionJob | undefined): JobFile[] {
  const results = job?.results ?? {};
  return Object.entries(results)
    .filter(([, value]) => isFileUri(value))
    .map(([key, uri]) => ({
      key,
      uri,
      id: fileIdOf(uri),
      kind: classifyResultKey(key),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The values in `results` that are not files, for the tooltip. */
export function jobDetails(job: ExecutionJob | undefined): [string, string][] {
  return Object.entries(job?.results ?? {}).filter(
    ([, value]) => !isFileUri(value),
  );
}

/**
 * The plain-text log. `logLocation` points at the JSON log, so prefer the
 * `.log.txt` result; fall back to the JSON one, which the caller can render.
 */
export function logFileOf(job: ExecutionJob | undefined): JobFile | undefined {
  const files = jobFiles(job);
  return (
    files.find((f) => f.kind === "log") ??
    files.find((f) => f.kind === "logJson")
  );
}

/** The structured log, whose lines carry their own type. */
export function logJsonFileOf(
  job: ExecutionJob | undefined,
): JobFile | undefined {
  const files = jobFiles(job);
  const byKey = files.find((f) => f.kind === "logJson");
  if (byKey) {
    return byKey;
  }
  // Fall back to logLocation, which is the JSON log.
  const uri = job?.logLocation;
  return isFileUri(uri)
    ? { key: "log", uri: uri!, id: fileIdOf(uri!), kind: "logJson" }
    : undefined;
}

/**
 * What "Open Results" shows. A background job produces the SAS listing, not
 * ODS HTML, so prefer the plain-text listing; an HTML result is used if a
 * deployment ever produces one.
 */
export function resultFileOf(
  job: ExecutionJob | undefined,
): JobFile | undefined {
  const files = jobFiles(job);
  const html = files.find(
    (f) =>
      /\.html?$/i.test(f.key) ||
      /html/i.test(f.contentType ?? "") ||
      /\.html?$/i.test(f.name ?? ""),
  );
  return (
    html ??
    files.find((f) => f.kind === "listing") ??
    files.find((f) => f.kind === "listingJson")
  );
}

/** Find a link by its relation. */
export function getLink(
  links: Link[] | undefined,
  rel: string,
): Link | undefined {
  return (links ?? []).find((link) => link.rel === rel);
}

/**
 * Restrict a job listing to this client's jobs, and to this user's when the
 * user id is known.
 */
export function jobsFilter(userId?: string): string {
  const mine = `eq(submittedByApplication,'${SUBMITTER}')`;
  return userId ? `and(${mine},eq(createdBy,'${userId}'))` : mine;
}

/** Identifies the code of a definition, so an unchanged program is not rewritten. */
export function codeHash(name: string, code: string): string {
  return createHash("sha256").update(`${name}\u0000${code}`).digest("hex");
}

/**
 * The name for a job and its definition: the file's base name, marked when
 * only a selection was submitted.
 */
export function jobNameFor(options: {
  fileName?: string;
  untitled?: boolean;
  selection?: boolean;
}): string {
  const { fileName, untitled, selection } = options;
  let stem = "Untitled";
  if (fileName && !untitled) {
    const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
    const dot = base.lastIndexOf(".");
    stem = dot > 0 ? base.slice(0, dot) : base;
  }
  const name = selection ? `${stem} (selection)` : stem;
  return name.slice(0, 100);
}

/**
 * A definition name that does not collide. The Job Definitions service
 * refuses a create whose name is already a member of the parent folder.
 */
export function nextName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${name} (${Date.now()})`;
}

/** Whether a string is an ISO-8601 duration such as P7D or PT1H. */
export function isDuration(value: string): boolean {
  return /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/.test(
    value,
  );
}

/** Map a VS Code language id such as "pt-br" to a tag SAS accepts. */
export function languageTag(language: string | undefined): string {
  if (!language) {
    return "en-US";
  }
  const parts = language.split("-");
  if (parts.length === 1) {
    return parts[0].toLowerCase();
  }
  return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
}
