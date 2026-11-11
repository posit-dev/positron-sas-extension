// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import { isAxiosError } from "axios";

import type { ParameterProblem } from "./parameterValues";
import type { Outcome } from "./state";

export const JobMessages = {
  RunTitle: l10n.t("Running {name}"),
  RunState: l10n.t("{state}"),
  RunStateProgram: l10n.t("{state}: {program}"),
  Starting: l10n.t("Starting {name}..."),
  Canceling: l10n.t("Canceling {name}..."),
  RunError: l10n.t("Could not run {name}. {message}"),
  CancelError: l10n.t("Could not cancel the run of {name}. {message}"),
  LoadJobError: l10n.t("Could not read the job {name}. {message}"),
  ListError: l10n.t("Could not list the clinical job runs. {message}"),
  ManifestError: l10n.t("The manifest of this run is not available. {message}"),
  CheckinFailures: l10n.t(
    "{count} output(s) of {name} were not checked in. See the SAS Clinical Repository output for details.",
  ),
  ParameterPrompt: l10n.t("Value of the job parameter {label} ({type})"),
  ParameterTitle: l10n.t("Run {name}: {label}"),
  DatePlaceholder: l10n.t("YYYY-MM-DD"),
  PickFile: l10n.t("Choose a file for {label}"),
  PickFolder: l10n.t("Choose a folder for {label}"),
  UseThisFolder: l10n.t("Use this folder"),
  ParentFolder: l10n.t("Parent folder"),
  IncludeSubfolders: l10n.t("Include subfolders"),
  IncludeSubfoldersYes: l10n.t("Include the files of all subfolders"),
  IncludeSubfoldersNo: l10n.t("Only the files directly in the folder"),
  OpenLog: l10n.t("Open Log"),
  OpenResults: l10n.t("Open Results"),
  ShowInJobsView: l10n.t("Show Run"),
  NoLog: l10n.t("This run wrote no log."),
  NoResults: l10n.t("This run wrote no results."),
  NotAJob: l10n.t("Select a clinical job (.cjob) to run."),
  StillRunning: l10n.t("Running..."),
  LoadMore: l10n.t("Load more..."),
  NoRuns: l10n.t("No clinical job runs yet."),
  GroupPrograms: l10n.t("Programs"),
  GroupParameters: l10n.t("Parameters"),
  GroupInputs: l10n.t("Inputs"),
  GroupOutputs: l10n.t("Outputs"),
  GroupLogs: l10n.t("Logs"),
  GroupResults: l10n.t("Results"),
  GroupCheckinFailures: l10n.t("Check-in failures"),
  ExternalReference: l10n.t("external"),
  RunTooltip: l10n.t(
    "{state}\nSubmitted {submitted} by {submittedBy}\nRun as {runAs}\n{info}",
  ),
  Seconds: l10n.t("{seconds} s"),
  CannotOpen: l10n.t(
    "This file is in the repository but the run did not record its id, so it cannot be opened.",
  ),
};

/** Toast text for a finished run, by outcome. */
export const OutcomeMessages: Record<Exclude<Outcome, "running">, string> = {
  success: l10n.t("{name} completed successfully."),
  warning: l10n.t("{name} completed with warnings. {info}"),
  error: l10n.t("{name} did not complete successfully: {info}"),
  canceled: l10n.t("{name} was canceled."),
};

export const ParameterProblems: Record<
  Exclude<ParameterProblem, undefined>,
  string
> = {
  number: l10n.t("Enter a number."),
  date: l10n.t("Enter a date as YYYY-MM-DD."),
};

/**
 * The server's message with its details: for jobs the details carry the
 * useful part ("Clinical job parameter is invalid, ...").
 */
export function jobErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data: unknown = error.response?.data;
    if (data && typeof data === "object" && "message" in data) {
      const details =
        "details" in data && Array.isArray(data.details)
          ? data.details.filter((d): d is string => typeof d === "string")
          : [];
      return [String(data.message), ...details].join(" ");
    }
  }
  return error instanceof Error ? error.message : String(error);
}
