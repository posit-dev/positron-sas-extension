// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// How submission and program states read in the UI. No vscode import, so the
// mapping is unit-tested on its own.
import type { ExecutionState, SubmissionState } from "./types";

export type Outcome = "running" | "success" | "warning" | "error" | "canceled";

/** Every state that starts with COMPLETED is final. */
export function isTerminal(
  state: SubmissionState | string | undefined,
): boolean {
  return !!state && state.startsWith("COMPLETED");
}

/** What a submission state means for the user. */
export function outcomeOf(
  state: SubmissionState | string | undefined,
): Outcome {
  if (!isTerminal(state)) {
    return "running";
  }
  switch (state) {
    case "COMPLETED_SUCCESSFUL":
      return "success";
    case "COMPLETED_CANCELED":
      return "canceled";
    case "COMPLETED_PROGRAM_WARNINGS":
      return "warning";
    default:
      // Program errors, failures, and every *_CHECKIN_ERROR: outputs were
      // not (all) checked in, which matters for the audit trail.
      return "error";
  }
}

/** Codicon id for a submission state; the spinner while it runs. */
export function stateIcon(state: SubmissionState | string | undefined): string {
  switch (outcomeOf(state)) {
    case "running":
      return "loading~spin";
    case "success":
      return "pass";
    case "warning":
      return "warning";
    case "canceled":
      return "circle-slash";
    default:
      return "error";
  }
}

/** Codicon id for a program's execution state in a manifest. */
export function executionIcon(
  state: ExecutionState | string | undefined,
): string {
  switch (state) {
    case "SUCCESSFUL":
      return "pass";
    case "WARNINGS":
      return "warning";
    case "ERRORS":
    case "FAILED":
      return "error";
    case "CANCELED":
      return "circle-slash";
    default:
      return "circle-outline";
  }
}

/** "COMPLETED_PROGRAM_WARNINGS" → "Completed program warnings". */
export function humanizeState(state: string | undefined): string {
  if (!state) {
    return "";
  }
  const words = state.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
