// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { accessSync, constants, statSync } from "fs";
import { delimiter, isAbsolute, join } from "path";

// Type-only imports: components/profile pulls in the VS Code API at load time,
// which this module must not need (it is unit-tested without VS Code).
import type {
  ConnectionType,
  Profile,
  StdioProfile,
} from "../components/profile";

/** Where SAS Analytics Pro images install the SAS launcher. */
export const DEFAULT_LOCAL_SAS_PATH = "/opt/sas/viya/home/SASFoundation/sas";

/** Common SAS 9.4 Foundation install locations: the `sas` launcher script in SASFoundation/9.4. */
export const SAS94_LOCAL_SAS_PATHS: readonly string[] = [
  "/opt/sas/SASHome/SASFoundation/9.4/sas",
  "/usr/local/SASHome/SASFoundation/9.4/sas",
  "/opt/sasinside/SASHome/SASFoundation/9.4/sas",
  "/opt/SASHome/SASFoundation/9.4/sas",
];

/** Name of the SAS launcher looked up on PATH when no known location has SAS. */
const SAS_COMMAND = "sas";

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
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The places `command` would be found on PATH, in PATH order (absolute directories only). */
export function pathCandidates(
  command: string,
  pathEnv: string | undefined = process.env.PATH,
): string[] {
  return (pathEnv ?? "")
    .split(delimiter)
    .filter((dir) => dir && isAbsolute(dir))
    .map((dir) => join(dir, command));
}

/**
 * Where to look for SAS, in order: the user's extra paths (SAS.localSasPaths),
 * the SAS Analytics Pro path, common SAS 9.4 install paths, then `sas` on PATH.
 */
export function localSasCandidates(
  extraPaths: readonly string[] = [],
  pathEnv: string | undefined = process.env.PATH,
): string[] {
  return [
    ...extraPaths.filter(
      (path) => typeof path === "string" && isAbsolute(path),
    ),
    DEFAULT_LOCAL_SAS_PATH,
    ...SAS94_LOCAL_SAS_PATHS,
    ...pathCandidates(SAS_COMMAND, pathEnv),
  ];
}

/**
 * Adds a "local" stdio profile when SAS is installed on this machine (for example
 * a Workbench session started from a SAS Analytics Pro image), so SAS shows up in
 * the console without writing a connection profile first. The first executable
 * candidate (see localSasCandidates) becomes the profile's saspath. It is added once: an
 * existing stdio profile, or a user who deleted the added one, is left alone. It
 * becomes the active profile only if none is set.
 *
 * @returns the name of the added profile, or undefined if none was added.
 */
export async function addLocalSasProfile(
  store: LocalProfileStore,
  state: LocalProfileState,
  candidates: string | readonly string[] = localSasCandidates(),
  isExecutable: (path: string) => boolean = isExecutableFile,
): Promise<string | undefined> {
  if (state.get<boolean>(LOCAL_PROFILE_ADDED_KEY)) {
    return undefined;
  }
  const sasPath = (
    typeof candidates === "string" ? [candidates] : candidates
  ).find((path) => isExecutable(path));
  if (!sasPath) {
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
