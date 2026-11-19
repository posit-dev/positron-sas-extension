// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The prompts for a new schedule: its name, how often it runs, and when. The
// times are in the local time zone, which the schedule records. Only the
// steps the Scheduler accepts are offered (see schedules.ts).
import { QuickPickItem, l10n, window } from "vscode";

import { BackgroundJobMessages, DayNames } from "./messages";
import {
  HOUR_STEPS,
  LAST_DAY,
  MINUTE_STEPS,
  ScheduleAnswers,
  ScheduleKind,
  WEEKDAYS,
  Weekday,
  isDate,
  isTime,
  parseDates,
  todayIn,
} from "./schedules";

/** The local time zone, which new schedules use. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

class Cancelled extends Error {}

/**
 * Ask how a SAS job should be scheduled. Undefined when the user cancels.
 */
export async function promptSchedule(
  jobName: string,
): Promise<{ name: string; answers: ScheduleAnswers } | undefined> {
  const title = l10n.t(BackgroundJobMessages.ScheduleTitle, { name: jobName });
  const timeZone = localTimeZone();
  const today = todayIn(timeZone);

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
  const pick = async <T extends QuickPickItem>(
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
  const time = (value = "02:00") =>
    text(
      l10n.t(BackgroundJobMessages.ScheduleTime, { zone: timeZone }),
      value,
      (v) => (isTime(v) ? undefined : BackgroundJobMessages.InvalidTime),
    );

  try {
    const name = await text(BackgroundJobMessages.ScheduleName, jobName, (v) =>
      v.trim() ? undefined : BackgroundJobMessages.SaveNameEmpty,
    );
    // QuickPickItem has its own `kind` (separators), so this is `choice`.
    const kinds: (QuickPickItem & { choice: ScheduleKind })[] = [
      { label: BackgroundJobMessages.KindDaily, choice: "daily" },
      { label: BackgroundJobMessages.KindWorkdays, choice: "workdays" },
      { label: BackgroundJobMessages.KindWeekly, choice: "weekly" },
      { label: BackgroundJobMessages.KindMonthly, choice: "monthly" },
      { label: BackgroundJobMessages.KindHours, choice: "hours" },
      { label: BackgroundJobMessages.KindMinutes, choice: "minutes" },
      { label: BackgroundJobMessages.KindOnce, choice: "once" },
      { label: BackgroundJobMessages.KindDates, choice: "dates" },
    ];
    const { choice: kind } = await pick(
      l10n.t(BackgroundJobMessages.ScheduleKind, { name: jobName }),
      kinds,
    );
    const answers: ScheduleAnswers = { kind, startDate: today, timeZone };

    switch (kind) {
      case "once":
        answers.dates = [
          await text(BackgroundJobMessages.ScheduleDate, today, (v) =>
            isDate(v) ? undefined : BackgroundJobMessages.InvalidDate,
          ),
        ];
        answers.time = await time();
        break;
      case "dates":
        answers.dates = parseDates(
          await text(BackgroundJobMessages.ScheduleDates, today, (v) =>
            parseDates(v) ? undefined : BackgroundJobMessages.InvalidDates,
          ),
        );
        answers.time = await time();
        break;
      case "minutes":
        answers.every = (
          await pick(
            BackgroundJobMessages.ScheduleEveryMinutes,
            MINUTE_STEPS.filter((n) => n >= 5).map((n) => ({
              label: l10n.t(BackgroundJobMessages.EveryMinutesItem, { n }),
              n,
            })),
          )
        ).n;
        break;
      case "hours": {
        answers.every = (
          await pick(
            BackgroundJobMessages.ScheduleEveryHours,
            HOUR_STEPS.map((n) => ({
              label: l10n.t(BackgroundJobMessages.EveryHoursItem, { n }),
              n,
            })),
          )
        ).n;
        const minute = await text(
          BackgroundJobMessages.ScheduleMinute,
          "0",
          (v) =>
            /^\d{1,2}$/.test(v.trim()) && Number(v) <= 59
              ? undefined
              : BackgroundJobMessages.InvalidMinute,
        );
        answers.minute = Number(minute);
        break;
      }
      case "daily":
      case "workdays":
        answers.time = await time();
        break;
      case "weekly": {
        const days = await window.showQuickPick(
          WEEKDAYS.map((day) => ({
            label: DayNames[day],
            day,
            picked: day === "monday",
          })),
          {
            title,
            placeHolder: BackgroundJobMessages.ScheduleDays,
            canPickMany: true,
            ignoreFocusOut: true,
          },
        );
        if (!days) {
          throw new Cancelled();
        }
        if (!days.length) {
          window.showWarningMessage(BackgroundJobMessages.PickDays);
          throw new Cancelled();
        }
        answers.days = days.map((d): Weekday => d.day);
        answers.time = await time();
        break;
      }
      case "monthly": {
        const items = [
          ...Array.from({ length: 31 }, (_, i) => ({
            label: l10n.t(BackgroundJobMessages.DayOfMonth, { day: i + 1 }),
            day: i + 1,
          })),
          { label: BackgroundJobMessages.LastDayOfMonth, day: LAST_DAY },
        ];
        answers.dayOfMonth = (
          await pick(BackgroundJobMessages.ScheduleDayOfMonth, items)
        ).day;
        answers.time = await time();
        break;
      }
    }
    return { name: name.trim(), answers };
  } catch (error) {
    if (error instanceof Cancelled) {
      return undefined;
    }
    throw error;
  }
}
