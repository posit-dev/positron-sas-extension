// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Decide whether a URL is an LSAF REST API. Nothing here imports `vscode`.
import { ERROR_MEDIA_TYPE } from "./const";

export type LsafProbeResult = "lsaf" | "absent" | "error";

/**
 * Interpret the answer to an unauthenticated `GET <api>/apiMeta` or
 * `GET <api>/`:
 * - 200 with a JSON body: the API's metadata or top-level links.
 * - 401/403 with LSAF's error body (`application/vnd.sas.hls.error+json`,
 *   or JSON with an `errorCode`): the API is there and wants a logon.
 * - 5xx: something is there but not serving now; worth retrying.
 * - anything else (404, an HTML login page, a redirect): not LSAF.
 */
export function classifyLsafProbe(
  status: number,
  contentType: string | undefined,
  body: string,
): LsafProbeResult {
  const type = (contentType ?? "").toLowerCase();
  if (status === 200) {
    return /json/.test(type) && isJsonObject(body) ? "lsaf" : "absent";
  }
  if (status === 401 || status === 403) {
    if (type.includes(ERROR_MEDIA_TYPE)) {
      return "lsaf";
    }
    if (/json/.test(type)) {
      const parsed = parse(body);
      return parsed && typeof parsed === "object" && "errorCode" in parsed
        ? "lsaf"
        : "absent";
    }
    return "absent";
  }
  if (status >= 500) {
    return "error";
  }
  return "absent";
}

/** The better of two probe results: one "lsaf" answer is enough. */
export function combineProbes(
  a: LsafProbeResult,
  b: LsafProbeResult,
): LsafProbeResult {
  if (a === "lsaf" || b === "lsaf") {
    return "lsaf";
  }
  return a === "error" || b === "error" ? "error" : "absent";
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isJsonObject = (text: string): boolean => {
  const parsed = parse(text);
  return !!parsed && typeof parsed === "object";
};
