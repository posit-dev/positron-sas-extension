// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The SAS Viya compute context of a SAS console, and how it is shown.
//
// Positron reads a session's name (the console tab and the header of the
// Console Information popup) only when the session is created, so a console
// keeps the compute context it was created with: an in-place restart reuses
// it, and a new context needs a new console.
//
// Nothing here imports `vscode`, so it can be unit tested outside the host.

/**
 * What every Viya session uses when the profile names no context. The same
 * value as DEFAULT_COMPUTE_CONTEXT in components/profile.ts, which imports
 * `vscode` and so can't be imported here.
 */
export const DEFAULT_CONTEXT = "SAS Job Execution compute context";

/** The profile fields that decide the context. */
export interface ContextProfile {
  connectionType?: string;
  context?: string;
  serverId?: string;
}

/**
 * The compute context a console for this profile runs in, or undefined when
 * there is none to choose: not SAS Viya, or a direct connection to a running
 * server (`serverId`), which bypasses contexts.
 */
export function effectiveContext(
  profile: ContextProfile | undefined,
): string | undefined {
  if (!profile || profile.connectionType !== "rest" || profile.serverId) {
    return undefined;
  }
  return profile.context?.trim() || DEFAULT_CONTEXT;
}

/** "SAS Studio compute context" → "SAS Studio", for the short console name. */
export function shortContextName(name: string): string {
  const short = name.replace(/\s*compute context\s*$/i, "").trim();
  return short || name.trim();
}

/** The console's name: "Viya · SAS Studio", or just "Viya" without a context. */
export function consoleSessionName(profile: string, context?: string): string {
  return context ? `${profile} · ${shortContextName(context)}` : profile;
}

/** The line a console prints when it starts. */
export function consoleBanner(profile: string, context?: string): string {
  return context
    ? `SAS Session (${profile}), compute context "${context}"`
    : `SAS Session (${profile})`;
}

/**
 * The profile with a new context, as it should be saved: the default is
 * left out, as the profile prompt does.
 */
export function withContext<T extends ContextProfile>(
  profile: T,
  context: string,
): T {
  const updated = { ...profile };
  if (!context.trim() || context.trim() === DEFAULT_CONTEXT) {
    delete updated.context;
  } else {
    updated.context = context.trim();
  }
  return updated;
}
