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
  WORKSPACE_FOLDERS,
  WORKSPACE_ITEMS,
} from "./const";
import type {
  CheckInBody,
  CheckoutState,
  ItemPrivileges,
  Link,
  ObjectType,
  RepositoryItem,
  ResourceCollection,
  SynchronizationInfo,
  SynchronizationItem,
  VersionHistoryItem,
  VersionRow,
  WorkspaceItem,
} from "./types";

/** Tells a version in the Version History view from a repository item. */
export const isVersionRow = (
  source: RepositoryItem | VersionRow | WorkspaceItem,
): source is VersionRow => "fileId" in source;

export const isContainer = (item: RepositoryItem): boolean =>
  item.primaryType === "CONTEXT" || item.primaryType === "FOLDER";

/**
 * Context token for the file types with their own commands: clinical jobs
 * (`job`), job manifests (`manifest`) and SAS programs (`sasProgram`).
 */
export function fileKindToken(
  name: string,
  primaryType?: RepositoryItem["primaryType"],
): "job" | "manifest" | "sasProgram" | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (primaryType === "JOB_FILE" || ext === "cjob") {
    return "job";
  }
  if (ext === "cmnf") {
    return "manifest";
  }
  return ext === "sas" ? "sasProgram" : undefined;
}

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

/** Whether the signed-in user may change an item, as far as we know yet. */
export type ItemPermission = "write" | "read" | "unknown";

const PERMISSION_TOKENS: Record<ItemPermission, string> = {
  write: "canWrite",
  read: "readOnly",
  unknown: "permUnknown",
};

/**
 * The names in an authorizations response. Accepts the shapes the service may
 * use (an array of names, a delimited string, or an object holding such a
 * list), upper-cased; undefined if the response isn't recognisable.
 */
export function parsePermissionNames(data: unknown): string[] | undefined {
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
  return names.map((n) => String(n).toUpperCase());
}

/** Whether an effective-permissions response grants WRITE. */
export const parseWritePermission = (data: unknown): boolean | undefined =>
  parsePermissionNames(data)?.includes("WRITE");

/** The versioning privileges in a privileges response, if recognisable. */
export function parsePrivileges(data: unknown): ItemPrivileges | undefined {
  const names = parsePermissionNames(data);
  return (
    names && {
      enableVersioning: names.includes("PRIVILEGE_ENABLE_VERSIONING"),
      manageVersioning: names.includes("PRIVILEGE_MANAGE_VERSIONING"),
    }
  );
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

/**
 * Tree item context value, matched by the `viewItem =~ /;token;/` clauses
 * in package.json. Tokens are delimited so one can't match inside another.
 */
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
    tokens.push(
      "file",
      CHECKOUT_TOKENS[getCheckoutState(item, currentUserId)],
      item.versioned ? "versioned" : "unversioned",
    );
    const kind = fileKindToken(item.name, item.primaryType);
    if (kind) {
      tokens.push(kind);
    }
  }
  if (!isTopLevelContext(item, type)) {
    tokens.push("canRename");
  }
  // Contexts (organizations, studies) are only removed by administrators.
  if (item.primaryType !== "CONTEXT") {
    tokens.push("canDelete");
  }
  return `;${tokens.join(";")};`;
}

export function buildVersionsUrl(itemId: string): string {
  return `${REPOSITORY_ITEMS}/${encodeURIComponent(itemId)}/versions`;
}

/** Order versions newest first: "10.0" is newer than "9.1". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  return 0;
}

export const sortVersions = <T extends VersionHistoryItem>(
  versions: T[],
): T[] =>
  [...versions].sort((a, b) => compareVersions(a.fileVersion, b.fileVersion));

/** File name of one version, e.g. `adsl.sas` version 2.0 is `adsl-v2.0.sas`. */
export function versionFileName(name: string, version: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}-v${version}${name.slice(dot)}`
    : `${name}-v${version}`;
}

/** Whether `path` is `folder` itself or lies inside it. */
export const isSameOrUnder = (path: string, folder: string): boolean =>
  path === folder ||
  path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);

/** RQL filter selecting items by id, e.g. `in(id,'a','b')`. */
export const buildIdFilter = (ids: string[]): string =>
  `in(id,${ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")})`;

/** Name of the downloaded file: containers and multi-selections are zips. */
export function downloadFileName(
  items: Array<{ name: string; primaryType: string }>,
): string {
  if (
    items.length === 1 &&
    items[0].primaryType !== "CONTEXT" &&
    items[0].primaryType !== "FOLDER"
  ) {
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
// A number such as 2.3, or MAJOR / MINOR to bump an already versioned file.
const VERSION_REGEX = /^(\d+\.\d+|MAJOR|MINOR)$/i;

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

// --- Workspace ---

/** Encode a path for a URL, keeping its slashes. */
export const encodePath = (path: string): string =>
  encodeURIComponent(path).replace(/%2F/g, "/");

const withSlash = (path: string): string =>
  path.startsWith("/") ? path : `/${path}`;

/** `items` URL of a workspace path; the root is the empty path. */
export function buildWorkspaceItemsUrl(
  path: string | undefined,
  query: Record<string, string | boolean> = {},
): string {
  const root = !path || path === "/";
  const params = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${WORKSPACE_ITEMS}${root ? "" : encodePath(withSlash(path))}${params ? `?${params}` : ""}`;
}

/** URL to create a folder in `parentPath`. */
export function buildWorkspaceFolderUrl(
  parentPath: string,
  name: string,
): string {
  const root = !parentPath || parentPath === "/";
  return `${WORKSPACE_FOLDERS}${root ? "" : encodePath(withSlash(parentPath))}?name=${encodeURIComponent(name)}`;
}

/** Path of `name` inside the workspace folder `parentPath`. */
export const joinWorkspacePath = (parentPath: string, name: string): string =>
  `${parentPath === "/" ? "" : parentPath.replace(/\/$/, "")}/${name}`;

export const isWorkspaceFolder = (item: WorkspaceItem): boolean =>
  item.type === "FOLDER";

/** Tells a workspace item from a repository item or a version. */
export const isWorkspaceItem = (
  source: RepositoryItem | VersionRow | WorkspaceItem,
): source is WorkspaceItem => !("primaryType" in source) && "type" in source;

export function getWorkspaceCheckoutState(
  item: WorkspaceItem,
  currentUserId: string | undefined,
): CheckoutState {
  const info = item.synchronizationInfo;
  if (isWorkspaceFolder(item) || !info?.checkedOut) {
    return "none";
  }
  return currentUserId && info.checkedOutBy === currentUserId
    ? "self"
    : "other";
}

/**
 * Context value of a workspace tree item (see `buildContextValue`). Check-in
 * is offered for folders and for files nobody else has checked out; undoing a
 * check-out for folders and for your own check-outs.
 */
export function buildWorkspaceContextValue(
  item: WorkspaceItem,
  currentUserId: string | undefined,
): string {
  const tokens = ["workspace"];
  if (isWorkspaceFolder(item)) {
    tokens.push("container", "canCheckIn", "canUndo");
  } else {
    const state = getWorkspaceCheckoutState(item, currentUserId);
    tokens.push("file", CHECKOUT_TOKENS[state]);
    if (state !== "other") {
      tokens.push("canCheckIn");
    }
    if (state === "self") {
      tokens.push("canUndo");
    }
    const kind = fileKindToken(item.name);
    if (kind) {
      tokens.push(kind);
    }
  }
  return `;${tokens.join(";")};`;
}

// Icons of the Clinical Acceleration file types, by extension.
const WORKSPACE_ICONS: Record<string, string> = {
  sas: "sasProgramFile",
  sas7bdat: "sasDataSet",
  sas7bcat: "sasCatalog",
  sas7bvew: "dataSetView",
  xpt: "sasTransportFile",
  cjob: "clinicalJobFile",
  cmnf: "clinicalJobManifest",
  job: "jobTemplate",
  log: "log",
  lst: "log",
};

/** Name of the extension's icon for a file, if it has one. */
export const workspaceIconName = (fileName: string): string | undefined =>
  WORKSPACE_ICONS[fileName.split(".").pop()?.toLowerCase() ?? ""];

// --- Check in ---

const isVersionedInfo = (version: string | undefined): boolean =>
  !!version && version !== "-";

export interface CheckInPlan {
  /** Not checked out: new to the repository. */
  newFiles: SynchronizationItem[];
  /** Checked out and versioned: get the next version. */
  versioned: SynchronizationItem[];
  /** Checked out, without versioning. */
  unversioned: SynchronizationItem[];
}

/** Sort the check-in candidates by what has to be asked about them. */
export function planCheckIn(items: SynchronizationItem[]): CheckInPlan {
  const plan: CheckInPlan = { newFiles: [], versioned: [], unversioned: [] };
  for (const item of items) {
    const info = item.synchronizationInfo;
    if (!info?.checkedOut) {
      plan.newFiles.push(item);
    } else if (isVersionedInfo(info.fileVersion)) {
      plan.versioned.push(item);
    } else {
      plan.unversioned.push(item);
    }
  }
  return plan;
}

/** Why a file the user chose to check in can't be. */
export type CheckInBlockReason =
  /** A copy of a repository file the user hasn't checked out. */
  | "notCheckedOut"
  /** Checked out by someone else. */
  | "checkedOutByOther"
  /** Left out by the server for a reason the file doesn't show. */
  | "notOffered";

export interface CheckInBlock {
  name: string;
  path: string;
  reason: CheckInBlockReason;
  /** Who has it checked out, for checkedOutByOther. */
  by?: string;
}

/**
 * Whether a workspace file is a copy of a repository file (Copy to Workspace,
 * or left behind by a check-in). Only a check-out lets it make a new version.
 */
const isRepositoryCopy = (info: SynchronizationInfo | undefined): boolean =>
  info?.workspaceStatus === "IN_SYNC" ||
  info?.workspaceStatus === "OUT_OF_SYNC";

function blockReason(
  info: SynchronizationInfo | undefined,
  currentUserId: string | undefined,
): Omit<CheckInBlock, "name" | "path"> | undefined {
  if (info?.checkedOut) {
    return currentUserId &&
      info.checkedOutBy &&
      info.checkedOutBy !== currentUserId
      ? {
          reason: "checkedOutByOther",
          by: info.checkedOutByDisplayName ?? info.checkedOutBy,
        }
      : undefined;
  }
  return isRepositoryCopy(info) ? { reason: "notCheckedOut" } : undefined;
}

/**
 * Split the server's check-in candidates into what can be checked in and the
 * files that can't, with the reason, so the user is told why instead of
 * getting a bare refusal. `selected` are the workspace items the user chose;
 * a selected file the server left out is explained from its own status.
 */
export function sortCheckInCandidates(
  selected: WorkspaceItem[],
  candidates: SynchronizationItem[],
  currentUserId: string | undefined,
): { candidates: SynchronizationItem[]; blocked: CheckInBlock[] } {
  const kept: SynchronizationItem[] = [];
  const blocked: CheckInBlock[] = [];
  for (const item of candidates) {
    const block = blockReason(item.synchronizationInfo, currentUserId);
    if (!block) {
      kept.push(item);
    } else if (
      block.reason !== "notCheckedOut" ||
      item.synchronizationInfo.workspaceStatus === "OUT_OF_SYNC"
    ) {
      // An unchanged copy has nothing to check in: leave it out quietly.
      blocked.push({ name: item.name, path: item.path, ...block });
    }
  }
  const listed = new Set(candidates.map((c) => c.path));
  for (const item of selected) {
    if (isWorkspaceFolder(item) || listed.has(item.path)) {
      continue;
    }
    blocked.push({
      name: item.name,
      path: item.path,
      ...(blockReason(item.synchronizationInfo, currentUserId) ?? {
        reason: "notOffered",
      }),
    });
  }
  return { candidates: kept, blocked };
}

/** The next major ("2.3" -> "3.0") or minor ("2.3" -> "2.4") version. */
export function getNextVersion(
  type: "major" | "minor",
  version?: string,
): string {
  const current = version && isVersionedInfo(version) ? version : "0.0";
  if (!current.includes(".")) {
    throw new Error(`${version} is not a valid version.`);
  }
  const [major, minor] = current.split(".");
  return type === "major"
    ? `${Number(major) + 1}.0`
    : `${major}.${Number(minor) + 1}`;
}

export interface CheckInAnswers {
  /** Version for new files; none leaves them unversioned. */
  newFileVersion?: string;
  /** Version for files that are checked out but unversioned. */
  unversionedVersion?: string;
  /** Which part of the version of versioned files to raise. */
  bump?: "major" | "minor";
  comment: string;
}

/** The `CHECK_IN` request body for a plan and the user's answers. */
export function buildCheckInBody(
  plan: CheckInPlan,
  answers: CheckInAnswers,
): CheckInBody {
  const spec = (
    item: SynchronizationItem,
    fileVersion: string | undefined,
  ) => ({
    path: item.path,
    ...(fileVersion ? { fileVersion: fileVersion.toUpperCase() } : {}),
    type: "FILE" as const,
  });
  return {
    fileSpecifications: [
      ...plan.newFiles.map((i) => spec(i, answers.newFileVersion)),
      ...plan.unversioned.map((i) => spec(i, answers.unversionedVersion)),
      ...plan.versioned.map((i) =>
        spec(
          i,
          answers.bump &&
            getNextVersion(answers.bump, i.synchronizationInfo.fileVersion),
        ),
      ),
    ],
    comment: answers.comment,
    includeNewFiles: true,
  };
}
