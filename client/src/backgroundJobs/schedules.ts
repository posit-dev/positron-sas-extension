// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Schedules for SAS jobs (#150, phase 3), in the SAS Viya Scheduler service,
// which has no published API. Shapes were checked against a live server
// (2026-11-18):
//
// - A schedule fires an arbitrary HTTP request. Ours posts to a persisted job
//   request, /jobExecution/jobRequests/{id}/jobs?submitter=positron-sas, so
//   each run is an ordinary background job that the Background Jobs view
//   lists. The job request holds the parameter values.
// - Triggers are TIMEEVENT with a recurrence. `hours` is required for every
//   kind, as a comma-separated string, and EACH listed hour starts its own
//   series. For minutely and hourly triggers it must be a single hour ("0"):
//   listing all 24 made an every-5-minutes schedule fire once per hour that
//   had begun, 19 jobs at a time by the evening. Its fire times still looked
//   distinct for a schedule starting at a future midnight; only the uneven
//   gaps showed it. fireTimesProblem checks new schedules for exactly that.
// - dayOfMonth 32 is the last day of the month. Minutely steps are limited to
//   divisors of 60, hourly steps to divisors of 24 (per the SAS docs).
// - An inactive trigger has no fire times. Pausing through the state endpoint
//   is not visible on the schedule, so enabling and disabling sets `active`.
//
// Nothing here imports `vscode`, so it can be unit tested outside the host.
import { SUBMITTER } from "./const";

export const SCHEDULE_GROUP = "positron-sas";
export const SCHEDULE_MEDIA_TYPE = "application/vnd.sas.schedule.job+json";

export const MINUTE_STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WORKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

/** Day of the month that the Scheduler reads as the last one. */
export const LAST_DAY = 32;

export interface Recurrence {
  type: string;
  startDate?: string;
  endDate?: string;
  skipCount?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  dates?: string[];
}

export interface SchedulerTrigger {
  id?: string;
  type: "TIMEEVENT";
  name?: string;
  active: boolean;
  recurrence: Recurrence;
  hours: string;
  minutes: string;
  timezone?: string;
  maxOccurrence?: number;
}

export interface SchedulerJob {
  id?: string;
  name: string;
  group?: string;
  runAs?: string;
  createdBy?: string;
  modifiedTimeStamp?: string;
  request: {
    uri: string;
    method: string;
    headers?: Record<string, string[]>;
    body?: unknown;
  };
  triggers: SchedulerTrigger[];
  jobTimeOut?: number;
}

export interface ScheduleHistoryItem {
  jobFireTimeStamp?: string;
  /** SUCCESS when the request was accepted, such as a job being created. */
  jobStatus?: string;
  httpStatusCode?: number;
  /** The response to the fired request: here, the job that was created. */
  body?: { id?: string; message?: string };
}

/** The kinds of schedule offered when creating one. */
export type ScheduleKind =
  | "once"
  | "dates"
  | "minutes"
  | "hours"
  | "daily"
  | "workdays"
  | "weekly"
  | "monthly";

/** What the prompts collect; one shape for every kind. */
export interface ScheduleAnswers {
  kind: ScheduleKind;
  /** YYYY-MM-DD, for once and dates. */
  dates?: string[];
  /** HH:MM, for every kind but minutes and hours. */
  time?: string;
  /** Every n minutes or hours, from MINUTE_STEPS or HOUR_STEPS. */
  every?: number;
  /** For hours: the minute past the hour. */
  minute?: number;
  /** For weekly. */
  days?: Weekday[];
  /** For monthly: 1-31, or LAST_DAY. */
  dayOfMonth?: number;
  /** YYYY-MM-DD; defaults to the first date for once and dates. */
  startDate: string;
  endDate?: string;
  timeZone: string;
}

const splitTime = (time: string | undefined): [string, string] => {
  const [h, m] = (time ?? "00:00").split(":");
  return [String(Number(h) || 0), String(Number(m) || 0)];
};

/** The trigger the Scheduler is sent for the answers. */
export function buildTrigger(
  answers: ScheduleAnswers,
  name: string,
): SchedulerTrigger {
  const recurrence: Recurrence = {
    type: "daily",
    startDate: answers.startDate,
  };
  if (answers.endDate) {
    recurrence.endDate = answers.endDate;
  }
  let [hours, minutes] = splitTime(answers.time);
  switch (answers.kind) {
    case "once":
    case "dates": {
      const dates = [...(answers.dates ?? [])].sort();
      recurrence.type = "dateList";
      recurrence.dates = dates;
      // Starting on the first date keeps a past start from mattering.
      recurrence.startDate = dates[0] ?? answers.startDate;
      break;
    }
    case "minutes":
      recurrence.type = "minutely";
      recurrence.skipCount = answers.every ?? 15;
      // One series from midnight; every listed hour would start another.
      hours = "0";
      minutes = "0";
      break;
    case "hours":
      recurrence.type = "hourly";
      recurrence.skipCount = answers.every ?? 1;
      hours = "0";
      minutes = String(answers.minute ?? 0);
      break;
    case "daily":
      recurrence.type = "daily";
      recurrence.skipCount = answers.every ?? 1;
      break;
    case "workdays":
      recurrence.type = "daily";
      recurrence.daysOfWeek = [...WORKDAYS];
      break;
    case "weekly":
      recurrence.type = "weekly";
      recurrence.skipCount = 1;
      recurrence.daysOfWeek = sortDays(answers.days ?? ["monday"]);
      break;
    case "monthly":
      recurrence.type = "monthly";
      recurrence.skipCount = 1;
      recurrence.dayOfMonth = answers.dayOfMonth ?? 1;
      break;
  }
  return {
    type: "TIMEEVENT",
    name,
    active: true,
    recurrence,
    hours,
    minutes,
    timezone: answers.timeZone,
  };
}

/** The schedule to create: it runs a persisted job request. */
export function buildSchedule(options: {
  name: string;
  jobRequestId: string;
  trigger: SchedulerTrigger;
  language: string;
}): SchedulerJob {
  return {
    name: options.name,
    group: SCHEDULE_GROUP,
    request: {
      uri: `/jobExecution/jobRequests/${options.jobRequestId}/jobs?submitter=${SUBMITTER}`,
      method: "POST",
      headers: {
        Accept: ["application/vnd.sas.job.execution.job+json"],
        // Submits without it failed with Compute error 5023; scheduled runs
        // did not, but the request should not depend on that.
        "Accept-Language": [options.language],
      },
    },
    triggers: [options.trigger],
  };
}

/** The job request a schedule runs, from the URI it fires. */
export function jobRequestIdOf(schedule: SchedulerJob): string | undefined {
  const match = /\/jobExecution\/jobRequests\/([^/?#]+)\/jobs/.exec(
    schedule.request?.uri ?? "",
  );
  return match?.[1];
}

/** Whether every trigger of a schedule is active. */
export function isEnabled(schedule: SchedulerJob): boolean {
  return (
    schedule.triggers.length > 0 && schedule.triggers.every((t) => t.active)
  );
}

/** The schedule with every trigger switched on or off, for a PUT. */
export function withEnabled(
  schedule: SchedulerJob,
  enabled: boolean,
): SchedulerJob {
  const { id, name, group, request, triggers, jobTimeOut } = schedule;
  return {
    id,
    name,
    group,
    request,
    jobTimeOut,
    triggers: triggers.map((t) => ({ ...t, active: enabled })),
  };
}

const DAY_ORDER: Record<string, number> = Object.fromEntries(
  WEEKDAYS.map((day, index) => [day, index]),
);

export const isWeekday = (value: string): value is Weekday =>
  value in DAY_ORDER;

const sortDays = (days: readonly string[]): string[] =>
  [...new Set(days.map((d) => d.toLowerCase()))].sort(
    (a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99),
  );

/** Words for describing a trigger; the caller localizes them. */
export interface TriggerWords {
  once: string; // "Once on {date} at {time}"
  dates: string; // "On {dates} at {time}"
  minutes: string; // "Every {n} minutes"
  everyMinute: string; // "Every minute"
  hours: string; // "Every {n} hours at minute {minute}"
  everyHour: string; // "Every hour at minute {minute}"
  daily: string; // "Daily at {time}"
  everyDays: string; // "Every {n} days at {time}"
  workdays: string; // "Weekdays at {time}"
  weekly: string; // "Weekly on {days} at {time}"
  monthly: string; // "Monthly on day {day} at {time}"
  monthlyLast: string; // "Monthly on the last day at {time}"
  other: string; // "Custom schedule"
  days: Record<Weekday, string>;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );

const pad = (n: string | number) => String(n).padStart(2, "0");

/** A sentence for a trigger, such as "Weekdays at 06:30". */
export function describeTrigger(
  trigger: SchedulerTrigger,
  words: TriggerWords,
): string {
  const r = trigger.recurrence ?? { type: "" };
  const firstHour = (trigger.hours ?? "0").split(",")[0];
  const time = `${pad(firstHour)}:${pad(trigger.minutes ?? "0")}`;
  const days = (r.daysOfWeek ?? []).map((d) => {
    const day = d.toLowerCase();
    return isWeekday(day) ? words.days[day] : d;
  });
  const n = r.skipCount ?? 1;
  switch ((r.type ?? "").toLowerCase()) {
    case "datelist": {
      const dates = r.dates ?? [];
      return dates.length === 1
        ? fill(words.once, { date: dates[0], time })
        : fill(words.dates, { dates: dates.join(", "), time });
    }
    case "minutely":
      return n === 1 ? words.everyMinute : fill(words.minutes, { n });
    case "hourly":
      return fill(n === 1 ? words.everyHour : words.hours, {
        n,
        minute: pad(trigger.minutes ?? "0"),
      });
    case "daily":
      if (
        days.length === WORKDAYS.length &&
        WORKDAYS.every((d) => (r.daysOfWeek ?? []).includes(d))
      ) {
        return fill(words.workdays, { time });
      }
      if (days.length) {
        return fill(words.weekly, { days: days.join(", "), time });
      }
      return n === 1
        ? fill(words.daily, { time })
        : fill(words.everyDays, { n, time });
    case "weekly":
      return fill(words.weekly, { days: days.join(", "), time });
    case "monthly":
      return r.dayOfMonth === LAST_DAY
        ? fill(words.monthlyLast, { time })
        : fill(words.monthly, { day: r.dayOfMonth ?? 1, time });
    default:
      return words.other;
  }
}

/** Whether a string is HH:MM on a 24-hour clock. */
export const isTime = (text: string): boolean =>
  /^([01]?\d|2[0-3]):[0-5]\d$/.test(text.trim());

/** Whether a string is a real YYYY-MM-DD date. */
export function isDate(text: string): boolean {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return false;
  }
  const date = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(t);
}

/** "2026-12-01, 2026-12-15" as a sorted list of dates, or undefined. */
export function parseDates(text: string): string[] | undefined {
  const parts = text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || !parts.every(isDate)) {
    return undefined;
  }
  return [...new Set(parts)].sort();
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** What the last firing of a schedule did, from its history. */
export function lastRun(
  items: readonly ScheduleHistoryItem[],
): { at?: string; ok: boolean; jobId?: string; status?: number } | undefined {
  const latest = [...items].sort((a, b) =>
    (b.jobFireTimeStamp ?? "").localeCompare(a.jobFireTimeStamp ?? ""),
  )[0];
  if (!latest) {
    return undefined;
  }
  const ok =
    (latest.jobStatus ?? "").toUpperCase() === "SUCCESS" &&
    (latest.httpStatusCode ?? 200) < 400;
  return {
    at: latest.jobFireTimeStamp,
    ok,
    jobId: latest.body?.id,
    status: latest.httpStatusCode,
  };
}

/**
 * Why the fire times of a new schedule are not what was asked for, or
 * undefined when they are fine. They must be distinct and increasing, and
 * for every-n-minutes or every-n-hours schedules exactly n apart. A
 * schedule that fails this must not be left running: a bad trigger shape can
 * start many runs at once.
 */
export function fireTimesProblem(
  times: readonly string[],
  answers: Pick<ScheduleAnswers, "kind" | "every">,
): "duplicate" | "uneven" | undefined {
  const at = times.map((t) => Date.parse(t));
  for (let i = 1; i < at.length; i++) {
    if (!(at[i] > at[i - 1])) {
      return "duplicate";
    }
  }
  const step =
    answers.kind === "minutes"
      ? (answers.every ?? 15) * 60_000
      : answers.kind === "hours"
        ? (answers.every ?? 1) * 3_600_000
        : undefined;
  if (step !== undefined) {
    for (let i = 1; i < at.length; i++) {
      if (at[i] - at[i - 1] !== step) {
        return "uneven";
      }
    }
  }
  return undefined;
}
