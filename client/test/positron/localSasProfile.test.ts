// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { delimiter, join } from "path";

import type { Profile } from "../../src/components/profile";
import {
  DEFAULT_LOCAL_SAS_PATH,
  LOCAL_PROFILE_ADDED_KEY,
  LocalProfileState,
  LocalProfileStore,
  SAS94_LOCAL_SAS_PATHS,
  addLocalSasProfile,
  localSasCandidates,
  pathCandidates,
} from "../../src/positron/localSasProfile";

class FakeStore implements LocalProfileStore {
  /** Every saveProfiles call, failed or not. */
  saves: { active: string; profiles: { [name: string]: Profile } }[] = [];
  /** saveProfiles fails this many times first, as a settings.json conflict. */
  failures = 0;
  /** saveProfiles "succeeds" without changing anything. */
  dropWrites = false;
  /** Called before each read of the profiles, to change them meanwhile. */
  beforeRead?: () => void;

  constructor(
    public profiles: { [name: string]: Profile } = {},
    public active = "",
  ) {}
  getAllProfiles() {
    this.beforeRead?.();
    return this.profiles;
  }
  getActiveProfile() {
    return this.active;
  }
  async saveProfiles(active: string, profiles: { [name: string]: Profile }) {
    this.saves.push({ active, profiles });
    if (this.failures > 0) {
      this.failures--;
      throw new Error(
        "Failed to save 'settings.json': The content of the file is newer.",
      );
    }
    if (!this.dropWrites) {
      this.profiles = profiles;
      this.active = active;
    }
  }
}

/** Retries without waiting; records the waits and the final failure. */
const noWait = () => {
  const record = { waits: [] as number[], failed: [] as unknown[] };
  return {
    record,
    retry: {
      sleep: async (ms: number) => {
        record.waits.push(ms);
      },
      onFailed: (error: unknown) => {
        record.failed.push(error);
      },
    },
  };
};

class FakeState implements LocalProfileState {
  values: { [key: string]: unknown } = {};
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
  async update(key: string, value: unknown) {
    this.values[key] = value;
  }
}

const sasPresent = () => true;
const sasMissing = () => false;

describe("addLocalSasProfile", () => {
  it("adds an active stdio profile when SAS is installed and no profile exists", async () => {
    const store = new FakeStore();
    const state = new FakeState();

    const name = await addLocalSasProfile(
      store,
      state,
      DEFAULT_LOCAL_SAS_PATH,
      sasPresent,
    );

    expect(name).to.equal("local");
    expect(store.profiles.local).to.deep.equal({
      connectionType: "stdio",
      saspath: DEFAULT_LOCAL_SAS_PATH,
    });
    expect(store.active).to.equal("local");
    expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.equal(true);
  });

  it("does nothing when SAS is not installed", async () => {
    const store = new FakeStore();
    const state = new FakeState();

    const name = await addLocalSasProfile(
      store,
      state,
      DEFAULT_LOCAL_SAS_PATH,
      sasMissing,
    );

    expect(name).to.be.undefined;
    expect(store.profiles).to.deep.equal({});
    expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.be.undefined;
  });

  it("keeps the existing active profile", async () => {
    const viya: Profile = {
      connectionType: "rest",
      endpoint: "https://viya.example.com",
    } as Profile;
    const store = new FakeStore({ viya }, "viya");

    const name = await addLocalSasProfile(
      store,
      new FakeState(),
      DEFAULT_LOCAL_SAS_PATH,
      sasPresent,
    );

    expect(name).to.equal("local");
    expect(store.active).to.equal("viya");
    expect(store.profiles.viya).to.equal(viya);
  });

  it("does not add a second stdio profile", async () => {
    const mine: Profile = {
      connectionType: "stdio",
      saspath: "/custom/sas",
    } as Profile;
    const store = new FakeStore({ mine }, "mine");
    const state = new FakeState();

    const name = await addLocalSasProfile(
      store,
      state,
      DEFAULT_LOCAL_SAS_PATH,
      sasPresent,
    );

    expect(name).to.be.undefined;
    expect(Object.keys(store.profiles)).to.deep.equal(["mine"]);
    expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.equal(true);
  });

  it("does not re-add a profile the user deleted", async () => {
    const store = new FakeStore();
    const state = new FakeState();
    state.values[LOCAL_PROFILE_ADDED_KEY] = true;

    const name = await addLocalSasProfile(
      store,
      state,
      DEFAULT_LOCAL_SAS_PATH,
      sasPresent,
    );

    expect(name).to.be.undefined;
    expect(store.profiles).to.deep.equal({});
  });

  it("picks a free name when 'local' is taken", async () => {
    const other: Profile = {
      connectionType: "ssh",
      host: "h",
      saspath: "/s",
      port: 22,
      username: "u",
    } as Profile;
    const store = new FakeStore({ local: other }, "local");

    const name = await addLocalSasProfile(
      store,
      new FakeState(),
      DEFAULT_LOCAL_SAS_PATH,
      sasPresent,
    );

    expect(name).to.equal("local-2");
    expect(store.profiles.local).to.equal(other);
  });

  it("uses the first executable candidate", async () => {
    const store = new FakeStore();
    const installed = new Set(["/b/sas", "/c/sas"]);

    const name = await addLocalSasProfile(
      store,
      new FakeState(),
      ["/a/sas", "/b/sas", "/c/sas"],
      (path) => installed.has(path),
    );

    expect(name).to.equal("local");
    expect(store.profiles.local).to.deep.equal({
      connectionType: "stdio",
      saspath: "/b/sas",
    });
  });

  it("does nothing when no candidate is executable", async () => {
    const store = new FakeStore();
    const state = new FakeState();

    const name = await addLocalSasProfile(
      store,
      state,
      localSasCandidates(["/extra/sas"], "/usr/bin"),
      sasMissing,
    );

    expect(name).to.be.undefined;
    expect(store.profiles).to.deep.equal({});
    expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.be.undefined;
  });

  it("finds a SAS 9.4 install", async () => {
    const store = new FakeStore();
    const sas94 = "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8";

    await addLocalSasProfile(
      store,
      new FakeState(),
      localSasCandidates([], ""),
      (path) => path === sas94,
    );

    expect(store.profiles.local).to.deep.equal({
      connectionType: "stdio",
      saspath: sas94,
    });
  });

  it("falls back to sas on PATH", async () => {
    const store = new FakeStore();
    const onPath = join("/usr/local/bin", "sas");

    await addLocalSasProfile(
      store,
      new FakeState(),
      localSasCandidates([], ["/usr/bin", "/usr/local/bin"].join(delimiter)),
      (path) => path === onPath,
    );

    expect(store.profiles.local).to.deep.equal({
      connectionType: "stdio",
      saspath: onPath,
    });
  });

  it("prefers extra paths from the setting over the built-in locations", async () => {
    const store = new FakeStore();

    await addLocalSasProfile(
      store,
      new FakeState(),
      localSasCandidates(["/custom/sas"], "/usr/bin"),
      sasPresent,
    );

    expect(store.profiles.local).to.deep.equal({
      connectionType: "stdio",
      saspath: "/custom/sas",
    });
  });

  describe("when writing settings.json fails", () => {
    it("writes the profile and the active profile in one write", async () => {
      const store = new FakeStore();
      await addLocalSasProfile(
        store,
        new FakeState(),
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
      );
      expect(store.saves).to.have.length(1);
      expect(store.saves[0].active).to.equal("local");
      expect(Object.keys(store.saves[0].profiles)).to.deep.equal(["local"]);
    });

    it("retries after a conflict and succeeds", async () => {
      const store = new FakeStore();
      store.failures = 2;
      const state = new FakeState();
      const { record, retry } = noWait();

      const name = await addLocalSasProfile(
        store,
        state,
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
        retry,
      );

      expect(name).to.equal("local");
      expect(store.saves).to.have.length(3);
      expect(record.waits).to.deep.equal([1000, 2000]);
      expect(store.active).to.equal("local");
      expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.equal(true);
      expect(record.failed).to.be.empty;
    });

    it("leaves the flag unset and reports when every attempt fails", async () => {
      const store = new FakeStore();
      store.failures = 99;
      const state = new FakeState();
      const { record, retry } = noWait();

      const name = await addLocalSasProfile(
        store,
        state,
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
        retry,
      );

      expect(name).to.be.undefined;
      expect(store.saves).to.have.length(5);
      expect(record.waits).to.deep.equal([1000, 2000, 4000, 8000]);
      expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.be.undefined;
      expect(record.failed).to.have.length(1);
      expect(String(record.failed[0])).to.match(/newer/);
    });

    it("counts a write it cannot read back as failed", async () => {
      const store = new FakeStore();
      store.dropWrites = true;
      const state = new FakeState();
      const { record, retry } = noWait();

      const name = await addLocalSasProfile(
        store,
        state,
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
        { ...retry, delaysMs: [10] },
      );

      expect(name).to.be.undefined;
      expect(store.saves).to.have.length(2);
      expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.be.undefined;
      expect(String(record.failed[0])).to.match(/not in the settings/);
    });

    it("stops when a stdio profile appears before a retry", async () => {
      const store = new FakeStore();
      store.failures = 1;
      const state = new FakeState();
      const { retry } = noWait();
      let reads = 0;
      store.beforeRead = () => {
        // The failed write landed after all, seen on the next read.
        if (++reads === 2) {
          store.profiles = {
            local: { connectionType: "stdio", saspath: "/x" } as Profile,
          };
        }
      };

      const name = await addLocalSasProfile(
        store,
        state,
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
        retry,
      );

      expect(name).to.be.undefined;
      expect(store.saves).to.have.length(1);
      expect(state.values[LOCAL_PROFILE_ADDED_KEY]).to.equal(true);
    });

    it("keeps profiles another writer added before the retry", async () => {
      const viya = {
        connectionType: "rest",
        endpoint: "https://viya.example.com",
      } as Profile;
      const store = new FakeStore();
      store.failures = 1;
      let reads = 0;
      store.beforeRead = () => {
        if (++reads === 2) {
          store.profiles = { viya };
          store.active = "viya";
        }
      };

      const name = await addLocalSasProfile(
        store,
        new FakeState(),
        DEFAULT_LOCAL_SAS_PATH,
        sasPresent,
        noWait().retry,
      );

      expect(name).to.equal("local");
      expect(Object.keys(store.profiles).sort()).to.deep.equal([
        "local",
        "viya",
      ]);
      expect(store.active).to.equal("viya");
    });
  });
});

describe("localSasCandidates", () => {
  it("uses the UTF-8 launcher bin/sas_u8 for SAS 9.4", () => {
    expect(SAS94_LOCAL_SAS_PATHS).to.deep.equal([
      "/opt/sas/SASHome/SASFoundation/9.4/bin/sas_u8",
      "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8",
      "/opt/sasinside/SASHome/SASFoundation/9.4/bin/sas_u8",
      "/opt/SASHome/SASFoundation/9.4/bin/sas_u8",
    ]);
  });

  it("lists extra paths, Analytics Pro, SAS 9.4, then PATH, in order", () => {
    const pathEnv = ["/usr/bin", "/opt/bin"].join(delimiter);

    expect(localSasCandidates(["/custom/sas"], pathEnv)).to.deep.equal([
      "/custom/sas",
      DEFAULT_LOCAL_SAS_PATH,
      ...SAS94_LOCAL_SAS_PATHS,
      join("/usr/bin", "sas"),
      join("/opt/bin", "sas"),
    ]);
  });

  it("ignores relative extra paths and PATH entries", () => {
    const pathEnv = ["", ".", "bin", "/usr/bin"].join(delimiter);

    expect(localSasCandidates(["sas", "./sas"], pathEnv)).to.deep.equal([
      DEFAULT_LOCAL_SAS_PATH,
      ...SAS94_LOCAL_SAS_PATHS,
      join("/usr/bin", "sas"),
    ]);
  });

  it("handles an empty PATH", () => {
    expect(pathCandidates("sas", "")).to.deep.equal([]);
  });
});
