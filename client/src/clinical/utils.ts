// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/utils.ts and index.ts (Apache-2.0).
//
// Pure helpers for the Clinical Repository view. Nothing here imports
// `vscode`, so it can be unit tested outside the extension host.
import { inflateRawSync } from "zlib";

import {
  CHILDREN_PAGE_LIMIT,
  MAX_CHILDREN_PAGES,
  REPOSITORY_ITEMS,
} from "./const";
import type {
  CheckoutState,
  Link,
  ObjectType,
  RepositoryItem,
  ResourceCollection,
} from "./types";

export const isContainer = (item: RepositoryItem): boolean =>
  item.primaryType === "CONTEXT" || item.primaryType === "FOLDER";

/** Top-level contexts (organizations) are managed by administrators. */
export const isTopLevelContext = (
  item: RepositoryItem,
  type?: ObjectType,
): boolean =>
  item.primaryType === "CONTEXT" && !!type?.capabilities?.includes("TOP");

export const getLink = (
  links: Link[] | undefined,
  rel: string,
): Link | undefined => links?.find((link) => link.rel === rel);

export function buildChildrenUrl(itemId: string): string {
  return `${REPOSITORY_ITEMS}/${encodeURIComponent(itemId)}/children?start=0&limit=${CHILDREN_PAGE_LIMIT}&includeSynchronizationInfo=true`;
}

/**
 * Fetch every page of a collection by following its `next` links. `count` is
 * the size of the current page, not the collection total, so it can't be
 * used to drive paging. Stops (and reports truncation) if the server hands
 * back a `next` link that was already fetched, or after too many pages.
 */
export async function collectPages<T>(
  get: (url: string) => Promise<ResourceCollection<T>>,
  firstUrl: string,
  onTruncated?: (reason: string) => void,
  maxPages = MAX_CHILDREN_PAGES,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let url: string | undefined = firstUrl;
  while (url) {
    if (seen.has(url)) {
      onTruncated?.(`the server returned a repeated page link: ${url}`);
      break;
    }
    if (seen.size >= maxPages) {
      onTruncated?.(`stopped after ${maxPages} pages`);
      break;
    }
    seen.add(url);
    const page = await get(url);
    items.push(...(page.items ?? []));
    url = getLink(page.links, "next")?.href;
  }
  return items;
}

export type ProbeResult = "available" | "present" | "absent" | "error";

/**
 * Interpret the response of `GET /clinicalRepository/`.
 * - 200 with a JSON body: the service is there and the user can use it.
 * - 401/403: the service is routed; the caller decides whether that means
 *   "sign in first" (no token sent) or "no access" (token rejected).
 * - 5xx: the service is routed but not serving right now; worth retrying.
 * - anything else (404, redirects): no Clinical Repository.
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

/** Whether the view should be shown for a probe result. */
export function isAvailable(result: ProbeResult, sentToken: boolean): boolean {
  return result === "available" || (result === "present" && !sentToken);
}

export function getCheckoutState(
  item: RepositoryItem,
  currentUserId: string | undefined,
): CheckoutState {
  if (isContainer(item) || !item.checkedOut) {
    return "none";
  }
  return currentUserId && item.checkedOutBy === currentUserId
    ? "self"
    : "other";
}

const CHECKOUT_TOKENS: Record<CheckoutState, string> = {
  none: "coNone",
  self: "coSelf",
  other: "coOther",
};

/**
 * Tree item context value, matched by the `viewItem =~ /;token;/` clauses
 * in package.json. Tokens are delimited so one can't match inside another.
 */
/** Whether the signed-in user may change an item, as far as we know yet. */
export type ItemPermission = "write" | "read" | "unknown";

const PERMISSION_TOKENS: Record<ItemPermission, string> = {
  write: "canWrite",
  read: "readOnly",
  unknown: "permUnknown",
};

/**
 * Whether an effective-permissions response grants WRITE. Accepts the shapes
 * the service may use (an array of names, a delimited string, or an object
 * holding such a list); undefined if the response isn't recognisable.
 */
export function parseWritePermission(data: unknown): boolean | undefined {
  let names: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    names =
      "permissions" in data
        ? data.permissions
        : "items" in data
          ? data.items
          : undefined;
  }
  if (typeof names === "string") {
    names = names.split(/[\s,]+/);
  }
  if (!Array.isArray(names)) {
    return undefined;
  }
  return names.some((n) => String(n).toUpperCase() === "WRITE");
}

/** Run at most `limit` of the given tasks at a time. */
export function createLimiter(
  limit: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < limit) {
      active++;
    } else {
      // The finishing task hands its slot over, so `active` stays the same.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
}

export function buildContextValue(
  item: RepositoryItem,
  type: ObjectType | undefined,
  currentUserId: string | undefined,
  permission: ItemPermission = "unknown",
): string {
  const tokens = ["clinical", PERMISSION_TOKENS[permission]];
  if (isContainer(item)) {
    tokens.push("container", "canCreate");
  } else {
    tokens.push("file", CHECKOUT_TOKENS[getCheckoutState(item, currentUserId)]);
  }
  if (!isTopLevelContext(item, type)) {
    tokens.push("canRename");
  }
  return `;${tokens.join(";")};`;
}

/** RQL filter selecting items by id, e.g. `in(id,'a','b')`. */
export const buildIdFilter = (ids: string[]): string =>
  `in(id,${ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")})`;

/** Name of the downloaded file: containers and multi-selections are zips. */
export function downloadFileName(items: RepositoryItem[]): string {
  if (items.length === 1 && !isContainer(items[0])) {
    return items[0].name;
  }
  return `${items[0].name}.zip`;
}

export const isZip = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

/**
 * Return the content of the only file in a zip archive, or undefined if the
 * archive holds anything other than exactly one file. Entries are located
 * through the central directory, so archives that use data descriptors work.
 */
export function extractSingleZipEntry(
  bytes: Uint8Array,
): Uint8Array | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is at least 22 bytes from the end,
  // followed by a comment of up to 64 KiB.
  let eocd = -1;
  for (
    let i = buf.length - 22;
    i >= Math.max(0, buf.length - 22 - 0xffff);
    i--
  ) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return undefined;
  }
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files: Array<{ method: number; size: number; local: number }> = [];
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      return undefined;
    }
    const method = buf.readUInt16LE(offset + 10);
    const size = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (!name.endsWith("/")) {
      files.push({ method, size, local });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (files.length !== 1) {
    return undefined;
  }
  const { method, size, local } = files[0];
  if (buf.readUInt32LE(local) !== 0x04034b50) {
    return undefined;
  }
  const start =
    local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) {
    return new Uint8Array(data);
  }
  if (method === 8) {
    return new Uint8Array(inflateRawSync(new Uint8Array(data)));
  }
  return undefined;
}

// Name validation ported from the SAS Clinical Acceleration extension.
const FILE_REGEX = /^([^/<>;\\{}?#]+)\.\w+$/;
const NAME_REGEX =
  /[^\u0022\u0024\u002A\u002F\u003A\u003C\u003E\u003F\u005C\u007C\u007F-\u00A0\u1680\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200A\u200B\u2028\u2029\u205F\u3000]/g;
const VERSION_REGEX = /^(\d+)\.(\d+)$/;

export type ValidationError =
  | "fileName"
  | "folderLength"
  | "folderDot"
  | "folderLeadingSpace"
  | "folderTrailingSpace"
  | "folderCharacters"
  | "commentLength"
  | "versionFormat";

export const validateFileName = (value: string): ValidationError | undefined =>
  FILE_REGEX.test(value) ? undefined : "fileName";

export function validateFolderName(value: string): ValidationError | undefined {
  if (value.length > 255) {
    return "folderLength";
  }
  if (value.startsWith(".")) {
    return "folderDot";
  }
  if (value.startsWith(" ")) {
    return "folderLeadingSpace";
  }
  if (value.endsWith(" ")) {
    return "folderTrailingSpace";
  }
  const trimmed = value.trim();
  const matches =
    trimmed === "" ? value.match(NAME_REGEX) : trimmed.match(NAME_REGEX);
  if (matches === null || matches.length < trimmed.length) {
    return "folderCharacters";
  }
  return undefined;
}

export const validateComment = (value: string): ValidationError | undefined =>
  value.length > 1024 ? "commentLength" : undefined;

export const validateVersion = (value: string): ValidationError | undefined =>
  value !== "" && !VERSION_REGEX.test(value) ? "versionFormat" : undefined;
