// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Schedules for SAS jobs (#150, phase 3): triggers, the schedule body, and
// the Scheduler and job request requests. The Scheduler has no published API
// spec; the trigger shapes asserted here are the ones a live SAS Viya server
// accepted and resolved to the expected fire times (2026-11-18), and the
// fixtures are its responses (host and user names replaced).
import type { AxiosRequestConfig } from "axios";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { PreconditionFailedError } from "../../src/backgroundJobs/JobsModel";
import {
  NeverFiresError,
  SchedulesModel,
} from "../../src/backgroundJobs/SchedulesModel";
import {
  LAST_DAY,
  ScheduleAnswers,
  SchedulerJob,
  TriggerWords,
  buildSchedule,
  buildTrigger,
  describeTrigger,
  fireTimesProblem,
  isDate,
  isEnabled,
  isTime,
  jobRequestIdOf,
  lastRun,
  parseDates,
  todayIn,
  withEnabled,
} from "../../src/backgroundJobs/schedules";
import type { RestConnection } from "../../src/viya/connection";

const FIXTURES = (() => {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return path.join(
    dir,
    "client",
    "test",
    "positron",
    "fixtures",
    "backgroundJobs",
  );
})();
// JSON.parse returns `any`, which stands in for each fixture's type.
const json = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

const base: Omit<ScheduleAnswers, "kind"> = {
  startDate: "2027-01-04",
  timeZone: "Europe/London",
};

describe("buildTrigger", () => {
  it("runs once on a date", () => {
    const t = buildTrigger(
      { ...base, kind: "once", dates: ["2026-11-18"], time: "18:03" },
      "once",
    );
    // The body the live Scheduler accepted and fired at 18:03.
    expect(t).to.deep.equal({
      type: "TIMEEVENT",
      name: "once",
      active: true,
      recurrence: {
        type: "dateList",
        startDate: "2026-11-18",
        dates: ["2026-11-18"],
      },
      hours: "18",
      minutes: "3",
      timezone: "Europe/London",
    });
  });

  it("sorts a date list and starts on its first date", () => {
    const t = buildTrigger(
      {
        ...base,
        kind: "dates",
        dates: ["2027-03-01", "2027-02-01"],
        time: "06:00",
      },
      "d",
    );
    expect(t.recurrence).to.deep.include({
      type: "dateList",
      startDate: "2027-02-01",
      dates: ["2027-02-01", "2027-03-01"],
    });
  });

  it("runs every n minutes from a single starting hour", () => {
    // Each listed hour starts its own series. Listing all 24 made an
    // every-5-minutes schedule fire 19 jobs at once by 18:40 on a live server.
    const t = buildTrigger({ ...base, kind: "minutes", every: 5 }, "m");
    expect(t.recurrence).to.deep.include({ type: "minutely", skipCount: 5 });
    expect(t.hours).to.equal("0");
    expect(t.minutes).to.equal("0");
  });

  it("runs every n hours at a minute", () => {
    const t = buildTrigger(
      { ...base, kind: "hours", every: 4, minute: 15 },
      "h",
    );
    expect(t.recurrence).to.deep.include({ type: "hourly", skipCount: 4 });
    expect([t.hours, t.minutes]).to.deep.equal(["0", "15"]);
  });

  it("runs daily, on weekdays, and weekly on chosen days", () => {
    expect(
      buildTrigger({ ...base, kind: "daily", time: "06:30" }, "d").recurrence,
    ).to.deep.include({ type: "daily", skipCount: 1 });
    expect(
      buildTrigger({ ...base, kind: "workdays", time: "06:30" }, "w")
        .recurrence,
    ).to.deep.include({
      type: "daily",
      daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    });
    const weekly = buildTrigger(
      {
        ...base,
        kind: "weekly",
        days: ["thursday", "monday", "thursday"],
        time: "06:30",
      },
      "w",
    );
    expect(weekly.recurrence).to.deep.include({
      type: "weekly",
      daysOfWeek: ["monday", "thursday"],
    });
    expect([weekly.hours, weekly.minutes]).to.deep.equal(["6", "30"]);
  });

  it("runs monthly on a day, or on the last day as 32", () => {
    expect(
      buildTrigger(
        { ...base, kind: "monthly", dayOfMonth: LAST_DAY, time: "23:00" },
        "m",
      ).recurrence,
    ).to.deep.include({ type: "monthly", dayOfMonth: 32 });
  });

  it("keeps an end date", () => {
    expect(
      buildTrigger(
        { ...base, kind: "daily", time: "06:00", endDate: "2027-01-11" },
        "e",
      ).recurrence,
    ).to.deep.include({ endDate: "2027-01-11" });
  });
});

describe("the schedule", () => {
  it("fires the job request with the submitter, in our group", () => {
    const trigger = buildTrigger(
      { ...base, kind: "daily", time: "02:00" },
      "nightly",
    );
    const schedule = buildSchedule({
      name: "adsl nightly",
      jobRequestId: "r1",
      trigger,
      language: "de-CH",
    });
    expect(schedule).to.deep.equal({
      name: "adsl nightly",
      group: "positron-sas",
      request: {
        // With ?submitter, its runs show in the Background Jobs view.
        uri: "/jobExecution/jobRequests/r1/jobs?submitter=positron-sas",
        method: "POST",
        headers: {
          Accept: ["application/vnd.sas.job.execution.job+json"],
          "Accept-Language": ["de-CH"],
        },
      },
      triggers: [trigger],
    });
    expect(jobRequestIdOf(schedule)).to.equal("r1");
  });

  it("reads a stored schedule", () => {
    const stored: SchedulerJob = json("schedule-created.json");
    expect(jobRequestIdOf(stored)).to.be.a("string").and.not.equal("");
    expect(isEnabled(stored)).to.equal(true);
    expect(stored.runAs, "the server sets who it runs as").to.be.a("string");
    // The server normalises dateList to lowercase.
    expect(stored.triggers[0].recurrence.type).to.equal("datelist");
  });

  it("switches every trigger on or off, keeping only what a PUT needs", () => {
    const stored: SchedulerJob = json("schedule-created.json");
    const off = withEnabled(stored, false);
    expect(isEnabled(off)).to.equal(false);
    expect(off).to.not.have.property("links");
    expect(off).to.not.have.property("creationTimeStamp");
    expect(off.request).to.deep.equal(stored.request);
  });
});

describe("describeTrigger", () => {
  const words: TriggerWords = {
    once: "Once on {date} at {time}",
    dates: "On {dates} at {time}",
    minutes: "Every {n} minutes",
    everyMinute: "Every minute",
    hours: "Every {n} hours at minute {minute}",
    everyHour: "Every hour at minute {minute}",
    daily: "Daily at {time}",
    everyDays: "Every {n} days at {time}",
    workdays: "Weekdays at {time}",
    weekly: "Weekly on {days} at {time}",
    monthly: "Monthly on day {day} at {time}",
    monthlyLast: "Monthly on the last day at {time}",
    other: "Custom schedule",
    days: {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    },
  };
  const say = (answers: Omit<ScheduleAnswers, "startDate" | "timeZone">) =>
    describeTrigger(buildTrigger({ ...base, ...answers }, "t"), words);

  it("says when each kind runs", () => {
    expect(say({ kind: "once", dates: ["2027-01-05"], time: "6:05" })).to.equal(
      "Once on 2027-01-05 at 06:05",
    );
    expect(say({ kind: "minutes", every: 15 })).to.equal("Every 15 minutes");
    expect(say({ kind: "minutes", every: 1 })).to.equal("Every minute");
    expect(say({ kind: "hours", every: 4, minute: 5 })).to.equal(
      "Every 4 hours at minute 05",
    );
    expect(say({ kind: "daily", time: "02:00" })).to.equal("Daily at 02:00");
    expect(say({ kind: "workdays", time: "06:30" })).to.equal(
      "Weekdays at 06:30",
    );
    expect(
      say({ kind: "weekly", days: ["monday", "thursday"], time: "06:30" }),
    ).to.equal("Weekly on Mon, Thu at 06:30");
    expect(say({ kind: "monthly", dayOfMonth: 15, time: "03:00" })).to.equal(
      "Monthly on day 15 at 03:00",
    );
    expect(
      say({ kind: "monthly", dayOfMonth: LAST_DAY, time: "23:00" }),
    ).to.equal("Monthly on the last day at 23:00");
  });

  it("describes the stored form, as the server returns it", () => {
    const stored: SchedulerJob = json("schedule-created.json");
    expect(describeTrigger(stored.triggers[0], words)).to.match(/^Once on /);
  });
});

describe("fireTimesProblem", () => {
  const every = (startIso: string, minutes: number[]) => {
    let at = Date.parse(startIso);
    const out = [new Date(at).toISOString()];
    for (const gap of minutes) {
      at += gap * 60_000;
      out.push(new Date(at).toISOString());
    }
    return out;
  };

  it("passes evenly spaced times", () => {
    expect(
      fireTimesProblem(every("2027-01-04T00:00:00Z", Array(9).fill(5)), {
        kind: "minutes",
        every: 5,
      }),
    ).to.equal(undefined);
    expect(
      fireTimesProblem(every("2027-01-04T00:15:00Z", Array(9).fill(240)), {
        kind: "hours",
        every: 4,
      }),
    ).to.equal(undefined);
  });

  it("catches the same time repeated, as the runaway schedule showed", () => {
    // Recorded: an every-5-minutes schedule listing all hours had fire times
    // 18:45, 18:45, 18:45, ... on the day it started.
    const repeated = Array(10).fill("2026-11-18T18:45:00.000Z");
    expect(fireTimesProblem(repeated, { kind: "minutes", every: 5 })).to.equal(
      "duplicate",
    );
  });

  it("catches uneven gaps, which hid the problem for a future start", () => {
    // Recorded: starting at a future midnight, the same trigger's times were
    // distinct but 5 and 15 minutes apart.
    expect(
      fireTimesProblem(every("2027-01-04T00:00:00Z", [5, 5, 15, 5]), {
        kind: "minutes",
        every: 5,
      }),
    ).to.equal("uneven");
  });

  it("lets weekly and monthly times be uneven, but not repeat", () => {
    const weekly = every("2027-01-04T06:30:00Z", [3 * 1440, 4 * 1440]);
    expect(fireTimesProblem(weekly, { kind: "weekly" })).to.equal(undefined);
    expect(
      fireTimesProblem([weekly[0], weekly[0]], { kind: "weekly" }),
    ).to.equal("duplicate");
    expect(fireTimesProblem([], { kind: "daily" })).to.equal(undefined);
  });
});

describe("schedule input helpers", () => {
  it("checks times and dates", () => {
    expect(isTime("06:30")).to.equal(true);
    expect(isTime("6:30")).to.equal(true);
    expect(isTime("24:00")).to.equal(false);
    expect(isTime("06:60")).to.equal(false);
    expect(isDate("2027-02-28")).to.equal(true);
    expect(isDate("2027-02-30")).to.equal(false);
    expect(isDate("27-02-28")).to.equal(false);
  });

  it("parses a list of dates", () => {
    expect(parseDates("2027-03-01, 2027-02-01 2027-03-01")).to.deep.equal([
      "2027-02-01",
      "2027-03-01",
    ]);
    expect(parseDates("2027-02-01, tomorrow")).to.equal(undefined);
    expect(parseDates("")).to.equal(undefined);
  });

  it("knows today's date in a time zone", () => {
    const late = new Date("2026-11-18T23:30:00Z");
    expect(todayIn("Europe/London", late)).to.equal("2026-11-18");
    expect(todayIn("Asia/Tokyo", late)).to.equal("2026-11-19");
  });

  it("reads the last firing from the history", () => {
    // Recorded: the firing that created a job.
    const recorded = lastRun(json("schedule-history.json").items);
    expect(recorded?.ok).to.equal(true);
    expect(recorded?.jobId).to.be.a("string");
    expect(
      lastRun([
        {
          jobFireTimeStamp: "2027-01-01T02:00:00Z",
          jobStatus: "SUCCESS",
          httpStatusCode: 201,
        },
        {
          jobFireTimeStamp: "2027-01-02T02:00:00Z",
          jobStatus: "FAILURE",
          httpStatusCode: 404,
        },
      ]),
    ).to.deep.include({ ok: false, status: 404, at: "2027-01-02T02:00:00Z" });
    expect(lastRun([])).to.equal(undefined);
  });
});

describe("SchedulesModel", () => {
  interface Call {
    method: string;
    url: string;
    data?: unknown;
    headers?: Record<string, string>;
  }
  const calls: Call[] = [];
  let answer: (
    method: string,
    url: string,
  ) => {
    status?: number;
    data?: unknown;
    headers?: Record<string, string>;
  } = () => ({});
  const respond = (
    method: string,
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(config?.headers ?? {})) {
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
    calls.push({ method, url, data, headers });
    const reply = answer(method, url);
    if ((reply.status ?? 200) >= 400) {
      return Promise.reject({
        response: { status: reply.status, data: reply.data },
      });
    }
    return Promise.resolve({
      data: JSON.parse(JSON.stringify(reply.data ?? {})),
      headers: reply.headers ?? {},
    });
  };
  const connection: RestConnection = {
    get: (url, config) => respond("GET", url, undefined, config),
    post: (url, data, config) => respond("POST", url, data, config),
    put: (url, data, config) => respond("PUT", url, data, config),
    patch: (url, data, config) => respond("PATCH", url, data, config),
    delete: (url, config) => respond("DELETE", url, undefined, config),
  };
  const model = new SchedulesModel(
    {
      getConnection: async () => connection,
      getCurrentUserId: async () => "user1",
    },
    "en-US",
  );

  beforeEach(() => {
    calls.length = 0;
  });

  it("stores a job request with the parameter values", async () => {
    answer = () => ({ data: { id: "r1" } });
    const id = await model.createJobRequest({
      name: "adsl",
      definitionUri: "/jobDefinitions/definitions/d1",
      arguments: { _contextName: "ctx", cutoff: "14" },
      expiresAfter: "P7D",
    });
    expect(id).to.equal("r1");
    expect(calls[0].url).to.equal("/jobExecution/jobRequests");
    expect(calls[0].headers?.["Content-Type"]).to.equal(
      "application/vnd.sas.job.execution.job.request+json",
    );
    expect(calls[0].data).to.deep.include({
      version: 3,
      jobDefinitionUri: "/jobDefinitions/definitions/d1",
      arguments: { _contextName: "ctx", cutoff: "14" },
      expiresAfter: "P7D",
    });
  });

  it("runs a job request now, as the schedule would", async () => {
    answer = () => ({ data: { id: "j1", state: "running" } });
    expect((await model.runJobRequest("r1")).id).to.equal("j1");
    expect(calls[0].method).to.equal("POST");
    expect(calls[0].url).to.equal(
      "/jobExecution/jobRequests/r1/jobs?submitter=positron-sas",
    );
    // Without a JSON body the live server answers 415.
    expect(calls[0].data).to.deep.equal({});
    expect(calls[0].headers?.["Content-Type"]).to.equal("application/json");
  });

  it("creates a schedule with the scheduler's media type", async () => {
    answer = () => ({ data: json("schedule-created.json") });
    const schedule = buildSchedule({
      name: "n",
      jobRequestId: "r1",
      trigger: buildTrigger({ ...base, kind: "daily", time: "02:00" }, "n"),
      language: "en-US",
    });
    await model.createSchedule(schedule);
    expect(calls[0].url).to.equal("/scheduler/jobs");
    expect(calls[0].headers?.["Content-Type"]).to.equal(
      "application/vnd.sas.schedule.job+json",
    );
    expect(calls[0].data).to.deep.equal(schedule);
  });

  it("lists only this client's schedules for the user", async () => {
    answer = () => ({
      data: { items: [json("schedule-created.json")], links: [] },
    });
    const page = await model.listSchedules(0, 25);
    expect(page.items).to.have.length(1);
    expect(decodeURIComponent(calls[0].url)).to.equal(
      "/scheduler/jobs?start=0&limit=25&sortBy=modifiedTimeStamp:descending" +
        "&filter=and(eq(group,'positron-sas'),eq(createdBy,'user1'))",
    );
  });

  it("disables with a PUT that carries If-Match, retrying once when stale", async () => {
    let puts = 0;
    answer = (method) => {
      if (method === "GET") {
        return {
          data: json("schedule-created.json"),
          headers: { etag: `"e${puts}"` },
        };
      }
      return ++puts === 1 ? { status: 412 } : { data: {} };
    };
    await model.setEnabled("s1", false);
    const sent = calls.filter((c) => c.method === "PUT");
    expect(sent).to.have.length(2);
    expect(sent[0].headers?.["If-Match"]).to.equal('"e0"');
    expect(sent[1].headers?.["If-Match"]).to.equal('"e1"');
    // JSON.parse returns `any`, which stands in for the schedule sent.
    expect(isEnabled(JSON.parse(JSON.stringify(sent[1].data)))).to.equal(false);
  });

  it("gives up after a second stale ETag", async () => {
    answer = (method) =>
      method === "GET"
        ? { data: json("schedule-created.json"), headers: { etag: '"e"' } }
        : { status: 412 };
    let error: unknown;
    try {
      await model.setEnabled("s1", true);
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(PreconditionFailedError);
  });

  it("reports a schedule that can never run, on create and on enable", async () => {
    // Recorded from the live server when a one-time schedule was enabled
    // again after its time had passed.
    const refused = {
      status: 400,
      data: {
        errorCode: 11304,
        message: "Job will never fire",
        httpStatusCode: 400,
      },
    };
    const rejection = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error;
      }
      throw new Error("Expected the promise to reject");
    };
    answer = () => refused;
    const schedule = buildSchedule({
      name: "past",
      jobRequestId: "r1",
      trigger: buildTrigger(
        { ...base, kind: "once", dates: ["2020-01-01"], time: "02:00" },
        "past",
      ),
      language: "en-US",
    });
    expect(await rejection(model.createSchedule(schedule))).to.be.instanceOf(
      NeverFiresError,
    );
    answer = (method) =>
      method === "GET"
        ? { data: json("schedule-created.json"), headers: { etag: '"e"' } }
        : refused;
    expect(await rejection(model.setEnabled("s1", true))).to.be.instanceOf(
      NeverFiresError,
    );
  });

  it("reads the next fire times and the history", async () => {
    answer = (_m, url) =>
      url.includes("fireTimes")
        ? { data: json("schedule-firetimes.json") }
        : { data: json("schedule-history.json") };
    const times = await model.fireTimes("s1");
    expect(times[0]).to.match(/^\d{4}-\d{2}-\d{2}T/);
    const history = await model.history("s1");
    expect(history[0]).to.have.property("jobStatus", "SUCCESS");
    expect(calls[1].url).to.equal("/scheduler/jobs/s1/history?limit=5");
  });
});
