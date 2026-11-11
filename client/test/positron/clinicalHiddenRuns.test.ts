// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  HiddenRuns,
  type HiddenState,
  isRunHidden,
} from "../../src/clinical/jobs/hiddenRuns";
import type { Submission } from "../../src/clinical/jobs/types";

const run = (
  id: string,
  state: string,
  completedTimeStamp?: string,
): Submission => ({
  id,
  name: "t.cjob",
  state,
  submittedTimeStamp: "2026-11-10T08:00:00.000Z",
  completedTimeStamp,
  job: {
    name: "t.cjob",
    path: "/a/t.cjob",
    location: "/a",
    resourceLocation: "WORKSPACE",
  },
});

/** A Memento in memory; values go through JSON, as in VS Code. */
const memory = () => {
  const data = new Map<string, string>();
  return {
    data: {
      keys: () => data.keys(),
      get: (key: string) => {
        const text = data.get(key);
        return text === undefined ? undefined : JSON.parse(text);
      },
    },
    get: <T>(key: string): T | undefined => {
      const text = data.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    update: (key: string, value: unknown) => {
      data.set(key, JSON.stringify(value));
      return Promise.resolve();
    },
  };
};

describe("hidden runs", () => {
  const done = run("a", "COMPLETED_SUCCESSFUL", "2026-11-10T08:01:00.000Z");
  const later = run("b", "COMPLETED_FAILED", "2026-11-11T09:00:00.000Z");
  const active = run("c", "RUNNING_TASKS");

  it("hides runs one by one and by a clear of finished runs", () => {
    const state: HiddenState = { ids: ["a"] };
    expect(isRunHidden(done, state)).to.equal(true);
    expect(isRunHidden(later, state)).to.equal(false);

    const cleared: HiddenState = {
      ids: [],
      clearedBefore: "2026-11-11T00:00:00.000Z",
    };
    expect(isRunHidden(done, cleared)).to.equal(true);
    // Ended after the clear.
    expect(isRunHidden(later, cleared)).to.equal(false);
    // Still running: never hidden by a clear.
    expect(isRunHidden(active, cleared)).to.equal(false);
    // Restored one by one.
    expect(isRunHidden(done, { ...cleared, shown: ["a"] })).to.equal(false);
  });

  it("keeps the state per server and user and restores runs", async () => {
    const store = memory();
    let user = "test1";
    const hidden = new HiddenRuns(store, async () => `https://viya|${user}`);
    await hidden.load();
    await hidden.hide([done]);
    expect(hidden.isHidden(done)).to.equal(true);
    expect([...store.data.keys()]).to.deep.equal([
      "clinicalJobs.hiddenRuns:https://viya|test1",
    ]);

    // Another user on the same server sees everything.
    user = "test2";
    await hidden.load();
    expect(hidden.isHidden(done)).to.equal(false);
    user = "test1";
    await hidden.load();
    expect(hidden.isHidden(done)).to.equal(true);

    await hidden.clearFinished(new Date("2026-11-12T00:00:00.000Z"));
    expect(hidden.isHidden(later)).to.equal(true);
    expect(hidden.isHidden(active)).to.equal(false);
    const before = hidden.snapshot();

    await hidden.restore([later]);
    expect(hidden.isHidden(later)).to.equal(false);
    expect(hidden.isHidden(done)).to.equal(true);
    // Hiding it again wins over the restore.
    await hidden.hide([later]);
    expect(hidden.isHidden(later)).to.equal(true);

    await hidden.restoreAll();
    expect(hidden.any).to.equal(false);
    expect(hidden.isHidden(done)).to.equal(false);

    // Undo of a clear: back to the state before.
    await hidden.set(before);
    expect(hidden.isHidden(done)).to.equal(true);
  });

  it("saves a change made before anything was loaded", async () => {
    const store = memory();
    const hidden = new HiddenRuns(store, async () => "s|u");
    await hidden.hide([done]);
    expect(store.data.get("clinicalJobs.hiddenRuns:s|u")).to.deep.equal({
      ids: ["a"],
    });
  });
});
