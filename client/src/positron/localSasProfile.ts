// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { accessSync, constants } from "fs";

// Type-only imports: components/profile pulls in the VS Code API at load time,
// which this module must not need (it is unit-tested without VS Code).
import type {
  ConnectionType,
  Profile,
  StdioProfile,
} from "../components/profile";

/** Where SAS Analytics Pro and SAS 9.4 Foundation images install the SAS launcher. */
export const DEFAULT_LOCAL_SAS_PATH = "/opt/sas/viya/home/SASFoundation/sas";

/** globalState key: set once the local profile was added, so a deleted profile stays deleted. */
export const LOCAL_PROFILE_ADDED_KEY = "SAS.localProfileAdded";

const LOCAL_PROFILE_NAME = "local";

// ConnectionType.Stdio's value; the enum itself is only imported as a type (see above).
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const STDIO = "stdio" as ConnectionType.Stdio;

/** The parts of ProfileConfig this module needs. */
export interface LocalProfileStore {
  getAllProfiles(): { [name: string]: Profile };
  getActiveProfile(): string;
  upsertProfile(name: string, profile: Profile): Promise<void>;
  updateActiveProfileSetting(name: string): Promise<void>;
}

/** The parts of vscode.Memento this module needs. */
export interface LocalProfileState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds a "local" stdio profile when SAS is installed on this machine (for example
 * a Workbench session started from a SAS Analytics Pro image), so SAS shows up in
 * the console without writing a connection profile first. It is added once: an
 * existing stdio profile, or a user who deleted the added one, is left alone. It
 * becomes the active profile only if none is set.
 *
 * @returns the name of the added profile, or undefined if none was added.
 */
export async function addLocalSasProfile(
  store: LocalProfileStore,
  state: LocalProfileState,
  sasPath: string = DEFAULT_LOCAL_SAS_PATH,
  isExecutable: (path: string) => boolean = isExecutableFile,
): Promise<string | undefined> {
  if (state.get<boolean>(LOCAL_PROFILE_ADDED_KEY) || !isExecutable(sasPath)) {
    return undefined;
  }

  const profiles = store.getAllProfiles() ?? {};
  if (
    Object.values(profiles).some((profile) => profile.connectionType === STDIO)
  ) {
    await state.update(LOCAL_PROFILE_ADDED_KEY, true);
    return undefined;
  }

  let name = LOCAL_PROFILE_NAME;
  for (let i = 2; name in profiles; i++) {
    name = `${LOCAL_PROFILE_NAME}-${i}`;
  }

  const profile: StdioProfile = {
    connectionType: STDIO,
    saspath: sasPath,
  };
  await store.upsertProfile(name, profile);
  if (!store.getActiveProfile()) {
    await store.updateActiveProfileSetting(name);
  }
  await state.update(LOCAL_PROFILE_ADDED_KEY, true);
  return name;
}
