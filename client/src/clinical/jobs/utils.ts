// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Pure helpers for clinical jobs: no vscode import, unit-tested directly.
import type {
  ClinicalJob,
  JobResource,
  RawSubmission,
  ResourceLocation,
  RunInfo,
  Submission,
} from "./types";

/** "/a/b/c.cjob" → "/a/b"; "/c.cjob" → "/". */
export function parentPath(path: string): string {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** "/a/b/c.cjob" → "c.cjob". */
export function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** A resource for a file given by its full path. */
export function resourceFromPath(
  path: string,
  resourceLocation: ResourceLocation,
  extra: Partial<JobResource> = {},
): JobResource {
  return {
    name: baseName(path),
    path,
    location: parentPath(path),
    resourceLocation,
    ...extra,
  };
}

/**
 * Resolve a path stored in a job (often relative, such as "./probe.sas" or
 * "../programs/a.sas") against the folder that holds the job.
 */
export function resolveJobPath(location: string, path: string): string {
  if (path.startsWith("/")) {
    return normalizePath(path);
  }
  return normalizePath(`${location.replace(/\/+$/, "")}/${path}`);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

/**
 * Bring a submission to one shape. The live service sends flat fields
 * (jobPath, jobResourceLocation, ...); the spec documents a nested `job`.
 */
export function normalizeSubmission(raw: RawSubmission): Submission {
  const job = raw.job ?? {};
  const path = job.path ?? raw.jobPath ?? "";
  const resourceLocation =
    job.resourceLocation ?? raw.jobResourceLocation ?? raw.type ?? "WORKSPACE";
  const jobId = job.id ?? raw.jobId;
  const jobVersion = job.fileVersion ?? raw.jobVersion;
  const manifest = raw.manifest?.path
    ? resourceFromPath(
        raw.manifest.path,
        raw.manifest.resourceLocation ?? resourceLocation,
        {
          ...(raw.manifest.name ? { name: raw.manifest.name } : {}),
          ...(raw.manifest.id ? { id: raw.manifest.id } : {}),
          ...(raw.manifest.fileVersion
            ? { fileVersion: raw.manifest.fileVersion }
            : {}),
        },
      )
    : undefined;
  const submission: Submission = {
    id: raw.id,
    name: raw.name ?? raw.jobName ?? job.name ?? baseName(path),
    state: raw.state ?? raw.summaryState ?? "NOT_STARTED",
    job: {
      name: job.name ?? raw.jobName ?? raw.name ?? baseName(path),
      path,
      location: job.location ?? raw.jobLocation ?? parentPath(path),
      resourceLocation,
      ...(jobId ? { id: jobId } : {}),
      ...(jobVersion ? { fileVersion: jobVersion } : {}),
    },
    ...(manifest ? { manifest } : {}),
  };
  for (const key of PASSED_THROUGH) {
    if (raw[key] !== undefined) {
      Object.assign(submission, { [key]: raw[key] });
    }
  }
  return submission;
}

/** Submission fields that keep their name and meaning in both shapes. */
const PASSED_THROUGH = [
  "info",
  "type",
  "jobRunContext",
  "submittedTimeStamp",
  "completedTimeStamp",
  "submittedBy",
  "submittedByDisplayName",
  "runAsUser",
  "runAsUserDisplayName",
  "lastSubmittedItem",
  "jobOwner",
  "jobOwnerDisplayName",
  "jobRunAsOwner",
  "checkinFailures",
] satisfies (keyof RawSubmission & keyof Submission)[];

/**
 * The run request for a job. Only name, path, location and resourceLocation:
 * the service rejects fields it does not know.
 */
export function toRunInfo(
  job: JobResource,
  parameterValues: RunInfo["parameterValues"] = [],
): RunInfo {
  return {
    job: {
      name: job.name,
      path: job.path,
      location: job.location,
      resourceLocation: job.resourceLocation,
    },
    ...(parameterValues.length ? { parameterValues } : {}),
  };
}

/**
 * Read a .cjob file. It is JSON without a resource (the API adds one), so the
 * caller says where the file is.
 */
export function parseJobFile(text: string, resource: JobResource): ClinicalJob {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${resource.name} is not a valid clinical job: ${error}`);
  }
  if (!isJobObject(data)) {
    throw new Error(`${resource.name} is not a valid clinical job.`);
  }
  return { ...data, resource };
}

/** A JSON object; every field of a ClinicalJob is optional. */
function isJobObject(data: unknown): data is ClinicalJob {
  return !!data && typeof data === "object" && !Array.isArray(data);
}

/**
 * The submission that wrote a .cmnf file. The file's own format differs from
 * the API's manifest, so the manifest is fetched by this id.
 */
export function manifestSubmissionId(text: string): string | undefined {
  try {
    const id = JSON.parse(text)?.jobSubmission?.id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** `eq(submittedBy,"id")`, the filter for one user's submissions. */
export function submittedByFilter(userId: string): string {
  return `eq(submittedBy,${JSON.stringify(userId)})`;
}
