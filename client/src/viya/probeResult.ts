// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Pure helpers for deciding whether a SAS Viya service is there. Nothing here
// imports `vscode` or axios, so it can be unit tested outside the extension
// host.

export type ProbeResult = "available" | "present" | "absent" | "error";

/**
 * Interpret the response of a `GET /<service>/` probe.
 * - 200 with a JSON body: the service is there and the user can use it.
 * - 401/403: the service is routed; the caller decides whether that means
 *   "sign in first" (no token sent) or "no access" (token rejected).
 * - 5xx: the service is routed but not serving right now; worth retrying.
 * - anything else (404, redirects): the service is not there.
 */
export function classifyProbe(
  status: number,
  contentType: string | undefined,
): ProbeResult {
  if (status === 200 && /json/i.test(contentType ?? "")) {
    return "available";
  }
  if (status === 401 || status === 403) {
    return "present";
  }
  if (status >= 500) {
    return "error";
  }
  return "absent";
}

/** Whether the feature should be shown for a probe result. */
export function isAvailable(result: ProbeResult, sentToken: boolean): boolean {
  return result === "available" || (result === "present" && !sentToken);
}
