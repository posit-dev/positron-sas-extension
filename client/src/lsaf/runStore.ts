// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF REST API can't list job submissions, so the Jobs view shows the
// runs started from this extension, kept in VS Code's global state per
// server and user. Nothing here imports `vscode`; the Memento is injected.
import type { RunOutcome } from "./JobsModel";
import { MAX_TRACKED_RUNS } from "./const";
import type { Area } from "./types";

export interface TrackedRun {
  /** The submission ID. */
  id: string;
  area: Area;
  jobPath: string;
  /** The program "Run on LSAF" made the job for. */
  programPath?: string;
  parameters?: Record<string, string>;
  submittedAt: string;
  state?: string;
  message?: string;
  completedAt?: string;
  outcome: RunOutcome;
}

/** The part of a vscode.Memento this needs. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export const runStoreKey = (apiUrl: string, userId: string) =>
  `lsaf.runs:${apiUrl}|${userId}`;

export class RunStore {
  constructor(
    private readonly memento: MementoLike,
    private readonly key: string,
  ) {}

  /** Newest first. */
  list(): TrackedRun[] {
    return [...(this.memento.get<TrackedRun[]>(this.key) ?? [])].sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt),
    );
  }

  get(id: string): TrackedRun | undefined {
    return this.list().find((run) => run.id === id);
  }

  async add(run: TrackedRun): Promise<void> {
    const runs = [run, ...this.list().filter((r) => r.id !== run.id)];
    await this.save(runs.slice(0, MAX_TRACKED_RUNS));
  }

  async update(id: string, patch: Partial<TrackedRun>): Promise<void> {
    await this.save(
      this.list().map((run) => (run.id === id ? { ...run, ...patch } : run)),
    );
  }

  async remove(ids: string[]): Promise<void> {
    const drop = new Set(ids);
    await this.save(this.list().filter((run) => !drop.has(run.id)));
  }

  /** Forget every run that has finished; keep the running ones. */
  async removeFinished(): Promise<void> {
    await this.save(this.list().filter((run) => run.outcome === "running"));
  }

  private async save(runs: TrackedRun[]): Promise<void> {
    await this.memento.update(this.key, runs);
  }
}
