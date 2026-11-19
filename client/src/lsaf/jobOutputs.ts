// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Finding a run's manifest, log and listing. The API returns the manifest's
// path, but documents neither its format nor where logs go, so:
// 1. paths ending in .log or .lst anywhere in the manifest (XML or JSON) are
//    taken, relative to the manifest's folder when not absolute;
// 2. failing that, .log and .lst files in the job's folder written since the
//    run was submitted are taken, those named like the job or program first.
// Nothing here imports `vscode`.
import { JobsModel, resourceArea } from "./JobsModel";
import { isNotFound } from "./LsafClient";
import { RepositoryModel } from "./RepositoryModel";
import { WorkspaceModel } from "./WorkspaceModel";
import { baseName, extension, parentPath, resolvePath } from "./paths";
import type { TrackedRun } from "./runStore";
import type { Area } from "./types";

export interface OutputFile {
  area: Area;
  path: string;
  kind: "manifest" | "log" | "listing";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeEntities = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? _m;
  });

/**
 * The log and listing paths a manifest mentions, resolved against the
 * manifest's folder and without `?version=` suffixes; in order, unique.
 */
export function findOutputPaths(
  manifest: string,
  folder: string,
): { logs: string[]; listings: string[] } {
  const text = decodeEntities(manifest).replace(/\\\//g, "/");
  const logs: string[] = [];
  const listings: string[] = [];
  const pattern = /[^\s"'<>=,;:{}[\]]+\.(log|lst)(?:\?version=[\d.]+)?\b/gi;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const path = resolvePath(folder, match[0]);
    const list = match[1].toLowerCase() === "log" ? logs : listings;
    if (!list.includes(path)) {
      list.push(path);
    }
  }
  return { logs, listings };
}

const stem = (path: string) => baseName(path).replace(/\.[^.]*$/, "");

export class JobOutputs {
  constructor(
    private readonly jobs: JobsModel,
    private readonly repository: RepositoryModel,
    private readonly workspace: WorkspaceModel,
    private readonly log: (message: string) => void = () => {},
  ) {}

  read(area: Area, path: string): Promise<Uint8Array> {
    return area === "workspace"
      ? this.workspace.getContent(path)
      : this.repository.getContent(path);
  }

  /** The manifest of a finished run; undefined when the server has none. */
  async manifest(run: TrackedRun): Promise<OutputFile | undefined> {
    try {
      const resource = await this.jobs.getManifest(run.id);
      if (!resource?.path) {
        return undefined;
      }
      return {
        area: resourceArea(resource, run.area),
        path: resource.path,
        kind: "manifest",
      };
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /** The manifest, logs and listings of a finished run. */
  async find(run: TrackedRun): Promise<OutputFile[]> {
    const manifest = await this.manifest(run);
    const files: OutputFile[] = manifest ? [manifest] : [];
    if (manifest) {
      try {
        const text = new TextDecoder().decode(
          await this.read(manifest.area, manifest.path),
        );
        const found = findOutputPaths(text, parentPath(manifest.path));
        files.push(
          ...found.logs.map((path) => ({
            area: manifest.area,
            path,
            kind: "log" as const,
          })),
          ...found.listings.map((path) => ({
            area: manifest.area,
            path,
            kind: "listing" as const,
          })),
        );
      } catch (error) {
        this.log(`Reading the manifest ${manifest.path} failed: ${error}`);
      }
    }
    if (!files.some((file) => file.kind === "log")) {
      files.push(...(await this.recentOutputs(run)));
    }
    return files;
  }

  /** .log and .lst files in the job's folder written since the submission. */
  private async recentOutputs(run: TrackedRun): Promise<OutputFile[]> {
    const folder = parentPath(run.jobPath);
    const since = new Date(run.submittedAt).getTime() - 60_000;
    let children: Array<{ path: string; lastModified?: string }>;
    try {
      children =
        run.area === "workspace"
          ? await this.workspace.getChildren(folder)
          : await this.repository.getChildren(folder);
    } catch (error) {
      this.log(`Listing ${folder} for the run's log failed: ${error}`);
      return [];
    }
    const names = new Set(
      [run.jobPath, run.programPath].filter(Boolean).map(stem),
    );
    return children
      .filter((child) => ["log", "lst"].includes(extension(child.path)))
      .filter(
        (child) =>
          !child.lastModified ||
          new Date(child.lastModified).getTime() >= since,
      )
      .sort(
        (a, b) =>
          Number(names.has(stem(b.path))) - Number(names.has(stem(a.path))),
      )
      .map((child): OutputFile => ({
        area: run.area,
        path: child.path,
        kind: extension(child.path) === "log" ? "log" : "listing",
      }));
  }
}
