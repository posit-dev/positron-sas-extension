// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Clinical job schedule triggers: between the service's trigger objects, the
// answers of the New Schedule prompts, and a sentence for people. No vscode
// import, so it is unit-tested directly.
import type {
  DayOfWeek,
  JobResource,
  Occurrence,
  ParameterValue,
  Schedule,
  Trigger,
  TriggerType,
} from "./types";
import { resourceFromPath } from "./utils";

export const DAYS_OF_WEEK: DayOfWeek[] = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
];
export const OCCURRENCES: Occurrence[] = [
  "FIRST",
  "SECOND",
  "THIRD",
  "FOURTH",
  "LAST",
];
export const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;
export type Month = (typeof MONTHS)[number];

/** What the New Schedule prompts collect; one shape for every trigger type. */
export interface TriggerAnswers {
  type: TriggerType;
  /** DATELIST: YYYY-MM-DD. */
  dates?: string[];
  /** HH:MM, for every type but MINUTELY and HOURLY. */
  time?: string;
  /** HOURLY: the minute of the hour. */
  minute?: number;
  /** Every n minutes, hours, days, weeks, months or years. */
  interval?: number;
  /** WEEKLY: the days; MONTHLY and YEARLY by occurrence: one day. */
  daysOfWeek?: DayOfWeek[];
  /** MONTHLY and YEARLY: a day of the month ... */
  dayOfMonth?: number;
  /** ... or the n-th weekday, such as the first Monday. */
  occurrence?: Occurrence;
  monthOfYear?: Month;
  /** YYYY-MM-DD. */
  start?: string;
  end?: string;
  /** Stop after this many runs. */
  numOccurrences?: number;
  timeZone: string;
}

const pad = (n: number | string) => String(n).padStart(2, "0");

/** "3" and "0" → "03:00". */
export function triggerTime(trigger: Trigger): string {
  return `${pad(trigger.hours ?? "0")}:${pad(trigger.minutes ?? "0")}`;
}

/** The trigger the service is sent for the answers. */
export function buildTrigger(answers: TriggerAnswers): Trigger {
  const trigger: Trigger = { type: answers.type, timeZone: answers.timeZone };
  const [hours, minutes] = (answers.time ?? "00:00").split(":");
  switch (answers.type) {
    case "DATELIST":
      trigger.dates = answers.dates ?? [];
      break;
    case "MINUTELY":
      break;
    case "HOURLY":
      trigger.minutes = String(answers.minute ?? 0);
      break;
    default:
      trigger.hours = String(Number(hours));
      trigger.minutes = String(Number(minutes));
  }
  if (answers.type === "DATELIST") {
    trigger.hours = String(Number(hours));
    trigger.minutes = String(Number(minutes));
    return trigger;
  }
  trigger.interval = answers.interval ?? 1;
  if (answers.type === "WEEKLY") {
    trigger.daysOfWeek = answers.daysOfWeek ?? [];
  }
  if (answers.type === "MONTHLY" || answers.type === "YEARLY") {
    if (answers.occurrence) {
      trigger.occurrence = answers.occurrence;
      trigger.daysOfWeek = answers.daysOfWeek?.slice(0, 1) ?? [];
    } else {
      trigger.dayOfMonth = answers.dayOfMonth ?? 1;
    }
  }
  if (answers.type === "YEARLY") {
    trigger.monthOfYear = answers.monthOfYear ?? "JANUARY";
  }
  if (answers.start) {
    trigger.start = answers.start;
  }
  if (answers.end) {
    trigger.end = answers.end;
  }
  if (answers.numOccurrences && answers.numOccurrences > 0) {
    trigger.numOccurrences = answers.numOccurrences;
  }
  return trigger;
}

/** The answers that rebuild a trigger, to edit a schedule. */
export function answersFromTrigger(
  trigger: Trigger,
  defaultTimeZone: string,
): TriggerAnswers {
  const month = MONTHS.find((m) => m === trigger.monthOfYear);
  return {
    type: trigger.type,
    dates: trigger.dates,
    time: triggerTime(trigger),
    minute: Number(trigger.minutes ?? 0),
    interval: trigger.interval,
    daysOfWeek: trigger.daysOfWeek,
    dayOfMonth: trigger.dayOfMonth,
    occurrence: trigger.occurrence,
    monthOfYear: month,
    start: dateOnly(trigger.start ?? trigger.startDate),
    end: dateOnly(trigger.end),
    numOccurrences:
      trigger.numOccurrences && trigger.numOccurrences > 0
        ? trigger.numOccurrences
        : undefined,
    timeZone: trigger.timeZone || defaultTimeZone,
  };
}

const dateOnly = (value: string | undefined) =>
  value?.slice(0, 10) || undefined;

/** Texts of trigger descriptions; {placeholders} are filled in. */
export interface TriggerLabels {
  once: string;
  dates: string;
  everyMinute: string;
  everyMinutes: string;
  hourly: string;
  everyHours: string;
  daily: string;
  everyDays: string;
  weekly: string;
  everyWeeks: string;
  monthlyDay: string;
  everyMonthsDay: string;
  monthlyOccurrence: string;
  everyMonthsOccurrence: string;
  yearlyDay: string;
  yearlyOccurrence: string;
  from: string;
  until: string;
  times: string;
  days: Record<DayOfWeek, string>;
  occurrences: Record<Occurrence, string>;
  months: Record<Month, string>;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );

/** A trigger in words: "Every 2 weeks on Mon, Thu at 03:00 (Europe/Berlin)". */
export function describeTrigger(
  trigger: Trigger | undefined,
  labels: TriggerLabels,
): string {
  if (!trigger) {
    return "";
  }
  const n = trigger.interval ?? 1;
  const time = triggerTime(trigger);
  const days = (trigger.daysOfWeek ?? []).map((d) => labels.days[d] ?? d);
  const weekday = days[0] ?? "";
  const occurrence = trigger.occurrence
    ? (labels.occurrences[trigger.occurrence] ?? trigger.occurrence)
    : "";
  const knownMonth = MONTHS.find((m) => m === trigger.monthOfYear);
  const month = knownMonth
    ? labels.months[knownMonth]
    : (trigger.monthOfYear ?? "");
  const values = {
    n,
    time,
    date: trigger.dates?.[0] ?? "",
    dates: (trigger.dates ?? []).join(", "),
    minute: pad(trigger.minutes ?? "0"),
    days: days.join(", "),
    day: trigger.dayOfMonth ?? 1,
    weekday,
    occurrence,
    month,
  };
  let text: string;
  switch (trigger.type) {
    case "DATELIST":
      text = fill(
        (trigger.dates?.length ?? 0) > 1 ? labels.dates : labels.once,
        values,
      );
      break;
    case "MINUTELY":
      text = fill(n > 1 ? labels.everyMinutes : labels.everyMinute, values);
      break;
    case "HOURLY":
      text = fill(n > 1 ? labels.everyHours : labels.hourly, values);
      break;
    case "DAILY":
      text = fill(n > 1 ? labels.everyDays : labels.daily, values);
      break;
    case "WEEKLY":
      text = fill(n > 1 ? labels.everyWeeks : labels.weekly, values);
      break;
    case "MONTHLY":
      text = trigger.occurrence
        ? fill(
            n > 1 ? labels.everyMonthsOccurrence : labels.monthlyOccurrence,
            values,
          )
        : fill(n > 1 ? labels.everyMonthsDay : labels.monthlyDay, values);
      break;
    case "YEARLY":
      text = fill(
        trigger.occurrence ? labels.yearlyOccurrence : labels.yearlyDay,
        values,
      );
      break;
    default:
      text = String(trigger.type);
  }
  const parts = [text];
  if (trigger.type !== "DATELIST") {
    const start = dateOnly(trigger.start ?? trigger.startDate);
    if (start) {
      parts.push(fill(labels.from, { date: start }));
    }
    if (trigger.end) {
      parts.push(fill(labels.until, { date: dateOnly(trigger.end) ?? "" }));
    } else if (trigger.numOccurrences && trigger.numOccurrences > 0) {
      parts.push(fill(labels.times, { n: trigger.numOccurrences }));
    }
  }
  const sentence = parts.join(", ");
  return trigger.timeZone ? `${sentence} (${trigger.timeZone})` : sentence;
}

/** HH:MM, 24-hour. */
export const isTime = (text: string): boolean =>
  /^([01]?\d|2[0-3]):[0-5]\d$/.test(text.trim());

/** A valid YYYY-MM-DD date. */
export function isDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) {
    return false;
  }
  const date = new Date(`${match[0]}T00:00:00Z`);
  return date.getUTCDate() === Number(match[3]);
}

/** "2027-06-01, 2027-07-01" → the dates, or undefined if one is not a date. */
export function parseDateList(text: string): string[] | undefined {
  const dates = text
    .split(/[\s,;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
  return dates.length && dates.every(isDate) ? dates : undefined;
}

/** A whole number from `min` to `max`, or undefined. */
export function parseWhole(
  text: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (!/^\d+$/.test(text.trim())) {
    return undefined;
  }
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

/** The job a schedule runs, as a resource to open or run. */
export function scheduleJob(schedule: Schedule): JobResource | undefined {
  const job = schedule.jobInfo?.job;
  if (!job?.path) {
    return undefined;
  }
  return resourceFromPath(job.path, job.resourceLocation ?? "WORKSPACE", {
    ...(job.id ? { id: job.id } : {}),
  });
}

/** The parameter values a schedule passes, as a run sends them. */
export function scheduleValues(schedule: Schedule): ParameterValue[] {
  return (schedule.jobInfo?.parameterValues ?? []).map(
    ({ name, type, value }) => ({ name, type, value }),
  );
}

/**
 * Whether a schedule is the user's: it runs as its owner. The service lists
 * other users' schedules too, although its documentation says it lists the
 * current user's. Without a known user, every schedule counts as the user's.
 */
export function isOwnSchedule(
  schedule: Schedule,
  userId: string | undefined,
): boolean {
  const owner = schedule.runAs ?? schedule.createdBy;
  return !userId || !owner || owner === userId;
}

/** Context value of a schedule in the view: status, job and owner. */
export function scheduleContextValue(schedule: Schedule, own = true): string {
  return `;schedule;${schedule.status === "DISABLED" ? "disabled" : "enabled"};${
    schedule.jobAvailable === false ? "jobMissing" : "jobOk"
  };${own ? "mine" : "others"};`;
}

/** Today in a time zone, as YYYY-MM-DD (en-CA formats dates that way). */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
