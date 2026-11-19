// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// LSAF jobs over the REST API: create a job from programs, submit it, and
// follow the submission. Nothing here imports `vscode`.
//
// The API documents one submission state ("completed"), no way to list or
// cancel submissions, and no format for job, manifest or log files, so the
// outcome is read leniently from the state and its message.
import { LsafClient, checkAction } from "./LsafClient";
import { jobUrl, submissionUrl } from "./paths";
import type { ActionResult, Area, Job, JobSubmission, Resource } from "./types";

export type RunOutcome =
  "running" | "succeeded" | "warnings" | "failed" | "canceled" | "finished";

/** What a submission's state and message say about how the run went. */
export function runOutcome(
  submission: Pick<JobSubmission, "state" | "message" | "completedTimestamp">,
): RunOutcome {
  const state = (submission.state ?? "").toLowerCase();
  const message = (submission.message ?? "").toLowerCase();
  if (/cancel/.test(state)) {
    return "canceled";
  }
  if (/fail|error|abort|terminat|kill/.test(state)) {
    return "failed";
  }
  if (/complet|success|succeed|finish|done/.test(state)) {
    if (/warn/.test(message)) {
      return "warnings";
    }
    if (/\b(error|fail)/.test(message)) {
      return "failed";
    }
    return "succeeded";
  }
  // An unknown state with a completion time is over all the same.
  return submission.completedTimestamp ? "finished" : "running";
}

export const isTerminal = (
  submission: Pick<JobSubmission, "state" | "message" | "completedTimestamp">,
): boolean => runOutcome(submission) !== "running";

const PARAMETER_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** `name=value` → [name, value]; undefined when it isn't one. */
export function parseParameter(text: string): [string, string] | undefined {
  const match = PARAMETER_PATTERN.exec(text);
  return match ? [match[1], match[2].trim()] : undefined;
}

export class JobsModel {
  constructor(private readonly client: () => LsafClient) {}

  /**
   * Create a job file holding the programs, given relative to it (such as
   * `./adsl.sas`) or as absolute paths. Fails with 409 if the job exists.
   */
  async createJob(
    area: Area,
    jobPath: string,
    programs: string[],
    { createParents = false } = {},
  ): Promise<Job> {
    return this.client().postJson<Job>(
      jobUrl(area, jobPath),
      { createParents, useRelativePaths: true },
      programs,
    );
  }

  /**
   * Submit a job. `parameters` override the job's own values; the API
   * takes them as name/value pairs of strings.
   */
  async submit(
    area: Area,
    jobPath: string,
    parameters?: Record<string, string>,
  ): Promise<string> {
    const hasParameters = !!parameters && Object.keys(parameters).length > 0;
    const result = await this.client().putJson<ActionResult>(
      jobUrl(area, jobPath),
      { action: "run", expand: "status" },
      hasParameters ? parameters : undefined,
    );
    checkAction(result, `Running ${jobPath}`);
    if (!result?.submissionId) {
      throw new Error(
        `The LSAF server accepted ${jobPath} but returned no submission ID.`,
      );
    }
    return result.submissionId;
  }

  getSubmission(id: string): Promise<JobSubmission> {
    return this.client().getJson<JobSubmission>(submissionUrl(id));
  }

  /** The manifest file a completed run wrote. */
  getManifest(id: string): Promise<Resource> {
    return this.client().getJson<Resource>(submissionUrl(id, "manifest"));
  }

  /** The job file a run ran. */
  getJob(id: string): Promise<Resource> {
    return this.client().getJson<Resource>(submissionUrl(id, "job"));
  }
}

/** The area a Resource is in, from its schemaType. */
export function resourceArea(resource: Resource, fallback: Area): Area {
  const type = (resource.schemaType ?? "").toLowerCase();
  if (type.startsWith("workspace")) {
    return "workspace";
  }
  if (type.startsWith("repository")) {
    return "repository";
  }
  return fallback;
}
