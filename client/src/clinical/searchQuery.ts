// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Repository searches, built like the Search page of SAS Clinical
// Acceleration Repository: item properties are a filter on
// repository/items; file content is the `text` of repository/files. No
// vscode import, so it is unit-tested directly.
//
// Checked against a server: like() on name matches case-insensitively with
// * and ? (eq() with wildcards matches nothing), startsWith(path) limits the
// location, and owner, checkedOutBy, signingStatus, modifiedTimeStamp and
// primaryType filter as expected. A search's `count` is its total.
import { normalizeLocation, quote } from "./auditQuery";

export type SearchKind = "files" | "folders";

export interface SearchQuery {
  /** Item name; `*` and `?` are wildcards; case-insensitive. */
  name?: string;
  /** Repository folder path; subfolders are always included. */
  location?: string;
  /**
   * File content: words separated by spaces match any of them, AND joins
   * them, quotes make a phrase. Only files have content.
   */
  text?: string;
  kind?: SearchKind;
  ownedByMe?: boolean;
  checkedOutByMe?: boolean;
  /** The latest version is signed. */
  signed?: boolean;
  /** Modified in the last so many days. */
  modifiedDays?: number;
}

/** True when the query has no condition at all. */
export const isEmptyQuery = (query: SearchQuery): boolean =>
  !query.name?.trim() &&
  !(query.location && normalizeLocation(query.location) !== "/") &&
  !query.text?.trim() &&
  !query.kind &&
  !query.ownedByMe &&
  !query.checkedOutByMe &&
  !query.signed &&
  !query.modifiedDays;

/** The item filter of a query; undefined when there is no condition. */
export function buildSearchFilter(
  query: SearchQuery,
  userId: string | undefined,
  now: Date = new Date(),
): string | undefined {
  const terms: string[] = [];
  if (query.name?.trim()) {
    terms.push(`like(name,${quote(query.name.trim())})`);
  }
  const location = query.location && normalizeLocation(query.location);
  if (location && location !== "/") {
    terms.push(`startsWith(path,${quote(`${location}/`)})`);
  }
  if (query.kind === "files") {
    terms.push("in(primaryType,'FILE','JOB_FILE')");
  } else if (query.kind === "folders") {
    terms.push("in(primaryType,'FOLDER','CONTEXT')");
  }
  if (query.ownedByMe && userId) {
    terms.push(`eq(owner,${quote(userId)})`);
  }
  if (query.checkedOutByMe && userId) {
    terms.push(`eq(checkedOutBy,${quote(userId)})`);
  }
  if (query.signed) {
    terms.push("in(signingStatus,'CURRENT','BOTH')");
  }
  if (query.modifiedDays) {
    const since = new Date(
      now.getTime() - query.modifiedDays * 24 * 60 * 60 * 1000,
    );
    terms.push(`ge(modifiedTimeStamp,${since.toISOString()})`);
  }
  if (!terms.length) {
    return undefined;
  }
  return terms.length === 1 ? terms[0] : `and(${terms.join(",")})`;
}

/**
 * Content search text as the web app sends it: + and - are escaped, since
 * the search engine reads them as operators.
 */
export const escapeContentText = (text: string): string =>
  text.trim().replace(/\+/g, "\\+").replace(/-/g, "\\-");

/** Why content search text can't be used, if it can't. */
export function validateContentText(text: string): "wildcardStart" | undefined {
  return /^[*?]/.test(text.trim()) ? "wildcardStart" : undefined;
}

/**
 * The search URL: repository/items for properties, repository/files when
 * there is content text (then only files match).
 */
export function buildSearchUrl(
  itemsBase: string,
  filesBase: string,
  filter: string | undefined,
  text: string | undefined,
  limit: number,
): string {
  const params = new URLSearchParams({ start: "0", limit: String(limit) });
  if (filter) {
    params.set("filter", filter);
  }
  if (text?.trim()) {
    params.set("text", escapeContentText(text));
    return `${filesBase}?${params.toString()}`;
  }
  params.set("sortBy", "name:ascending");
  return `${itemsBase}?${params.toString()}`;
}

/** The folder a path is in: "/" for top-level items. */
export const parentPath = (path: string): string =>
  path.slice(0, path.lastIndexOf("/")) || "/";
