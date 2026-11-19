// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// What the LSAF views show for an item: its kind, check-out state, icon and
// the context value the package.json menus match. Nothing here imports
// `vscode`.
import { baseName, extension } from "./paths";
import type { RepositoryItem, WorkspaceItem } from "./types";

const CONTAINER_TYPES = new Set(["context", "sharedfolder", "folder"]);

/** Fill in what a listing may leave out: the name. */
export function normalizeRepositoryItem(item: RepositoryItem): RepositoryItem {
  return { ...item, name: item.name || baseName(item.path) };
}

export function normalizeWorkspaceItem(item: WorkspaceItem): WorkspaceItem {
  return { ...item, name: item.name || baseName(item.path) };
}

export const isContainer = (item: RepositoryItem): boolean =>
  item.container === true ||
  CONTAINER_TYPES.has((item.schemaType ?? "").toLowerCase());

export const isWorkspaceFolder = (item: WorkspaceItem): boolean =>
  item.folder === true || (item.schemaType ?? "").toLowerCase() === "folder";

/** A job file: `.job`, or what the server types as a job. */
export const isJob = (item: { path: string; typeId?: string }): boolean =>
  extension(item.path) === "job" || item.typeId === "sas:job";

export type CheckoutState = "none" | "self" | "other";

export function checkoutState(
  item: RepositoryItem | undefined,
  userId: string | undefined,
): CheckoutState {
  if (!item?.checkedOut && !item?.checkedOutBy) {
    return "none";
  }
  return userId &&
    (item.checkedOutBy ?? "").toLowerCase() === userId.toLowerCase()
    ? "self"
    : "other";
}

/** Whether the latest version is signed. */
export const isSigned = (item: RepositoryItem): boolean =>
  item.signingStatus === "CURRENT" || item.signingStatus === "BOTH";

const checkoutToken: Record<CheckoutState, string> = {
  none: "notCheckedOut",
  self: "checkedOutBySelf",
  other: "checkedOutByOther",
};

/**
 * Repository tree item context value, matched by `viewItem =~ /;token;/`
 * in package.json. Tokens are delimited so one can't match inside another.
 */
export function repositoryContextValue(
  item: RepositoryItem,
  userId: string | undefined,
): string {
  const tokens = ["repo"];
  if (isContainer(item)) {
    tokens.push("container");
  } else {
    tokens.push("file", checkoutToken[checkoutState(item, userId)]);
    if (isJob(item)) {
      tokens.push("job");
    }
    if (item.versioned) {
      tokens.push("versioned");
    }
    if (isSigned(item)) {
      tokens.push("signed");
    }
  }
  return `;${tokens.join(";")};`;
}

/**
 * Workspace tree item context value. `repository` is the repository file at
 * the same path: undefined when it doesn't exist, `null` when unknown (the
 * repository couldn't be listed).
 */
export function workspaceContextValue(
  item: WorkspaceItem,
  repository: RepositoryItem | undefined | null,
  userId: string | undefined,
): string {
  const tokens = ["ws"];
  if (isWorkspaceFolder(item)) {
    tokens.push("folder");
  } else {
    tokens.push("file");
    if (extension(item.path) === "sas") {
      tokens.push("sas");
    }
    if (isJob(item)) {
      tokens.push("job");
    }
    if (repository === undefined) {
      tokens.push("notInRepository");
    } else if (repository !== null) {
      tokens.push(
        "inRepository",
        checkoutToken[checkoutState(repository, userId)],
      );
      if (repository.versioned) {
        tokens.push("versioned");
      }
    }
  }
  return `;${tokens.join(";")};`;
}

/** Folders first, then by name. */
export function sortItems<T extends { path: string; name?: string }>(
  items: T[],
  isFolder: (item: T) => boolean,
): T[] {
  return [...items].sort(
    (a, b) =>
      Number(isFolder(b)) - Number(isFolder(a)) ||
      (a.name ?? baseName(a.path)).localeCompare(b.name ?? baseName(b.path)),
  );
}

/**
 * Icon of a file: the name of an SVG in icons/{light,dark} (without the
 * Light/Dark suffix), or a codicon id prefixed with `$`.
 */
export function fileIcon(path: string): string {
  switch (extension(path)) {
    case "sas":
      return "sasProgramFile";
    case "sas7bdat":
    case "xpt":
      return "sasDataSet";
    case "job":
      return "clinicalJobFile";
    case "mnf":
      return "clinicalJobManifest";
    case "log":
      return "log";
    case "lst":
      return "$output";
    case "pdf":
      return "$file-pdf";
    case "zip":
      return "$file-zip";
    default:
      return "$file";
  }
}

/** Icon of a repository container (codicon ids). */
export function containerIcon(item: RepositoryItem): string {
  const type = (item.schemaType ?? "").toLowerCase();
  if (type === "context") {
    return "$project";
  }
  if (type === "sharedfolder" || item.shared) {
    return "$folder-library";
  }
  return "$folder";
}

/** "1.2" → "v1.2"; for the tree's description. */
export const versionLabel = (item: RepositoryItem): string | undefined =>
  item.versioned && item.version ? `v${item.version}` : undefined;
