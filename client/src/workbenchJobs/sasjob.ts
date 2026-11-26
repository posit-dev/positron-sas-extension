// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// How a SAS program runs as a Posit Workbench Job: with `sasjob`, which runs
// the program on SAS Viya and streams its log. This module does not use the
// vscode API, so it can be unit tested without a VS Code host.
import type { ResolvedScriptType } from "./posit-workbench-api";

/** The parts of a connection profile that decide how sasjob runs. */
export interface SasJobProfile {
  connectionType: string;
  endpoint?: string;
  context?: string;
  sasOptions?: string[];
  authentication?: "auto" | "workbench" | "sasLogon";
  workbenchIntegration?: string;
}

export interface SasJobInput {
  /** The active connection profile, if there is one. */
  profile?: SasJobProfile;
  profileName?: string;
  /** The profile's autoexec, as lines (see toAutoExecLines). */
  autoExecLines?: string[];
  /** The sasjob command, from the SAS.workbenchJobs.sasjobPath setting. */
  executable: string;
  /** The cluster selected in the Workbench Jobs dialog. */
  cluster?: { name: string };
}

export const DEFAULT_SASJOB = "sasjob";

/**
 * SAS system options the way the SAS Viya Compute service takes them: the
 * REST connection turns "-PAGESIZE=MAX" into "-PAGESIZE MAX" the same way.
 */
export function computeSasOption(option: string): string {
  return option.replace(/=/g, " ");
}

/**
 * The sasjob arguments for a SAS Viya profile, each option and its value a
 * separate argument. The Workbench Jobs dialog shows them so that users can
 * change them before they start the job.
 */
export function buildSasjobArgs(
  profile: SasJobProfile,
  autoExecLines: string[] = [],
): string[] {
  const args: string[] = [];
  const endpoint = profile.endpoint?.trim().replace(/\/+$/, "");
  if (endpoint) {
    args.push("--viya-url", endpoint);
  }
  if (profile.workbenchIntegration?.trim()) {
    args.push("--integration", profile.workbenchIntegration.trim());
  }
  if (profile.context?.trim()) {
    args.push("--context", profile.context.trim());
  }
  for (const option of profile.sasOptions ?? []) {
    if (option.trim()) {
      args.push("--sas-option", computeSasOption(option.trim()));
    }
  }
  for (const line of autoExecLines) {
    // The dialog drops empty arguments, which would leave a dangling flag.
    if (line.trim()) {
      args.push("--autoexec-line", line);
    }
  }
  return args;
}

/** What the Workbench Jobs dialog runs for a SAS program, and what to warn about. */
export function resolveSasJob(input: SasJobInput): ResolvedScriptType {
  const executable = input.executable.trim() || DEFAULT_SASJOB;
  const { profile, profileName } = input;
  const warnings: string[] = [];
  let defaultArgs: string[] = [];

  if (!profile) {
    warnings.push(
      "No SAS connection profile is active. Select a SAS Viya profile, or add the --viya-url argument.",
    );
  } else if (profile.connectionType !== "rest") {
    warnings.push(
      `The SAS connection profile "${profileName ?? ""}" does not connect to SAS Viya. Workbench Jobs run SAS programs on SAS Viya: select a SAS Viya profile, or add the --viya-url argument.`,
    );
  } else {
    defaultArgs = buildSasjobArgs(profile, input.autoExecLines);
    if (profile.authentication === "sasLogon") {
      warnings.push(
        `The SAS connection profile "${profileName ?? ""}" signs in with SAS Logon, but a Workbench Job signs in to SAS Viya with your Posit Workbench OAuth integration.`,
      );
    }
  }

  if (input.cluster && input.cluster.name !== "Local") {
    warnings.push(
      `Make sure that "${executable}" is installed where jobs run on the ${input.cluster.name} cluster.`,
    );
  }

  return { executable, leadingArgs: ["run"], defaultArgs, warnings };
}
