// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Client of SAS Clinical Job Management (/clinicalJobs). It shares the
// Clinical Repository's connection, so it uses the extension's SAS Viya
// sign-in and its 401 retry.
//
// Request shapes were checked against a live server (2026-11-11) where the
// public spec is wrong: runs need ?action=RUN and a body of only `job` and
// `parameterValues`; the state accepts only application/json; cancel is
// PUT .../state?value=canceled (lowercase).
import { pollUntil } from "../actionStatus";
import {
  JOB_DEFINITIONS,
  JOB_REPOSITORY_DEFINITIONS,
  JOB_REPOSITORY_MANIFESTS,
  JOB_SCHEDULES,
  JOB_SUBMISSIONS,
  SUBMISSIONS_PAGE_LIMIT,
} from "../const";
import type { ResourceCollection } from "../types";
import { getLink } from "../utils";
import { isTerminal } from "./state";
import type {
  ClinicalJob,
  JobResource,
  Manifest,
  RawSubmission,
  RunInfo,
  Schedule,
  Submission,
  SubmissionState,
} from "./types";
import {
  manifestSubmissionId,
  normalizeSubmission,
  parseJobFile,
  submittedByFilter,
} from "./utils";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};
const ACCEPT_JSON = { Accept: "application/json" };

export interface SubmissionPage {
  items: Submission[];
  /** Whether the server has more submissions after this page. */
  hasMore: boolean;
}

export interface WaitOptions {
  intervalMs?: number;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (state: SubmissionState | string) => void;
}

interface RequestConfig {
  headers?: Record<string, string>;
}

/** The part of an axios instance the model uses. */
export interface JobsConnection {
  get<T>(url: string, config?: RequestConfig): Promise<{ data: T }>;
  post<T>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<{ data: T }>;
  put<T>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<{ data: T }>;
  patch<T>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<{ data: T }>;
}

/** What the model needs from RepositoryModel: its signed-in connection. */
export interface JobsBackend {
  getConnection(): Promise<JobsConnection>;
  getCurrentUserId(): Promise<string | undefined>;
}

/** What the model needs from WorkspaceModel: file contents. */
export interface JobsWorkspace {
  getContent(path: string): Promise<Uint8Array>;
}

export class JobsModel {
  constructor(
    private readonly repository: JobsBackend,
    private readonly workspace: JobsWorkspace,
  ) {}

  /**
   * The signed-in user's submissions, newest first. The service lists other
   * users' runs too when the user may see them, so the list is filtered.
   */
  async listSubmissions(
    start = 0,
    limit = SUBMISSIONS_PAGE_LIMIT,
  ): Promise<SubmissionPage> {
    const connection = await this.repository.getConnection();
    const userId = await this.repository.getCurrentUserId();
    // Newest first is the service's default order.
    const params = new URLSearchParams({
      start: String(start),
      limit: String(limit),
    });
    if (userId) {
      params.set("filter", submittedByFilter(userId));
    }
    const response = await connection.get<ResourceCollection<RawSubmission>>(
      `${JOB_SUBMISSIONS}?${params}`,
      { headers: ACCEPT_JSON },
    );
    const page = response.data;
    return {
      items: (page.items ?? []).map(normalizeSubmission),
      hasMore: !!getLink(page.links, "next"),
    };
  }

  async getSubmission(id: string): Promise<Submission> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<RawSubmission>(
      `${JOB_SUBMISSIONS}/${encodeURIComponent(id)}`,
      { headers: ACCEPT_JSON },
    );
    return normalizeSubmission(response.data);
  }

  /** The current state, such as RUNNING_TASKS or COMPLETED_SUCCESSFUL. */
  async getState(id: string): Promise<SubmissionState | string> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<string>(
      `${JOB_SUBMISSIONS}/${encodeURIComponent(id)}/state`,
      { headers: ACCEPT_JSON },
    );
    return String(response.data).trim();
  }

  /** Ask the service to cancel a run. It answers CANCELING right away. */
  async cancel(id: string): Promise<void> {
    const connection = await this.repository.getConnection();
    await connection.put(
      `${JOB_SUBMISSIONS}/${encodeURIComponent(id)}/state?value=canceled`,
      undefined,
      { headers: ACCEPT_JSON },
    );
  }

  /**
   * The manifest of a run. The service answers 404 when the manifest file
   * changed after the run (it checks the digest or modified time).
   */
  async getSubmissionManifest(id: string): Promise<Manifest> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<Manifest>(
      `${JOB_SUBMISSIONS}/${encodeURIComponent(id)}/manifest`,
      { headers: ACCEPT_JSON },
    );
    return response.data;
  }

  /** Start a job. Returns the submission, usually in state STARTED. */
  async submit(run: RunInfo): Promise<Submission> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<RawSubmission>(
      `${JOB_SUBMISSIONS}?action=RUN`,
      run,
      { headers: JSON_HEADERS },
    );
    return normalizeSubmission(response.data);
  }

  /**
   * Poll a run until it has finished and return its final state. Stopping
   * (isCancelled) only stops the waiting; the run goes on.
   */
  waitForCompletion(
    id: string,
    { intervalMs = 2000, isCancelled, sleep, onUpdate }: WaitOptions = {},
  ): Promise<SubmissionState | string> {
    return pollUntil(() => this.getState(id), isTerminal, {
      intervalMs,
      timeoutMs: Infinity,
      isCancelled,
      sleep,
      onUpdate,
    });
  }

  async getRepositoryJob(
    id: string,
    fileVersion?: string,
  ): Promise<ClinicalJob> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<ClinicalJob>(
      `${JOB_REPOSITORY_DEFINITIONS}/${encodeURIComponent(id)}${versionQuery(fileVersion)}`,
      { headers: ACCEPT_JSON },
    );
    return response.data;
  }

  async getRepositoryManifest(
    id: string,
    fileVersion?: string,
  ): Promise<Manifest> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<Manifest>(
      `${JOB_REPOSITORY_MANIFESTS}/${encodeURIComponent(id)}${versionQuery(fileVersion)}`,
      { headers: ACCEPT_JSON },
    );
    return response.data;
  }

  /**
   * A workspace job. The service has no GET for these, so the .cjob file is
   * read and parsed; its paths stay relative to the job's folder.
   */
  async readWorkspaceJob(resource: JobResource): Promise<ClinicalJob> {
    const bytes = await this.workspace.getContent(resource.path);
    return parseJobFile(new TextDecoder().decode(bytes), resource);
  }

  /**
   * The manifest a workspace .cmnf file records: the file names its run, and
   * the run's manifest comes from the service.
   */
  async readWorkspaceManifest(path: string): Promise<Manifest> {
    const bytes = await this.workspace.getContent(path);
    const id = manifestSubmissionId(new TextDecoder().decode(bytes));
    if (!id) {
      throw new Error(`${path} does not name the run that wrote it.`);
    }
    return this.getSubmissionManifest(id);
  }

  /**
   * Create a job file in the user's workspace. `job.resource` says where; the
   * service adds the owner and output locations ("./" by default).
   */
  async createJob(
    job: ClinicalJob,
    useRelativePaths = true,
  ): Promise<ClinicalJob> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<ClinicalJob>(
      `${JOB_DEFINITIONS}?useRelativePaths=${useRelativePaths}`,
      job,
      { headers: JSON_HEADERS },
    );
    return response.data;
  }

  /** Save a workspace job; the body is the whole job, resource included. */
  async patchJob(
    job: ClinicalJob,
    useRelativePaths = true,
  ): Promise<ClinicalJob> {
    const connection = await this.repository.getConnection();
    const response = await connection.patch<ClinicalJob>(
      `${JOB_DEFINITIONS}?useRelativePaths=${useRelativePaths}`,
      job,
      { headers: JSON_HEADERS },
    );
    return response.data;
  }

  /** The user's job schedules (at most 1000; the service does not page). */
  async listSchedules(): Promise<Schedule[]> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<ResourceCollection<Schedule>>(
      `${JOB_SCHEDULES}?limit=1000`,
      { headers: ACCEPT_JSON },
    );
    return response.data.items ?? [];
  }

  /** The next run times of a schedule, as date strings. */
  async getFutureRuns(id: string, limit = 5): Promise<string[]> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<
      string[] | ResourceCollection<string>
    >(`${JOB_SCHEDULES}/${encodeURIComponent(id)}/future?limit=${limit}`, {
      headers: ACCEPT_JSON,
    });
    const data = response.data;
    return Array.isArray(data) ? data : (data.items ?? []);
  }
}

function versionQuery(fileVersion: string | undefined): string {
  return fileVersion ? `?fileVersion=${encodeURIComponent(fileVersion)}` : "";
}
