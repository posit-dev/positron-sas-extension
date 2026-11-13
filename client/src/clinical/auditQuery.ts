// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Filters for the audit history (clinicalRepository/audit/entries), built
// like the Audit History page of SAS Clinical Acceleration Repository does.
// No vscode import, so it is unit-tested directly.
//
// Checked against a server: like() matches case-insensitively with * and ?,
// in() lists values, ge()/le() take unquoted ISO timestamps, and a quote in
// a value is doubled.
import type { RepositoryItem } from "./types";
import { isContainer } from "./utils";

export type AuditMode = "USER" | "ADMIN" | "SYSTEM";

export interface AuditQuery {
  /** Item name; `*` and `?` are wildcards; case-insensitive. */
  name?: string;
  /** Repository folder path; items in it and in its subfolders. */
  location?: string;
  /** One item, by id (Show Audit History of a file). */
  sourceId?: string;
  /** Action ids such as `checkedIn`; any when empty. */
  actions?: string[];
  modes?: AuditMode[];
  from?: Date;
  to?: Date;
}

/** A quoted filter string; quotes in the value are doubled. */
export const quote = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

const iso = (date: Date): string => date.toISOString();

/** The location as SAS stores it: no trailing slash, "/" for the root. */
export function normalizeLocation(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

/** Why a location can't be searched, if it can't. */
export function validateLocation(path: string): "location" | undefined {
  const value = path.trim();
  return value === "" || value.startsWith("/") ? undefined : "location";
}

/** The filter for a query; undefined when it has no conditions. */
export function buildAuditFilter(query: AuditQuery): string | undefined {
  const terms: string[] = [];
  if (query.sourceId) {
    terms.push(`eq(sourceId,${quote(query.sourceId)})`);
  }
  if (query.name?.trim()) {
    terms.push(`like(sourceName,${quote(query.name.trim())})`);
  }
  const location = query.location && normalizeLocation(query.location);
  if (location && location !== "/") {
    // The folder itself and everything below it, not "/a/bc" for "/a/b".
    terms.push(
      `or(eq(sourceLocation,${quote(location)}),like(sourceLocation,${quote(`${location}/*`)}))`,
    );
  }
  if (query.actions?.length) {
    terms.push(`in(action,${query.actions.map(quote).join(",")})`);
  }
  if (query.modes?.length) {
    terms.push(`in(mode,${query.modes.map(quote).join(",")})`);
  }
  if (query.from) {
    terms.push(`ge(timestamp,${iso(query.from)})`);
  }
  if (query.to) {
    terms.push(`le(timestamp,${iso(query.to)})`);
  }
  if (!terms.length) {
    return undefined;
  }
  return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
}

/**
 * The audit history of one repository item: a file by id; a folder or
 * context with everything in it.
 */
export function itemAuditFilter(item: RepositoryItem): string {
  if (!isContainer(item)) {
    return `eq(sourceId,${quote(item.id)})`;
  }
  const location = normalizeLocation(item.path);
  return `or(eq(sourceId,${quote(item.id)}),eq(sourceLocation,${quote(location)}),like(sourceLocation,${quote(`${location}/*`)}))`;
}

/** The audit entries URL: newest first, `limit` per page. */
export function buildAuditEntriesUrl(
  base: string,
  filter: string | undefined,
  limit: number,
): string {
  const params = new URLSearchParams({
    start: "0",
    limit: String(limit),
    sortBy: "timestamp:descending",
  });
  if (filter) {
    params.set("filter", filter);
  }
  return `${base}?${params.toString()}`;
}

/** "Last 7 days" and the like: the start of a period ending `now`. */
export function periodStart(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * A date the user typed (YYYY-MM-DD, local time) as the start of that day,
 * or with `endOfDay` its last millisecond; undefined if it isn't a date.
 */
export function parseDay(text: string, endOfDay = false): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}
