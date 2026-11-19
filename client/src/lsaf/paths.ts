// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// LSAF paths and REST URLs. Nothing here imports `vscode`.
import type { Area } from "./types";

/**
 * The REST API root for what a user typed: a host, a server URL or the API
 * URL itself. `lsaf.example.com` and `https://lsaf.example.com/lsaf` both
 * become `https://lsaf.example.com/lsaf/api`; a URL with any other path is
 * kept as given. Undefined when it isn't a URL.
 */
export function normalizeApiUrl(input: string | undefined): string | undefined {
  let text = (input ?? "").trim();
  if (!text) {
    return undefined;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") {
    path = "/lsaf/api";
  } else if (/\/lsaf$/i.test(path)) {
    path = `${path}/api`;
  }
  return `${url.protocol}//${url.host}${path}`;
}

/** `/a b/c.sas` → `a%20b/c.sas`; the top level (`/` or empty) → empty. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

/** Normalize to a leading slash and no trailing one; the top level is `/`. */
export function normalizePath(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

const withPath = (prefix: string, path: string): string => {
  const encoded = encodePath(path);
  return encoded ? `${prefix}/${encoded}` : prefix;
};

/** `/repository/files/<path>` and the like; the top level has no path. */
export const repositoryFileUrl = (path: string) =>
  withPath("/repository/files", path);
export const repositoryContainerUrl = (path: string) =>
  withPath("/repository/containers", path);
export const workspaceFileUrl = (path: string) =>
  withPath("/workspace/files", path);
export const workspaceFolderUrl = (path: string) =>
  withPath("/workspace/folders", path);
/** `/jobs/repository/<path>` or `/jobs/workspace/<path>`. */
export const jobUrl = (area: Area, path: string) =>
  withPath(`/jobs/${area}`, path);
export const submissionUrl = (
  id: string,
  part?: "status" | "job" | "manifest",
) => `/jobs/submissions/${encodeURIComponent(id)}${part ? `/${part}` : ""}`;

/** The folder a path is in; `/` for a top-level item. */
export function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash <= 0 ? "/" : normalized.slice(0, slash);
}

/** The last segment of a path. */
export function baseName(path: string): string {
  return normalizePath(path).split("/").pop() ?? "";
}

export function joinPath(folder: string, name: string): string {
  return normalizePath(`${folder}/${name}`);
}

/** File extension in lower case, without the dot; empty when there is none. */
export function extension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const isJobPath = (path: string): boolean => extension(path) === "job";

/** The job "Run on LSAF" uses for a program: `<folder>/<program>.job`. */
export function jobPathForProgram(programPath: string): string {
  const name = baseName(programPath);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return joinPath(parentPath(programPath), `${stem}.job`);
}

/** How a job next to its program refers to it, e.g. `./adsl.sas`. */
export const relativeProgramReference = (programPath: string): string =>
  `./${baseName(programPath)}`;

/**
 * A path a job or manifest gives, resolved against the folder of the job
 * file: `./logs/a.log` and `logs/a.log` are relative, `/x/a.log` absolute.
 * A `?version=` suffix is dropped.
 */
export function resolvePath(folder: string, path: string): string {
  const clean = path.replace(/\?.*$/, "");
  const segments = clean.startsWith("/")
    ? []
    : normalizePath(folder).split("/").filter(Boolean);
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `/${segments.join("/")}`;
}
