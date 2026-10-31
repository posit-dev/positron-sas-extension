// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import type { Profile } from "../../src/components/profile";
import {
  DEFAULT_LOCAL_SAS_PATH,
  LOCAL_PROFILE_ADDED_KEY,
  LocalProfileState,
  LocalProfileStore,
  addLocalSasProfile,
} from "../../src/positron/localSasProfile";

class FakeStore implements LocalProfileStore {
  constructor(
    public profiles: { [name: string]: Profile } = {},
    public active = "",
  ) {}
  getAllProfiles() {
    return this.profiles;
  }
  getActiveProfile() {
    return this.active;
  }
  async upsertProfile(name: string, profile: Profile) {
    this.profiles = { ...this.profiles, [name]: profile };
  }
  async updateActiveProfileSetting(name: string) {
    this.active = name;
  }
}

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
});
