// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import {
  type JobsConnection,
  JobsModel,
} from "../../src/clinical/jobs/JobsModel";
import {
  TriggerAnswers,
  TriggerLabels,
  answersFromTrigger,
  buildTrigger,
  describeTrigger,
  isDate,
  isOwnSchedule,
  isTime,
  parseDateList,
  parseWhole,
  scheduleContextValue,
  scheduleJob,
  scheduleValues,
  todayIn,
} from "../../src/clinical/jobs/schedules";
import type { Schedule, Trigger } from "../../src/clinical/jobs/types";

// From the repository root: this file also runs compiled from client/out.
const fixtures = (() => {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return path.join(dir, "client/test/positron/fixtures/clinicalJobs");
})();
const json = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));

const labels: TriggerLabels = {
  once: "Once on {date} at {time}",
  dates: "On {dates} at {time}",
  everyMinute: "Every minute",
  everyMinutes: "Every {n} minutes",
  hourly: "Hourly at minute {minute}",
  everyHours: "Every {n} hours at minute {minute}",
  daily: "Daily at {time}",
  everyDays: "Every {n} days at {time}",
  weekly: "Weekly on {days} at {time}",
  everyWeeks: "Every {n} weeks on {days} at {time}",
  monthlyDay: "Monthly on day {day} at {time}",
  everyMonthsDay: "Every {n} months on day {day} at {time}",
  monthlyOccurrence: "Monthly on the {occurrence} {weekday} at {time}",
  everyMonthsOccurrence:
    "Every {n} months on the {occurrence} {weekday} at {time}",
  yearlyDay: "Yearly on {month} {day} at {time}",
  yearlyOccurrence: "Yearly on the {occurrence} {weekday} of {month} at {time}",
  from: "from {date}",
  until: "until {date}",
  times: "{n} times",
  days: {
    MON: "Mon",
    TUE: "Tue",
    WED: "Wed",
    THU: "Thu",
    FRI: "Fri",
    SAT: "Sat",
    SUN: "Sun",
  },
  occurrences: {
    FIRST: "first",
    SECOND: "second",
    THIRD: "third",
    FOURTH: "fourth",
    LAST: "last",
  },
  months: {
    JANUARY: "January",
    FEBRUARY: "February",
    MARCH: "March",
    APRIL: "April",
    MAY: "May",
    JUNE: "June",
    JULY: "July",
    AUGUST: "August",
    SEPTEMBER: "September",
    OCTOBER: "October",
    NOVEMBER: "November",
    DECEMBER: "December",
  },
};

describe("describeTrigger", () => {
  it("describes the schedule the server returned", () => {
    const schedule = json<Schedule>("schedule.json");
    expect(describeTrigger(schedule.trigger, labels)).to.equal(
      "Once on 2027-06-01 at 03:00 (Europe/Berlin)",
    );
  });

  it("describes every trigger type", () => {
    const d = (t: Partial<Trigger> & Pick<Trigger, "type">) =>
      describeTrigger(t, labels);
    expect(
      d({
        type: "DATELIST",
        dates: ["2027-01-01", "2027-02-01"],
        hours: "6",
        minutes: "30",
      }),
    ).to.equal("On 2027-01-01, 2027-02-01 at 06:30");
    expect(d({ type: "MINUTELY", interval: 1 })).to.equal("Every minute");
    expect(d({ type: "MINUTELY", interval: 15 })).to.equal("Every 15 minutes");
    expect(d({ type: "HOURLY", interval: 1, minutes: "5" })).to.equal(
      "Hourly at minute 05",
    );
    expect(d({ type: "HOURLY", interval: 4, minutes: "0" })).to.equal(
      "Every 4 hours at minute 00",
    );
    expect(
      d({ type: "DAILY", interval: 1, hours: "2", minutes: "0" }),
    ).to.equal("Daily at 02:00");
    expect(
      d({ type: "DAILY", interval: 3, hours: "23", minutes: "45" }),
    ).to.equal("Every 3 days at 23:45");
    expect(
      d({
        type: "WEEKLY",
        interval: 1,
        daysOfWeek: ["MON", "THU"],
        hours: "3",
        minutes: "0",
      }),
    ).to.equal("Weekly on Mon, Thu at 03:00");
    expect(
      d({
        type: "WEEKLY",
        interval: 2,
        daysOfWeek: ["FRI"],
        hours: "3",
        minutes: "0",
      }),
    ).to.equal("Every 2 weeks on Fri at 03:00");
    expect(
      d({
        type: "MONTHLY",
        interval: 1,
        dayOfMonth: 15,
        hours: "1",
        minutes: "0",
      }),
    ).to.equal("Monthly on day 15 at 01:00");
    expect(
      d({
        type: "MONTHLY",
        interval: 3,
        occurrence: "FIRST",
        daysOfWeek: ["MON"],
        hours: "1",
        minutes: "0",
      }),
    ).to.equal("Every 3 months on the first Mon at 01:00");
    expect(
      d({
        type: "YEARLY",
        monthOfYear: "JUNE",
        dayOfMonth: 30,
        hours: "0",
        minutes: "0",
      }),
    ).to.equal("Yearly on June 30 at 00:00");
    expect(
      d({
        type: "YEARLY",
        monthOfYear: "DECEMBER",
        occurrence: "LAST",
        daysOfWeek: ["FRI"],
        hours: "0",
        minutes: "0",
      }),
    ).to.equal("Yearly on the last Fri of December at 00:00");
  });

  it("adds the start, the end or the number of runs, and the time zone", () => {
    const base: Trigger = {
      type: "DAILY",
      hours: "2",
      minutes: "0",
      timeZone: "UTC",
    };
    expect(
      describeTrigger(
        { ...base, start: "2027-01-01", end: "2027-12-31" },
        labels,
      ),
    ).to.equal("Daily at 02:00, from 2027-01-01, until 2027-12-31 (UTC)");
    expect(describeTrigger({ ...base, numOccurrences: 5 }, labels)).to.equal(
      "Daily at 02:00, 5 times (UTC)",
    );
    // -1 is the server's "no limit".
    expect(describeTrigger({ ...base, numOccurrences: -1 }, labels)).to.equal(
      "Daily at 02:00 (UTC)",
    );
    // The spec's example uses startDate as a date-time.
    expect(
      describeTrigger(
        { ...base, startDate: "2024-11-21T16:16:16.894000Z" },
        labels,
      ),
    ).to.equal("Daily at 02:00, from 2024-11-21 (UTC)");
    expect(describeTrigger(undefined, labels)).to.equal("");
  });
});

describe("buildTrigger", () => {
  it("builds the trigger the server accepted for a one-time run", () => {
    const sent = json<{ trigger: Trigger }>("schedule-request.json").trigger;
    expect(
      buildTrigger({
        type: "DATELIST",
        dates: ["2027-06-01"],
        time: "03:00",
        timeZone: "Europe/Berlin",
      }),
    ).to.deep.equal(sent);
  });

  it("builds every type and reads it back", () => {
    const cases: TriggerAnswers[] = [
      { type: "MINUTELY", interval: 10, start: "2027-01-01", timeZone: "UTC" },
      {
        type: "HOURLY",
        interval: 2,
        minute: 15,
        start: "2027-01-01",
        timeZone: "UTC",
      },
      {
        type: "DAILY",
        interval: 1,
        time: "02:30",
        start: "2027-01-01",
        end: "2027-03-01",
        timeZone: "UTC",
      },
      {
        type: "WEEKLY",
        interval: 1,
        daysOfWeek: ["MON", "WED"],
        time: "06:00",
        start: "2027-01-01",
        numOccurrences: 10,
        timeZone: "UTC",
      },
      {
        type: "MONTHLY",
        interval: 1,
        dayOfMonth: 15,
        time: "01:00",
        start: "2027-01-01",
        timeZone: "UTC",
      },
      {
        type: "MONTHLY",
        interval: 2,
        occurrence: "LAST",
        daysOfWeek: ["FRI"],
        time: "01:00",
        start: "2027-01-01",
        timeZone: "UTC",
      },
      {
        type: "YEARLY",
        interval: 1,
        monthOfYear: "MARCH",
        dayOfMonth: 1,
        time: "00:00",
        start: "2027-01-01",
        timeZone: "UTC",
      },
    ];
    for (const answers of cases) {
      const trigger = buildTrigger(answers);
      const back = answersFromTrigger(trigger, "UTC");
      expect(buildTrigger(back), answers.type).to.deep.equal(trigger);
    }
    expect(buildTrigger(cases[1])).to.deep.equal({
      type: "HOURLY",
      timeZone: "UTC",
      minutes: "15",
      interval: 2,
      start: "2027-01-01",
    });
    expect(buildTrigger(cases[5])).to.include({
      occurrence: "LAST",
      interval: 2,
    });
    expect(buildTrigger(cases[5]).daysOfWeek).to.deep.equal(["FRI"]);
    expect(buildTrigger(cases[5])).to.not.have.property("dayOfMonth");
  });
});

describe("schedule prompts' checks", () => {
  it("checks times, dates, date lists and numbers", () => {
    expect(isTime("02:30")).to.equal(true);
    expect(isTime("2:05")).to.equal(true);
    expect(isTime("24:00")).to.equal(false);
    expect(isTime("12:60")).to.equal(false);
    expect(isDate("2028-02-29")).to.equal(true);
    expect(isDate("2027-02-29")).to.equal(false);
    expect(parseDateList("2027-01-01, 2027-02-01;2027-03-01")).to.deep.equal([
      "2027-01-01",
      "2027-02-01",
      "2027-03-01",
    ]);
    expect(parseDateList("2027-01-01, soon")).to.equal(undefined);
    expect(parseDateList(" ")).to.equal(undefined);
    expect(parseWhole("7", 1, 31)).to.equal(7);
    expect(parseWhole("0", 1, 31)).to.equal(undefined);
    expect(parseWhole("1.5", 1)).to.equal(undefined);
  });

  it("knows today in a time zone", () => {
    const now = new Date("2027-01-01T23:30:00Z");
    expect(todayIn("UTC", now)).to.equal("2027-01-01");
    expect(todayIn("Europe/Berlin", now)).to.equal("2027-01-02");
    expect(todayIn("Not/AZone", now)).to.equal("2027-01-01");
  });
});

describe("schedules in the view", () => {
  it("reads the job and values of a schedule", () => {
    const schedule = json<Schedule>("schedule.json");
    expect(scheduleJob(schedule)).to.deep.equal({
      name: "probe.cjob",
      path: "/probe-jobs/probe.cjob",
      location: "/probe-jobs",
      resourceLocation: "WORKSPACE",
    });
    // The server returns label "null" and a version; a run sends neither.
    expect(scheduleValues(schedule)).to.deep.equal([
      { name: "probe_char", type: "CHARACTER", value: "from-schedule" },
    ]);
    expect(scheduleContextValue(schedule)).to.equal(
      ";schedule;enabled;jobOk;mine;",
    );
    expect(
      scheduleContextValue(
        { ...schedule, status: "DISABLED", jobAvailable: false },
        false,
      ),
    ).to.equal(";schedule;disabled;jobMissing;others;");
    expect(scheduleJob({ id: "x", name: "x" })).to.equal(undefined);
  });
});

describe("schedule owners", () => {
  const schedule = json<Schedule>("schedule.json");

  it("tells the user's schedules from other users'", () => {
    // runAs is the owner; the fixture's is test1.
    expect(isOwnSchedule(schedule, "test1")).to.equal(true);
    expect(isOwnSchedule(schedule, "demouser")).to.equal(false);
    expect(
      isOwnSchedule(
        { ...schedule, runAs: undefined, createdBy: "demouser" },
        "demouser",
      ),
    ).to.equal(true);
    // Without a known user or owner, nothing is hidden.
    expect(isOwnSchedule(schedule, undefined)).to.equal(true);
    expect(isOwnSchedule({ id: "x", name: "x" }, "demouser")).to.equal(true);
  });

  it("offers only Copy Schedule ID on other users' schedules", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(fixtures, "../../../../../package.json"),
        "utf8",
      ),
    );
    const menus: { command: string; when: string }[] = pkg.contributes.menus[
      "view/item/context"
    ].filter((m: { when?: string }) =>
      (m.when ?? "").includes("view == clinicaljobschedulesprovider"),
    );
    const shown = (contextValue: string) =>
      menus
        .filter((m) =>
          m.when
            .split(" && ")
            .slice(1)
            .every((clause) => {
              const re = /^viewItem =~ \/(.+)\/$/.exec(clause);
              return re ? new RegExp(re[1]).test(contextValue) : false;
            }),
        )
        .map((m) => m.command);
    const others = new Set(shown(scheduleContextValue(schedule, false)));
    expect([...others]).to.deep.equal(["SAS.clinical.schedule.copyId"]);
    const mine = new Set(shown(scheduleContextValue(schedule, true)));
    expect([...mine]).to.have.members([
      "SAS.clinical.schedule.runNow",
      "SAS.clinical.schedule.disable",
      "SAS.clinical.schedule.edit",
      "SAS.clinical.schedule.delete",
      "SAS.clinical.schedule.copyId",
    ]);
  });
});

describe("JobsModel schedules", () => {
  const calls: { method: string; url: string; data?: unknown }[] = [];
  const respond = (method: string, url: string, data?: unknown) => {
    calls.push({ method, url, data });
    const body = url.endsWith("/future?limit=1")
      ? json("schedule-future.json")
      : method === "GET" && url.includes("?limit=1000")
        ? json("schedules.json")
        : json("schedule.json");
    return Promise.resolve({ data: JSON.parse(JSON.stringify(body)) });
  };
  const connection: JobsConnection = {
    get: (url) => respond("GET", url),
    post: (url, data) => respond("POST", url, data),
    put: (url, data) => respond("PUT", url, data),
    patch: (url, data) => respond("PATCH", url, data),
    delete: (url) => respond("DELETE", url),
  };
  const model = new JobsModel(
    {
      getConnection: async () => connection,
      getCurrentUserId: async () => "test1",
    },
    { getContent: async () => new Uint8Array() },
  );

  it("creates, reads, changes, switches and deletes schedules", async () => {
    const definition = json<{ name: string; jobInfo: never; trigger: Trigger }>(
      "schedule-request.json",
    );
    const created = await model.createSchedule(definition);
    expect(created.id).to.equal("b2eb0038-860f-48eb-ac5e-5f22c398835b");
    await model.getSchedule(created.id);
    await model.updateSchedule(created.id, definition);
    await model.setScheduleStatus(created.id, "DISABLED");
    await model.setScheduleStatus(created.id, "ENABLED");
    expect(await model.getFutureRuns(created.id, 1)).to.deep.equal([
      "2027-06-01T01:00:00.000Z",
    ]);
    await model.deleteSchedule(created.id);
    expect((await model.listSchedules()).map((s) => s.name)).to.deep.equal([
      "positron-probe-schedule",
    ]);
    const id = created.id;
    expect(calls.map((c) => `${c.method} ${c.url}`)).to.deep.equal([
      "POST /clinicalJobs/schedules",
      `GET /clinicalJobs/schedules/${id}`,
      `PATCH /clinicalJobs/schedules/${id}`,
      // Uppercase: the server refuses "disabled".
      `PUT /clinicalJobs/schedules/${id}/state?value=DISABLED`,
      `PUT /clinicalJobs/schedules/${id}/state?value=ENABLED`,
      `GET /clinicalJobs/schedules/${id}/future?limit=1`,
      `DELETE /clinicalJobs/schedules/${id}`,
      "GET /clinicalJobs/schedules?limit=1000",
    ]);
    expect(calls[0].data).to.equal(definition);
  });
});
