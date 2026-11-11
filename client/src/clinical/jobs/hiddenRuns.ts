// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Runs the user removed from the Clinical Jobs view. They are only hidden in
// Positron: the run history on the server, the audit record, stays as it is.
// Kept per server and user. No vscode import, so it is tested directly.
import { isTerminal } from "./state";
import type { Submission } from "./types";

export interface HiddenState {
  /** Runs hidden one by one. */
  ids: string[];
  /** Clear Finished Runs: finished runs that ended before this are hidden. */
  clearedBefore?: string;
  /** Runs restored one by one although they ended before clearedBefore. */
  shown?: string[];
}

/** The part of a VS Code Memento (globalState) this needs. */
export interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** Hidden ids kept at most; the oldest go first. */
const MAX_IDS = 2000;

const time = (value: string | undefined) =>
  value ? Date.parse(value) : Number.NaN;

/** Whether a run is hidden. A run that has not ended never is by a clear. */
export function isRunHidden(run: Submission, state: HiddenState): boolean {
  if (state.shown?.includes(run.id)) {
    return false;
  }
  if (state.ids.includes(run.id)) {
    return true;
  }
  if (state.clearedBefore && isTerminal(run.state)) {
    const ended = time(run.completedTimeStamp ?? run.submittedTimeStamp);
    return ended <= time(state.clearedBefore);
  }
  return false;
}

export class HiddenRuns {
  private key: string | undefined;
  private state: HiddenState = { ids: [] };

  constructor(
    private readonly store: StateStore,
    /** Server and user, such as "https://viya|michael". */
    private readonly scope: () => Promise<string>,
  ) {}

  /** Read the state of the current server and user. */
  async load(): Promise<void> {
    this.key = await this.keyOf();
    this.state = this.store.get<HiddenState>(this.key) ?? { ids: [] };
  }

  private async keyOf(): Promise<string> {
    return `clinicalJobs.hiddenRuns:${await this.scope()}`;
  }

  isHidden(run: Submission): boolean {
    return isRunHidden(run, this.state);
  }

  /** Whether anything is hidden, for the Restore All action. */
  get any(): boolean {
    return !!this.state.ids.length || !!this.state.clearedBefore;
  }

  /** The state as it is, to undo a change with `set`. */
  snapshot(): HiddenState {
    return JSON.parse(JSON.stringify(this.state));
  }

  async set(state: HiddenState): Promise<void> {
    this.state = state;
    await this.save();
  }

  async hide(runs: Submission[]): Promise<void> {
    const ids = new Set(runs.map((r) => r.id));
    this.state = {
      ...this.state,
      ids: [...this.state.ids.filter((id) => !ids.has(id)), ...ids].slice(
        -MAX_IDS,
      ),
      shown: this.state.shown?.filter((id) => !ids.has(id)),
    };
    await this.save();
  }

  /** Hide every run that has ended by `now`, loaded or not. */
  async clearFinished(now = new Date()): Promise<void> {
    // Earlier one-by-one choices are covered by the clear.
    this.state = { ids: [], clearedBefore: now.toISOString() };
    await this.save();
  }

  async restore(runs: Submission[]): Promise<void> {
    const ids = new Set(runs.map((r) => r.id));
    const shown = [...(this.state.shown ?? [])];
    for (const run of runs) {
      if (
        isRunHidden(run, { ...this.state, ids: [] }) &&
        !shown.includes(run.id)
      ) {
        shown.push(run.id);
      }
    }
    this.state = {
      ...this.state,
      ids: this.state.ids.filter((id) => !ids.has(id)),
      shown: shown.slice(-MAX_IDS),
    };
    await this.save();
  }

  async restoreAll(): Promise<void> {
    this.state = { ids: [] };
    await this.save();
  }

  private async save(): Promise<void> {
    // Not loaded yet: work out where to save, keeping the change.
    this.key ??= await this.keyOf();
    await this.store.update(this.key, this.state);
  }
}
