// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ActionStatus.ts (Apache-2.0).
import { ACTION_STATUS, ACTION_STATUS_MEDIA_TYPE } from "./const";
import type { ActionStatus } from "./types";

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class ActionTimeoutError extends Error {}
export class ActionCancelledError extends Error {}

/** The action status id is the last segment of the batch response Location. */
export function getActionToken(
  location: string | undefined,
): string | undefined {
  const token = location?.split("/").filter(Boolean).pop();
  return token || undefined;
}

export interface ActionOutcome {
  level: "info" | "warn" | "error";
  /** Every per-item detail, one per line, for the output channel. */
  details: string;
  /** The first per-item message, short enough for a toast. */
  firstMessage: string;
}

/** Reduce a finished action's status to what the UI reports. */
export function summarizeActionStatus(status: ActionStatus): ActionOutcome {
  const details = (status.details ?? [])
    .map((d) => `\n\t${d.itemName} - ${d.message}`)
    .join("");
  const firstMessage = status.details?.[0]?.message ?? "";
  switch (status.summary.completionStatus) {
    case "WARN":
      return { level: "warn", details, firstMessage };
    case "ERROR":
      return { level: "error", details, firstMessage };
    default:
      return { level: "info", details, firstMessage };
  }
}

/**
 * Poll a Clinical Acceleration action until the server reports that it has
 * ended, and return its final status. The caller inspects
 * `summary.completionStatus` (INFO, WARN or ERROR).
 */
export async function pollActionStatus(
  get: (
    url: string,
    config: { headers: { Accept: string } },
  ) => Promise<{ data: ActionStatus }>,
  token: string,
  {
    intervalMs = 2000,
    timeoutMs = 5 * 60 * 1000,
    isCancelled = () => false,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: PollOptions = {},
): Promise<ActionStatus> {
  const url = `${ACTION_STATUS}/${encodeURIComponent(token)}`;
  for (let waited = 0; ; waited += intervalMs) {
    const { data } = await get(url, {
      headers: { Accept: ACTION_STATUS_MEDIA_TYPE },
    });
    if (data?.summary?.endTimeStamp) {
      return data;
    }
    if (isCancelled()) {
      throw new ActionCancelledError("Stopped waiting for the action.");
    }
    if (waited >= timeoutMs) {
      throw new ActionTimeoutError("The action did not finish in time.");
    }
    await sleep(intervalMs);
  }
}
