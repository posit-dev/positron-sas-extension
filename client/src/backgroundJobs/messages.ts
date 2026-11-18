// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import type { SasError } from "./types";

export const BackgroundJobMessages = {
  Submitting: l10n.t("Submitting {name} as a background job..."),
  Submitted: l10n.t(
    "{name} is running as a background job. It keeps running if you close Positron.",
  ),
  ShowJobs: l10n.t("Show Background Jobs"),
  SubmitError: l10n.t("Could not submit {name} as a background job. {message}"),
  NothingToSubmit: l10n.t("There is no SAS code to submit."),
  NotViya: l10n.t(
    "Background jobs need a SAS Viya connection. Switch to a SAS Viya profile to submit one.",
  ),
  NotAvailable: l10n.t(
    "This SAS Viya server does not offer the Job Execution service, so programs can't run as background jobs.",
  ),
  NotSaved: l10n.t(
    "{name} was submitted, but could not be saved as a SAS job in SAS Content. {message}",
  ),

  Completed: l10n.t("Background job {name} completed."),
  CompletedWithWarnings: l10n.t(
    "Background job {name} completed with warnings. {message}",
  ),
  Failed: l10n.t("Background job {name} failed. {message}"),
  Canceled: l10n.t("Background job {name} was canceled."),
  TimedOut: l10n.t("Background job {name} timed out."),
  OpenLog: l10n.t("Open Log"),
  OpenResults: l10n.t("Open Results"),

  Canceling: l10n.t("Canceling {name}..."),
  CancelError: l10n.t("Could not cancel {name}. {message}"),
  AlreadyFinished: l10n.t("{name} had already finished."),

  DeleteConfirm: l10n.t(
    "Delete the background job {name}? Its log and results are deleted on the server too.",
  ),
  DeleteManyConfirm: l10n.t(
    "Delete {count} background jobs? Their logs and results are deleted on the server too.",
  ),
  Delete: l10n.t("Delete"),
  DeleteError: l10n.t("Could not delete {name}. {message}"),

  ListError: l10n.t("Could not list the background jobs. {message}"),
  NoJobs: l10n.t(
    "No background jobs yet. Use Submit as Background Job in the Run menu of a SAS program.",
  ),
  Gone: l10n.t(
    "{name} is no longer on the server. It may have expired or been deleted.",
  ),
  LoadMore: l10n.t("Load more..."),

  NoLog: l10n.t("This job has no log."),
  NoResults: l10n.t(
    "This job produced no results. A background job gives the SAS listing; run the program in the console to get ODS HTML output.",
  ),
  FileError: l10n.t("Could not read {name} from the server. {message}"),
  LogTitle: l10n.t("Log: {name}"),
  ResultsTitle: l10n.t("Results: {name}"),
  PickResult: l10n.t("Choose a result of {name} to open"),

  ChooseContext: l10n.t("Choose the compute context for background jobs"),
  AlwaysUseContext: l10n.t("Always use this context"),
  ContextNotFound: l10n.t(
    "The compute context {name} was not found on this server.",
  ),
  EnterContext: l10n.t("Name of the compute context for background jobs"),

  // Tooltip labels.
  State: l10n.t("State"),
  SubmittedAt: l10n.t("Submitted"),
  Ended: l10n.t("Ended"),
  Elapsed: l10n.t("Run time"),
  Context: l10n.t("Compute context"),
  JobId: l10n.t("Job ID"),
  Error: l10n.t("Error"),
};

/**
 * A readable message from a failed request: the SAS error message and its
 * details when the server sent a vnd.sas.error body, the error text otherwise.
 * Correlator and path details are left out; they mean nothing to a user.
 */
export function backgroundJobErrorMessage(error: unknown): string {
  const data = responseData(error);
  if (data && typeof data === "object" && "message" in data) {
    const details =
      "details" in data && Array.isArray(data.details)
        ? data.details.filter(
            (d): d is string =>
              typeof d === "string" && !/^(path|correlator):/i.test(d),
          )
        : [];
    return [String(data.message), ...details].join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** A job's own error, as the server recorded it. */
export function jobErrorText(error: SasError | undefined): string {
  if (!error) {
    return "";
  }
  const details = (error.details ?? []).filter(
    (d) => !/^(path|correlator|traceId):/i.test(d),
  );
  return [error.message, ...details].filter(Boolean).join(" ");
}

function responseData(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }
  const response: unknown = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return undefined;
  }
  return response.data;
}
