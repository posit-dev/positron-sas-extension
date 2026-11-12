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

/**
 * Common SAS 9.4 Foundation install locations. These are the UTF-8 launcher
 * `bin/sas_u8`, not the `sas` script (which may start a non-UTF-8 locale): the
 * extension reads SAS output as UTF-8.
 */
export const SAS94_LOCAL_SAS_PATHS: readonly string[] = [
  "/opt/sas/SASHome/SASFoundation/9.4/bin/sas_u8",
  "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8",
  "/opt/sasinside/SASHome/SASFoundation/9.4/bin/sas_u8",
  "/opt/SASHome/SASFoundation/9.4/bin/sas_u8",
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
  /** Write the active profile and all profiles to settings in one write. */
  saveProfiles(
    activeProfile: string,
    profiles: { [name: string]: Profile },
  ): Promise<void>;
}

/** How addLocalSasProfile retries a failed write of settings.json. */
export interface LocalProfileRetry {
  /** Waits before the 2nd, 3rd, ... attempt, in milliseconds. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** Called once when every attempt failed, with the last error. */
  onFailed?: (error: unknown) => void;
}

/**
 * Waits between attempts. Posit Workbench writes settings.json at session
 * start; a write of ours that overlaps it fails ("The content of the file is
 * newer"), and a later one succeeds.
 */
export const LOCAL_PROFILE_RETRY_DELAYS_MS: readonly number[] = [
  1000, 2000, 4000, 8000,
];

const hasStdioProfile = (profiles: { [name: string]: Profile }) =>
  Object.values(profiles).some((profile) => profile.connectionType === STDIO);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
 * The profile and the active profile are written in one write. A failed write
 * (another writer changed settings.json at the same moment) is retried after
 * reading the settings again, and an attempt counts only when the profile can
 * be read back. The added-once flag is set only then, so if every attempt
 * fails, the next start tries again.
 *
 * @returns the name of the added profile, or undefined if none was added.
 */
export async function addLocalSasProfile(
  store: LocalProfileStore,
  state: LocalProfileState,
  candidates: string | readonly string[] = localSasCandidates(),
  isExecutable: (path: string) => boolean = isExecutableFile,
  {
    delaysMs = LOCAL_PROFILE_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onFailed,
  }: LocalProfileRetry = {},
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

  const profile: StdioProfile = {
    connectionType: STDIO,
    saspath: sasPath,
  };
  const attempts = delaysMs.length + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      await sleep(delaysMs[attempt - 2]);
    }
    // Read afresh: another writer, or our last attempt, may have changed it.
    const profiles = store.getAllProfiles() ?? {};
    if (hasStdioProfile(profiles)) {
      await state.update(LOCAL_PROFILE_ADDED_KEY, true);
      return undefined;
    }

    let name = LOCAL_PROFILE_NAME;
    for (let i = 2; name in profiles; i++) {
      name = `${LOCAL_PROFILE_NAME}-${i}`;
    }
    const active = store.getActiveProfile() || name;
    try {
      await store.saveProfiles(active, { ...profiles, [name]: profile });
      const saved = store.getAllProfiles()?.[name];
      if (
        saved?.connectionType === STDIO &&
        "saspath" in saved &&
        saved.saspath === sasPath
      ) {
        await state.update(LOCAL_PROFILE_ADDED_KEY, true);
        return name;
      }
      lastError = new Error("The profile is not in the settings after saving.");
    } catch (error) {
      lastError = error;
    }
    console.warn(
      `Could not save the local SAS profile (attempt ${attempt}/${attempts}): ${messageOf(lastError)}`,
    );
  }
  onFailed?.(lastError);
  return undefined;
}
