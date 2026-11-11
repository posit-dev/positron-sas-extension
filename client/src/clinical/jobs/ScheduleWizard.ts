// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The prompts of New Schedule and Edit Schedule: a name, when the job runs
// (every trigger type the service has), the time zone and the job's
// parameter values. Editing starts from the schedule's current values.
import { QuickPickItem, l10n, window } from "vscode";

import type { ItemPicker } from "./ItemPicker";
import { JobMessages, TriggerLabelText } from "./messages";
import { promptParameterValues } from "./parameters";
import {
  DAYS_OF_WEEK,
  MONTHS,
  OCCURRENCES,
  TriggerAnswers,
  answersFromTrigger,
  buildTrigger,
  isDate,
  isTime,
  parseDateList,
  parseWhole,
  scheduleValues,
  todayIn,
} from "./schedules";
import type {
  ClinicalJob,
  DayOfWeek,
  JobResource,
  Schedule,
  ScheduleDefinition,
  TriggerType,
} from "./types";
import { toRunInfo } from "./utils";

/** The kinds offered; "ONCE" is a date list with one date. */
type Kind = TriggerType | "ONCE";

interface KindItem extends QuickPickItem {
  choice: Kind;
}

/** The local time zone, the default of new schedules. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name.trim() });
    return !!name.trim();
  } catch {
    return false;
  }
}

/** Raised when the user cancels a prompt. */
class Cancelled extends Error {}

export async function promptSchedule(
  job: JobResource,
  definition: ClinicalJob,
  picker: ItemPicker,
  existing?: Schedule,
): Promise<ScheduleDefinition | undefined> {
  const title = l10n.t(JobMessages.WizardTitle, { job: job.name });
  const prior: TriggerAnswers = existing?.trigger
    ? answersFromTrigger(existing.trigger, localTimeZone())
    : { type: "DAILY", time: "02:00", timeZone: localTimeZone() };

  const text = async (
    prompt: string,
    value: string,
    validate: (v: string) => string | undefined = () => undefined,
  ): Promise<string> => {
    const answer = await window.showInputBox({
      title,
      prompt,
      value,
      ignoreFocusOut: true,
      validateInput: validate,
    });
    if (answer === undefined) {
      throw new Cancelled();
    }
    return answer.trim();
  };
  const whole = async (
    prompt: string,
    value: number | undefined,
    min: number,
    max: number,
  ): Promise<number> => {
    const answer = await text(prompt, String(value ?? min), (v) =>
      parseWhole(v, min, max) === undefined
        ? l10n.t(JobMessages.WizardInvalidNumber, { min, max })
        : undefined,
    );
    return parseWhole(answer, min, max) ?? min;
  };
  const choose = async <T extends QuickPickItem>(
    placeHolder: string,
    items: T[],
  ): Promise<T> => {
    const answer = await window.showQuickPick(items, {
      title,
      placeHolder,
      ignoreFocusOut: true,
    });
    if (!answer) {
      throw new Cancelled();
    }
    return answer;
  };
  const date = (prompt: string, value: string | undefined) =>
    text(prompt, value ?? todayIn(prior.timeZone), (v) =>
      isDate(v) ? undefined : JobMessages.WizardInvalidDate,
    );
  const time = () =>
    text(JobMessages.WizardTime, prior.time ?? "02:00", (v) =>
      isTime(v) ? undefined : JobMessages.WizardInvalidTime,
    );
  const weekday = async (): Promise<DayOfWeek> =>
    (
      await choose(
        JobMessages.WizardWeekday,
        DAYS_OF_WEEK.map((day) => ({
          label: TriggerLabelText.days[day],
          day,
          picked: prior.daysOfWeek?.[0] === day,
        })),
      )
    ).day;

  try {
    const name = await text(
      JobMessages.WizardName,
      existing?.name ?? job.name.replace(/\.cjob$/i, ""),
      (v) => (v.trim() ? undefined : JobMessages.WizardName),
    );

    const priorKind: Kind =
      prior.type === "DATELIST" && (prior.dates?.length ?? 0) <= 1
        ? "ONCE"
        : prior.type;
    const kinds: KindItem[] = [
      { label: JobMessages.KindOnce, choice: "ONCE" },
      { label: JobMessages.KindDates, choice: "DATELIST" },
      { label: JobMessages.KindMinutely, choice: "MINUTELY" },
      { label: JobMessages.KindHourly, choice: "HOURLY" },
      { label: JobMessages.KindDaily, choice: "DAILY" },
      { label: JobMessages.KindWeekly, choice: "WEEKLY" },
      { label: JobMessages.KindMonthly, choice: "MONTHLY" },
      { label: JobMessages.KindYearly, choice: "YEARLY" },
    ];
    // The current kind first, so Enter keeps it.
    kinds.sort(
      (a, b) => Number(b.choice === priorKind) - Number(a.choice === priorKind),
    );
    const kind = (await choose(JobMessages.WizardKind, kinds)).choice;

    const answers: TriggerAnswers = {
      type: kind === "ONCE" ? "DATELIST" : kind,
      timeZone: prior.timeZone,
    };
    const sameKind = kind === priorKind;
    const interval = (prompt: string, max: number) =>
      whole(prompt, sameKind ? prior.interval : 1, 1, max);

    switch (kind) {
      case "ONCE":
        answers.dates = [await date(JobMessages.WizardDate, prior.dates?.[0])];
        answers.time = await time();
        break;
      case "DATELIST": {
        const list = await text(
          JobMessages.WizardDates,
          (prior.dates ?? [todayIn(prior.timeZone)]).join(", "),
          (v) =>
            parseDateList(v) ? undefined : JobMessages.WizardInvalidDates,
        );
        answers.dates = parseDateList(list);
        answers.time = await time();
        break;
      }
      case "MINUTELY":
        answers.interval = await interval(
          JobMessages.WizardIntervalMinutes,
          1440,
        );
        break;
      case "HOURLY":
        answers.interval = await interval(JobMessages.WizardIntervalHours, 168);
        answers.minute = await whole(
          JobMessages.WizardMinute,
          prior.minute,
          0,
          59,
        );
        break;
      case "DAILY":
        answers.interval = await interval(JobMessages.WizardIntervalDays, 366);
        answers.time = await time();
        break;
      case "WEEKLY": {
        const picked = await window.showQuickPick(
          DAYS_OF_WEEK.map((day) => ({
            label: TriggerLabelText.days[day],
            day,
            picked: sameKind
              ? !!prior.daysOfWeek?.includes(day)
              : !["SAT", "SUN"].includes(day),
          })),
          {
            title,
            placeHolder: JobMessages.WizardDays,
            canPickMany: true,
            ignoreFocusOut: true,
          },
        );
        if (!picked) {
          throw new Cancelled();
        }
        if (!picked.length) {
          window.showWarningMessage(JobMessages.WizardNoDays);
          throw new Cancelled();
        }
        answers.daysOfWeek = picked.map((p) => p.day);
        answers.interval = await interval(JobMessages.WizardIntervalWeeks, 52);
        answers.time = await time();
        break;
      }
      case "MONTHLY":
      case "YEARLY": {
        if (kind === "YEARLY") {
          answers.monthOfYear = (
            await choose(
              JobMessages.WizardMonth,
              MONTHS.map((month) => ({
                label: TriggerLabelText.months[month],
                month,
                picked: prior.monthOfYear === month,
              })),
            )
          ).month;
        } else {
          answers.interval = await interval(
            JobMessages.WizardIntervalMonths,
            120,
          );
        }
        const byWeekday = (
          await choose(JobMessages.WizardDayMode, [
            { label: JobMessages.WizardOnDay, weekday: false },
            { label: JobMessages.WizardNthWeekday, weekday: true },
          ])
        ).weekday;
        if (byWeekday) {
          answers.occurrence = (
            await choose(
              JobMessages.WizardOccurrence,
              OCCURRENCES.map((occurrence) => ({
                label: TriggerLabelText.occurrences[occurrence],
                occurrence,
              })),
            )
          ).occurrence;
          answers.daysOfWeek = [await weekday()];
        } else {
          answers.dayOfMonth = await whole(
            JobMessages.WizardDayOfMonth,
            prior.dayOfMonth,
            1,
            31,
          );
        }
        answers.time = await time();
        break;
      }
    }

    if (answers.type !== "DATELIST") {
      answers.start = await date(JobMessages.WizardStart, prior.start);
      const end = (
        await choose(JobMessages.WizardEnd, [
          { label: JobMessages.WizardEndNever, end: "never" as const },
          { label: JobMessages.WizardEndDate, end: "date" as const },
          { label: JobMessages.WizardEndCount, end: "count" as const },
        ])
      ).end;
      if (end === "date") {
        answers.end = await date(JobMessages.WizardEndDateValue, prior.end);
      } else if (end === "count") {
        answers.numOccurrences = await whole(
          JobMessages.WizardEndCountValue,
          prior.numOccurrences,
          1,
          100000,
        );
      }
    }

    answers.timeZone = await text(
      JobMessages.WizardTimeZone,
      prior.timeZone,
      (v) => (isTimeZone(v) ? undefined : JobMessages.WizardInvalidTimeZone),
    );

    const values = await promptParameterValues(
      definition,
      job,
      picker,
      existing ? scheduleValues(existing) : [],
    );
    if (values === undefined) {
      return undefined;
    }
    return {
      name,
      ...(existing?.description ? { description: existing.description } : {}),
      jobInfo: toRunInfo(job, values),
      trigger: buildTrigger(answers),
    };
  } catch (error) {
    if (error instanceof Cancelled) {
      return undefined;
    }
    throw error;
  }
}
