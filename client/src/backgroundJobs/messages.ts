// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import type { TriggerWords, Weekday } from "./schedules";
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

  // SAS jobs (saved job definitions).
  SasJobsListError: l10n.t("Could not list your SAS jobs. {message}"),
  NoSasJobs: l10n.t(
    "No SAS jobs yet. Use Save as SAS Job in the Run menu of a SAS program.",
  ),
  FromSubmit: l10n.t("from Submit"),
  Folder: l10n.t("Folder"),
  Default: l10n.t("default"),
  Required: l10n.t("required"),
  NoDefinitionsService: l10n.t(
    "This SAS Viya server does not offer the Job Definitions service, so programs can't be saved as SAS jobs.",
  ),
  SaveTitle: l10n.t("Save as SAS Job"),
  SaveNamePrompt: l10n.t("Name of the SAS job"),
  SaveNameEmpty: l10n.t("Enter a name."),
  SaveNameInvalid: l10n.t("A name has at most 255 characters and no slashes."),
  PickFolder: l10n.t("Where to save the SAS job in SAS Content"),
  MyFolder: l10n.t("My Folder"),
  OtherFolder: l10n.t("Another folder..."),
  EnterFolderPath: l10n.t("Path of a folder in SAS Content"),
  FolderPathAbsolute: l10n.t("Start the path with /, as in /Public/Reports."),
  FolderNotFound: l10n.t(
    "There is no folder {path} in SAS Content. Enter another path.",
  ),
  NameTaken: l10n.t("{folder} already has {name}."),
  ReplaceExisting: l10n.t("Replace the SAS job {name}"),
  SaveUnderName: l10n.t("Save it as {name}"),
  ReplaceGone: l10n.t("The SAS job to replace is no longer on the server."),
  PickParameters: l10n.t(
    "Macro variables the program reads: choose which become job parameters",
  ),
  DefaultFor: l10n.t(
    "Default value of &{name}, asked for when the job runs (leave empty for none)",
  ),
  Saved: l10n.t("Saved the SAS job {name} in {folder}."),
  SaveError: l10n.t("Could not save the SAS job {name}. {message}"),
  RunNow: l10n.t("Run Now"),
  RunTitle: l10n.t("Run {name}"),
  ParameterPrompt: l10n.t("{label}: value of &{name} ({type})"),
  ValueRequired: l10n.t("This parameter is required."),
  ValueNumber: l10n.t("Enter a number."),
  DeleteSasJobConfirm: l10n.t(
    "Delete the SAS job {name} from SAS Content? Background jobs already run from it are kept.",
  ),
  DeleteSasJobsConfirm: l10n.t(
    "Delete {count} SAS jobs from SAS Content? Background jobs already run from them are kept.",
  ),
  DeleteFromSubmitDetail: l10n.t(
    "A SAS job that Submit as Background Job made is made again the next time you submit its program.",
  ),

  // Schedules.
  SchedulesListError: l10n.t(
    "Could not list your SAS job schedules. {message}",
  ),
  NoSchedules: l10n.t(
    "No schedules yet. Right-click a SAS job in SAS Jobs and select Schedule.",
  ),
  ScheduleTitle: l10n.t("Schedule {name}"),
  ScheduleName: l10n.t("Name of the schedule"),
  ScheduleKind: l10n.t("When should {name} run?"),
  KindOnce: l10n.t("Once"),
  KindDates: l10n.t("On several dates"),
  KindMinutes: l10n.t("Every few minutes"),
  KindHours: l10n.t("Every few hours"),
  KindDaily: l10n.t("Every day"),
  KindWorkdays: l10n.t("Every weekday (Monday to Friday)"),
  KindWeekly: l10n.t("Every week, on chosen days"),
  KindMonthly: l10n.t("Every month, on a chosen day"),
  ScheduleDate: l10n.t("Date (YYYY-MM-DD)"),
  ScheduleDates: l10n.t("Dates (YYYY-MM-DD), separated by commas"),
  ScheduleTime: l10n.t("Time of day (HH:MM, 24-hour clock), in {zone}"),
  ScheduleEveryMinutes: l10n.t("How many minutes between runs"),
  ScheduleEveryHours: l10n.t("How many hours between runs"),
  ScheduleMinute: l10n.t("Minute past the hour (0-59)"),
  ScheduleDays: l10n.t("On which days"),
  ScheduleDayOfMonth: l10n.t("On which day of the month"),
  LastDayOfMonth: l10n.t("Last day of the month"),
  DayOfMonth: l10n.t("Day {day}"),
  EveryMinutesItem: l10n.t("Every {n} minutes"),
  EveryHoursItem: l10n.t("Every {n} hours"),
  InvalidDate: l10n.t("Enter a date as YYYY-MM-DD."),
  InvalidDates: l10n.t("Enter dates as YYYY-MM-DD, separated by commas."),
  InvalidTime: l10n.t("Enter a time as HH:MM, from 00:00 to 23:59."),
  InvalidMinute: l10n.t("Enter a whole number from 0 to 59."),
  PickDays: l10n.t("Choose at least one day."),
  Scheduled: l10n.t("Scheduled {name}: {when}. Next run: {next}."),
  ScheduledNoNext: l10n.t("Scheduled {name}: {when}."),
  ScheduleError: l10n.t("Could not schedule {name}. {message}"),
  NeverFires: l10n.t(
    "{name} would never run: its time has passed. Choose a time in the future.",
  ),
  EnableNeverFires: l10n.t(
    "{name} can't be enabled because it has no runs left, such as a one-time schedule whose time has passed. Create a new schedule instead.",
  ),
  EnableError: l10n.t("Could not change {name}. {message}"),
  UnexpectedFireTimes: l10n.t(
    "The SAS Viya Scheduler would not run {name} at the times you chose, so the schedule was removed before it could run. Please report this.",
  ),
  DeleteScheduleConfirm: l10n.t(
    "Delete the schedule {name}? The SAS job and its past runs are kept.",
  ),
  DeleteSchedulesConfirm: l10n.t(
    "Delete {count} schedules? The SAS jobs and their past runs are kept.",
  ),
  PickJobToSchedule: l10n.t("Choose the SAS job to schedule"),
  Disabled: l10n.t("disabled"),
  NoMoreRuns: l10n.t("no more runs"),
  NextRuns: l10n.t("Next runs"),
  LastRun: l10n.t("Last run"),
  LastRunFailed: l10n.t("failed to start (HTTP {status})"),
  LastRunStarted: l10n.t("started"),
  Values: l10n.t("Values"),
  SasJob: l10n.t("SAS job"),
  TimeZone: l10n.t("Time zone"),
  DeleteSasJobSchedulesDetail: l10n.t(
    "Schedules that run it stop working. Delete them in SAS Job Schedules.",
  ),

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

/** Words for describing schedules, such as "Weekdays at 06:30". */
export const TriggerWordText: TriggerWords = {
  once: l10n.t("Once on {date} at {time}"),
  dates: l10n.t("On {dates} at {time}"),
  minutes: l10n.t("Every {n} minutes"),
  everyMinute: l10n.t("Every minute"),
  hours: l10n.t("Every {n} hours at minute {minute}"),
  everyHour: l10n.t("Every hour at minute {minute}"),
  daily: l10n.t("Daily at {time}"),
  everyDays: l10n.t("Every {n} days at {time}"),
  workdays: l10n.t("Weekdays at {time}"),
  weekly: l10n.t("Weekly on {days} at {time}"),
  monthly: l10n.t("Monthly on day {day} at {time}"),
  monthlyLast: l10n.t("Monthly on the last day at {time}"),
  other: l10n.t("Custom schedule"),
  days: {
    monday: l10n.t("Mon"),
    tuesday: l10n.t("Tue"),
    wednesday: l10n.t("Wed"),
    thursday: l10n.t("Thu"),
    friday: l10n.t("Fri"),
    saturday: l10n.t("Sat"),
    sunday: l10n.t("Sun"),
  },
};

/** Full day names, for choosing days. */
export const DayNames: Record<Weekday, string> = {
  monday: l10n.t("Monday"),
  tuesday: l10n.t("Tuesday"),
  wednesday: l10n.t("Wednesday"),
  thursday: l10n.t("Thursday"),
  friday: l10n.t("Friday"),
  saturday: l10n.t("Saturday"),
  sunday: l10n.t("Sunday"),
};
