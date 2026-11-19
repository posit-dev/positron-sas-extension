// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Persisted job requests (Job Execution service) and schedules (Scheduler
// service) for SAS jobs. Shapes checked against a live SAS Viya server
// (2026-11-18); see schedules.ts for what was found.
//
// Nothing here imports `vscode`, so it can be unit tested with a recorder.
import type { RestConnection } from "../viya/connection";
import { PreconditionFailedError } from "./JobsModel";
import {
  COLLECTION_MEDIA_TYPE,
  JOB_MEDIA_TYPE,
  JOB_REQUEST_MEDIA_TYPE,
  SUBMITTER,
} from "./const";
import {
  SCHEDULE_GROUP,
  SCHEDULE_MEDIA_TYPE,
  ScheduleHistoryItem,
  SchedulerJob,
  withEnabled,
} from "./schedules";
import type { ExecutionJob, ResourceCollection } from "./types";
import { getLink } from "./utils";

const JOB_REQUESTS = "/jobExecution/jobRequests";
const SCHEDULER_JOBS = "/scheduler/jobs";

interface Backend {
  getConnection(): Promise<RestConnection>;
  getCurrentUserId(): Promise<string | undefined>;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }
  const response: unknown = error.response;
  if (!response || typeof response !== "object" || !("status" in response)) {
    return undefined;
  }
  return typeof response.status === "number" ? response.status : undefined;
}

function etagOf(response: { headers?: unknown }): string | undefined {
  const headers = response.headers;
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  for (const key of ["etag", "ETag"]) {
    const value: unknown =
      key in headers ? Reflect.get(headers, key) : undefined;
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/**
 * The Scheduler refuses a schedule whose triggers can no longer fire, such as
 * a one-time schedule whose time has passed: 400 with error 11304, "Job will
 * never fire". That happens on create and on enabling one again.
 */
export class NeverFiresError extends Error {}

const NEVER_FIRES = 11304;

function errorCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }
  const response: unknown = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return undefined;
  }
  const data: unknown = response.data;
  if (!data || typeof data !== "object" || !("errorCode" in data)) {
    return undefined;
  }
  return typeof data.errorCode === "number" ? data.errorCode : undefined;
}

const neverFires = (error: unknown) =>
  statusOf(error) === 400 && errorCodeOf(error) === NEVER_FIRES;

export interface SchedulesPage {
  items: SchedulerJob[];
  hasMore: boolean;
}

export class SchedulesModel {
  constructor(
    private readonly backend: Backend,
    /** Sent on every request, as for jobs (see JobsModel). */
    private readonly language: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { "Accept-Language": this.language, ...(extra ?? {}) };
  }

  // ---------------------------------------------------------------- job requests

  /** A stored request to run a SAS job with fixed arguments, for a schedule. */
  async createJobRequest(options: {
    name: string;
    description?: string;
    definitionUri: string;
    arguments: Record<string, string>;
    expiresAfter?: string;
  }): Promise<string> {
    const connection = await this.backend.getConnection();
    const response = await connection.post<{ id?: string }>(
      JOB_REQUESTS,
      {
        version: 3,
        name: options.name,
        description: options.description,
        jobDefinitionUri: options.definitionUri,
        arguments: options.arguments,
        ...(options.expiresAfter ? { expiresAfter: options.expiresAfter } : {}),
      },
      {
        headers: this.headers({
          "Content-Type": JOB_REQUEST_MEDIA_TYPE,
          Accept: JOB_REQUEST_MEDIA_TYPE,
        }),
      },
    );
    if (!response.data?.id) {
      throw new Error("The server did not return an id for the job request.");
    }
    return response.data.id;
  }

  async getJobRequest(id: string): Promise<
    | {
        name?: string;
        jobDefinitionUri?: string;
        arguments?: Record<string, string>;
      }
    | undefined
  > {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<{
        name?: string;
        jobDefinitionUri?: string;
        arguments?: Record<string, string>;
      }>(`${JOB_REQUESTS}/${id}`, {
        headers: this.headers({ Accept: JOB_REQUEST_MEDIA_TYPE }),
      });
      return response.data;
    } catch (error) {
      if (statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /** Run a job request now, as the schedule would. */
  async runJobRequest(id: string): Promise<ExecutionJob> {
    const connection = await this.backend.getConnection();
    // An empty JSON object, which keeps the request's stored arguments. A POST
    // without a body gets axios' default Content-Type and a 415, and so does
    // an empty text/plain body (checked against a live server).
    const response = await connection.post<ExecutionJob>(
      `${JOB_REQUESTS}/${id}/jobs?submitter=${SUBMITTER}`,
      {},
      {
        headers: this.headers({
          "Content-Type": "application/json",
          Accept: JOB_MEDIA_TYPE,
        }),
      },
    );
    return response.data;
  }

  async deleteJobRequest(id: string): Promise<void> {
    const connection = await this.backend.getConnection();
    try {
      await connection.delete(`${JOB_REQUESTS}/${id}`, {
        headers: this.headers(),
      });
    } catch (error) {
      if (statusOf(error) !== 404) {
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------- schedules

  async createSchedule(schedule: SchedulerJob): Promise<SchedulerJob> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.post<SchedulerJob>(
        SCHEDULER_JOBS,
        schedule,
        {
          headers: this.headers({
            "Content-Type": SCHEDULE_MEDIA_TYPE,
            Accept: SCHEDULE_MEDIA_TYPE,
          }),
        },
      );
      return response.data;
    } catch (error) {
      if (neverFires(error)) {
        throw new NeverFiresError("The schedule would never run.");
      }
      throw error;
    }
  }

  /** This client's schedules for the user, most recently changed first. */
  async listSchedules(start: number, limit: number): Promise<SchedulesPage> {
    const connection = await this.backend.getConnection();
    let userId: string | undefined;
    try {
      userId = await this.backend.getCurrentUserId();
    } catch {
      userId = undefined;
    }
    const group = `eq(group,'${SCHEDULE_GROUP}')`;
    const filter = userId ? `and(${group},eq(createdBy,'${userId}'))` : group;
    const response = await connection.get<ResourceCollection<SchedulerJob>>(
      `${SCHEDULER_JOBS}?start=${start}&limit=${limit}` +
        `&sortBy=modifiedTimeStamp:descending&filter=${encodeURIComponent(filter)}`,
      { headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }) },
    );
    return {
      items: response.data.items ?? [],
      hasMore: !!getLink(response.data.links, "next"),
    };
  }

  async getSchedule(
    id: string,
  ): Promise<{ schedule: SchedulerJob; etag?: string } | undefined> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<SchedulerJob>(
        `${SCHEDULER_JOBS}/${id}`,
        { headers: this.headers({ Accept: SCHEDULE_MEDIA_TYPE }) },
      );
      return { schedule: response.data, etag: etagOf(response) };
    } catch (error) {
      if (statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /** Replace a schedule; If-Match is required (428 without, 412 if stale). */
  async updateSchedule(
    id: string,
    schedule: SchedulerJob,
    etag: string,
  ): Promise<SchedulerJob> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.put<SchedulerJob>(
        `${SCHEDULER_JOBS}/${id}`,
        schedule,
        {
          headers: this.headers({
            "Content-Type": SCHEDULE_MEDIA_TYPE,
            Accept: SCHEDULE_MEDIA_TYPE,
            "If-Match": etag,
          }),
        },
      );
      return response.data;
    } catch (error) {
      if (statusOf(error) === 412) {
        throw new PreconditionFailedError(
          "The schedule changed on the server.",
        );
      }
      if (neverFires(error)) {
        throw new NeverFiresError("The schedule would never run.");
      }
      throw error;
    }
  }

  /**
   * Switch every trigger of a schedule on or off. Pausing through the state
   * endpoint leaves no trace on the schedule, so this sets `active` instead.
   * A stale ETag is re-read once.
   */
  async setEnabled(id: string, enabled: boolean): Promise<SchedulerJob> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.getSchedule(id);
      if (!current?.etag) {
        throw new Error("The schedule is no longer on the server.");
      }
      try {
        return await this.updateSchedule(
          id,
          withEnabled(current.schedule, enabled),
          current.etag,
        );
      } catch (error) {
        if (!(error instanceof PreconditionFailedError) || attempt > 0) {
          throw error;
        }
      }
    }
  }

  async deleteSchedule(id: string): Promise<void> {
    const connection = await this.backend.getConnection();
    try {
      await connection.delete(`${SCHEDULER_JOBS}/${id}`, {
        headers: this.headers(),
      });
    } catch (error) {
      if (statusOf(error) !== 404) {
        throw error;
      }
    }
  }

  /** The next times the schedule runs (none while it is disabled). */
  async fireTimes(id: string, limit = 3): Promise<string[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<ResourceCollection<string>>(
      `${SCHEDULER_JOBS}/${id}/fireTimes`,
      { headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }) },
    );
    return (response.data.items ?? []).slice(0, limit);
  }

  /** Past firings, each with the status of the request and the job it made. */
  async history(id: string, limit = 5): Promise<ScheduleHistoryItem[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<
      ResourceCollection<ScheduleHistoryItem>
    >(`${SCHEDULER_JOBS}/${id}/history?limit=${limit}`, {
      headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }),
    });
    return response.data.items ?? [];
  }
}
