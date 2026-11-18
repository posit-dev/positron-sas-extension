// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Pure helpers for job state. Nothing here imports `vscode`, so it can be unit
// tested outside the extension host.
import type { JobOutcome, JobState } from "./types";

const ACTIVE: ReadonlySet<string> = new Set(["pending", "running"]);

/** Whether the job has ended, however it ended. */
export function isTerminal(state: string | undefined): boolean {
  return !!state && !ACTIVE.has(state);
}

/**
 * How a job turned out, for the icon and the message severity. A job can end
 * `completed` and still carry an error: SAS warnings, such as an unresolved
 * macro reference, are reported that way (SAS errors make it `failed`).
 */
export function outcomeOf(
  state: string | undefined,
  withError = false,
): JobOutcome {
  switch (state) {
    case "completed":
      return withError ? "warning" : "success";
    case "canceled":
    case "timedOut":
      return "warning";
    case "failed":
      return "error";
    default:
      return "running";
  }
}

/** The codicon id for a state. */
export function stateIcon(
  state: string | undefined,
  withError = false,
): string {
  switch (state) {
    case "completed":
      return withError ? "warning" : "pass";
    case "failed":
      return "error";
    case "canceled":
      return "circle-slash";
    case "timedOut":
      return "watch";
    case "pending":
      return "clock";
    default:
      return "loading~spin";
  }
}

/** Wording for a state, used in the view and in messages. */
export function humanizeState(
  state: string | undefined,
  withError = false,
): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "completed":
      return withError ? "Completed with warnings" : "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    case "timedOut":
      return "Timed out";
    default:
      return state ? state : "Unknown";
  }
}

/** A job's run time, as "4s", "1m 7s" or "1h 2m". */
export function formatElapsed(milliseconds: number | undefined): string {
  if (!milliseconds || milliseconds < 0) {
    return "";
  }
  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

const KNOWN_STATES: ReadonlySet<string> = new Set<JobState>([
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
  "timedOut",
]);

/** Whether a server string is one of the documented job states. */
export function isJobState(value: string | undefined): value is JobState {
  return value !== undefined && KNOWN_STATES.has(value);
}

/** Narrow a server string to a JobState; an unknown value counts as pending. */
export function asJobState(value: string | undefined): JobState {
  return isJobState(value) ? value : "pending";
}
