// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The SAS Viya Job Execution and Job Definitions services, as this extension
// uses them. Request shapes were checked against a live server (2026-11-18);
// where the behaviour differs from the published spec it is noted at the call.
//
// Nothing here imports `vscode`, so it can be unit tested with a recorder.
import type { RestConnection } from "../viya/connection";
import {
  COLLECTION_MEDIA_TYPE,
  COMPUTE_CONTEXTS,
  DEFINITIONS,
  DEFINITION_MEDIA_TYPE,
  FILES,
  FOLDERS,
  FOLDER_MEDIA_TYPE,
  JOBS,
  JOB_MEDIA_TYPE,
  JOB_REQUEST_MEDIA_TYPE,
  MY_FOLDER,
  SUBMITTER,
} from "./const";
import type {
  ComputeContextSummary,
  ComputeLogLine,
  ExecutionJob,
  JobDefinition,
  ResourceCollection,
} from "./types";
import { getLink, jobsFilter } from "./utils";

const FOLDERS_ROOT = "/folders";
const ANCESTOR_MEDIA_TYPE = "application/vnd.sas.content.folder.ancestor+json";

/** The job has ended, so its state can no longer be changed (405 / err 31501). */
export class AlreadyFinishedError extends Error {}
/** The job is gone from the server, e.g. it expired or was deleted. */
export class JobNotFoundError extends Error {}
/** The definition changed under us; re-read the ETag and try again (412). */
export class PreconditionFailedError extends Error {}

interface Backend {
  getConnection(): Promise<RestConnection>;
  getCurrentUserId(): Promise<string | undefined>;
}

/**
 * The HTTP status of a failed request. Checked structurally rather than with
 * isAxiosError, so the plain errors a test recorder throws classify the same.
 */
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
    if (key in headers) {
      const value: unknown = Reflect.get(headers, key);
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return undefined;
}

export interface SubmitOptions {
  name: string;
  description?: string;
  definitionUri?: string;
  /** Used when no definition could be stored; the code travels in the request. */
  definition?: JobDefinition;
  /**
   * The compute context. Leave it out for a job that declares its own
   * _contextName default; the service requires one or the other.
   */
  contextName?: string;
  expiresAfter?: string;
  /** Extra Compute provider arguments, such as _queue. */
  extraArguments?: Record<string, string>;
}

export interface JobsPage {
  items: ExecutionJob[];
  hasMore: boolean;
}

export interface DefinitionsPage {
  items: JobDefinition[];
  hasMore: boolean;
}

export class JobsModel {
  constructor(
    private readonly backend: Backend,
    /**
     * Sent on every request. Without it the Job Execution service passes "mul"
     * to the Compute Server, which fails every job with error 5023.
     */
    private readonly language: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { "Accept-Language": this.language, ...(extra ?? {}) };
  }

  // ---------------------------------------------------------------- definitions

  /**
   * Store a job definition, optionally filing it in a SAS Content folder.
   * The service refuses a name that is already a member of that folder, with
   * 400 "Failed to add member to folder", so callers must pick a free name.
   */
  async createDefinition(
    definition: JobDefinition,
    parentFolderUri?: string,
  ): Promise<{ definition: JobDefinition; etag?: string }> {
    const connection = await this.backend.getConnection();
    const url = parentFolderUri
      ? `${DEFINITIONS}?parentFolderUri=${encodeURIComponent(parentFolderUri)}`
      : DEFINITIONS;
    const response = await connection.post<JobDefinition>(
      url,
      { version: 2, ...definition },
      {
        headers: this.headers({
          "Content-Type": DEFINITION_MEDIA_TYPE,
          Accept: DEFINITION_MEDIA_TYPE,
        }),
      },
    );
    return { definition: response.data, etag: etagOf(response) };
  }

  async getDefinition(
    id: string,
  ): Promise<{ definition: JobDefinition; etag?: string } | undefined> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<JobDefinition>(
        `${DEFINITIONS}/${id}`,
        { headers: this.headers({ Accept: DEFINITION_MEDIA_TYPE }) },
      );
      return { definition: response.data, etag: etagOf(response) };
    } catch (error) {
      if (statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Replace a definition. The body must repeat the id, or the service answers
   * 400 "Job definition IDs do not match on update", and an If-Match header is
   * required: without one it answers 428, with a stale one 412.
   */
  async updateDefinition(
    id: string,
    definition: JobDefinition,
    etag: string,
  ): Promise<{ definition: JobDefinition; etag?: string }> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.put<JobDefinition>(
        `${DEFINITIONS}/${id}`,
        { version: 2, ...definition, id },
        {
          headers: this.headers({
            "Content-Type": DEFINITION_MEDIA_TYPE,
            Accept: DEFINITION_MEDIA_TYPE,
            "If-Match": etag,
          }),
        },
      );
      return { definition: response.data, etag: etagOf(response) };
    } catch (error) {
      if (statusOf(error) === 412) {
        throw new PreconditionFailedError(
          "The job definition changed on the server.",
        );
      }
      throw error;
    }
  }

  async deleteDefinition(id: string): Promise<void> {
    const connection = await this.backend.getConnection();
    try {
      await connection.delete(`${DEFINITIONS}/${id}`, {
        headers: this.headers(),
      });
    } catch (error) {
      if (statusOf(error) !== 404) {
        throw error;
      }
    }
  }

  /**
   * The user's job definitions, most recently changed first: the ones saved
   * from Positron, the ones made in SAS Studio, and the copies that Submit as
   * Background Job keeps.
   */
  async listDefinitions(
    start: number,
    limit: number,
  ): Promise<DefinitionsPage> {
    const connection = await this.backend.getConnection();
    let userId: string | undefined;
    try {
      userId = await this.backend.getCurrentUserId();
    } catch {
      userId = undefined;
    }
    const filter = userId
      ? `&filter=${encodeURIComponent(`eq(createdBy,'${userId}')`)}`
      : "";
    const response = await connection.get<ResourceCollection<JobDefinition>>(
      `${DEFINITIONS}?start=${start}&limit=${limit}` +
        `&sortBy=modifiedTimeStamp:descending${filter}`,
      { headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }) },
    );
    return {
      items: response.data.items ?? [],
      hasMore: !!getLink(response.data.links, "next"),
    };
  }

  // ---------------------------------------------------------------- jobs

  /** Submit a job. `?submitter=` is persisted as submittedByApplication. */
  async submit(options: SubmitOptions): Promise<ExecutionJob> {
    const connection = await this.backend.getConnection();
    const body = {
      version: 3,
      name: options.name,
      description: options.description,
      ...(options.definitionUri
        ? { jobDefinitionUri: options.definitionUri }
        : { jobDefinition: options.definition }),
      arguments: {
        ...(options.contextName ? { _contextName: options.contextName } : {}),
        ...(options.extraArguments ?? {}),
      },
      ...(options.expiresAfter ? { expiresAfter: options.expiresAfter } : {}),
    };
    const response = await connection.post<ExecutionJob>(
      `${JOBS}?submitter=${SUBMITTER}`,
      body,
      {
        headers: this.headers({
          "Content-Type": JOB_REQUEST_MEDIA_TYPE,
          Accept: JOB_MEDIA_TYPE,
        }),
      },
    );
    return response.data;
  }

  /** The job's state. This endpoint is text/plain only; JSON gives 406. */
  async getState(id: string): Promise<string> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<string>(`${JOBS}/${id}/state`, {
        headers: this.headers({ Accept: "text/plain" }),
        responseType: "text",
      });
      return String(response.data).trim();
    } catch (error) {
      if (statusOf(error) === 404) {
        throw new JobNotFoundError(id);
      }
      throw error;
    }
  }

  async getJob(id: string): Promise<ExecutionJob> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<ExecutionJob>(`${JOBS}/${id}`, {
        headers: this.headers({ Accept: JOB_MEDIA_TYPE }),
      });
      return response.data;
    } catch (error) {
      if (statusOf(error) === 404) {
        throw new JobNotFoundError(id);
      }
      throw error;
    }
  }

  /**
   * Ask the server to cancel a job. A job that has already ended answers
   * 405 (error 31501), which is not a failure: the caller just refreshes.
   */
  async cancel(id: string): Promise<void> {
    const connection = await this.backend.getConnection();
    try {
      // Send the state as a text/plain body too. A PUT without a body gets
      // axios' default Content-Type, which the service refuses with 415.
      await connection.put(`${JOBS}/${id}/state?value=canceled`, "canceled", {
        headers: this.headers({ "Content-Type": "text/plain" }),
      });
    } catch (error) {
      const status = statusOf(error);
      if (status === 405) {
        throw new AlreadyFinishedError(id);
      }
      if (status === 404) {
        throw new JobNotFoundError(id);
      }
      throw error;
    }
  }

  /** This client's jobs, newest first. */
  async listJobs(start: number, limit: number): Promise<JobsPage> {
    const connection = await this.backend.getConnection();
    let userId: string | undefined;
    try {
      userId = await this.backend.getCurrentUserId();
    } catch {
      userId = undefined;
    }
    const filter = encodeURIComponent(jobsFilter(userId));
    const url =
      `${JOBS}?start=${start}&limit=${limit}` +
      `&sortBy=creationTimeStamp:descending&filter=${filter}`;
    const response = await connection.get<ResourceCollection<ExecutionJob>>(
      url,
      { headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }) },
    );
    const items = response.data.items ?? [];
    return { items, hasMore: !!getLink(response.data.links, "next") };
  }

  /** Delete a job. This deletes its log and results with it. */
  async deleteJob(id: string): Promise<void> {
    const connection = await this.backend.getConnection();
    try {
      await connection.delete(`${JOBS}/${id}`, { headers: this.headers() });
    } catch (error) {
      if (statusOf(error) !== 404) {
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------- files

  async getFileText(id: string): Promise<string> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<string>(`${FILES}/${id}/content`, {
      headers: this.headers(),
      responseType: "text",
    });
    return typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  }

  /** The structured log: a collection of compute log lines. */
  async getLogLines(id: string): Promise<ComputeLogLine[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<ResourceCollection<ComputeLogLine>>(
      `${FILES}/${id}/content`,
      { headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }) },
    );
    return response.data?.items ?? [];
  }

  async getFileMetadata(
    id: string,
  ): Promise<{ name?: string; contentType?: string }> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<{
      name?: string;
      contentType?: string;
    }>(`${FILES}/${id}`, { headers: this.headers() });
    return response.data ?? {};
  }

  // ---------------------------------------------------------------- contexts, folders

  async listComputeContexts(): Promise<ComputeContextSummary[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<
      ResourceCollection<ComputeContextSummary>
    >(`${COMPUTE_CONTEXTS}?limit=100`, {
      headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }),
    });
    return response.data.items ?? [];
  }

  /**
   * The folders a resource is in, nearest first, or [] when it is in none.
   * Answers 204 for a resource outside any folder.
   */
  async getAncestors(
    childUri: string,
  ): Promise<{ name: string; type?: string; id?: string }[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<{
      ancestors?: { name: string; type?: string; id?: string }[];
    }>(`${FOLDERS_ROOT}/ancestors?childUri=${encodeURIComponent(childUri)}`, {
      headers: this.headers({ Accept: ANCESTOR_MEDIA_TYPE }),
    });
    return response.data?.ancestors ?? [];
  }

  /** The id of the folder at a SAS Content path, or undefined if there is none. */
  async getFolderIdByPath(path: string): Promise<string | undefined> {
    const connection = await this.backend.getConnection();
    try {
      const response = await connection.get<{ id?: string }>(
        `${FOLDERS}/@item?path=${encodeURIComponent(path)}`,
        { headers: this.headers({ Accept: FOLDER_MEDIA_TYPE }) },
      );
      return response.data?.id;
    } catch (error) {
      if (statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /** The user's My Folder, which holds the generated definitions folder. */
  async getMyFolderId(): Promise<string | undefined> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<{ id?: string }>(MY_FOLDER, {
      headers: this.headers({ Accept: FOLDER_MEDIA_TYPE }),
    });
    return response.data?.id;
  }

  async listFolderMembers(
    folderId: string,
  ): Promise<{ name: string; uri: string; contentType?: string }[]> {
    const connection = await this.backend.getConnection();
    const response = await connection.get<
      ResourceCollection<{ name: string; uri: string; contentType?: string }>
    >(`${FOLDERS}/${folderId}/members?limit=100`, {
      headers: this.headers({ Accept: COLLECTION_MEDIA_TYPE }),
    });
    return response.data.items ?? [];
  }

  async createFolder(parentFolderId: string, name: string): Promise<string> {
    const connection = await this.backend.getConnection();
    const response = await connection.post<{ id: string }>(
      `${FOLDERS}?parentFolderUri=${FOLDERS}/${parentFolderId}`,
      { name, type: "folder" },
      {
        headers: this.headers({
          "Content-Type": FOLDER_MEDIA_TYPE,
          Accept: FOLDER_MEDIA_TYPE,
        }),
      },
    );
    return response.data.id;
  }
}
