// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** The states a Job Execution job can be in. */
export type JobState =
  "pending" | "running" | "completed" | "failed" | "canceled" | "timedOut";

/** How a finished job turned out, for icons and message severity. */
export type JobOutcome = "success" | "warning" | "error" | "running";

export interface Link {
  method?: string;
  rel: string;
  href: string;
  uri?: string;
  type?: string;
}

export interface SasError {
  message?: string;
  errorCode?: number;
  httpStatusCode?: number;
  details?: string[];
}

export interface JobDefinitionParameter {
  version?: number;
  name: string;
  type: "CHARACTER" | "NUMERIC" | "DATE" | "TABLE";
  label?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface ResourceProperty {
  name: string;
  value: string;
}

export interface JobDefinition {
  version?: number;
  id?: string;
  name: string;
  description?: string;
  type: string;
  code?: string;
  parameters?: JobDefinitionParameter[];
  properties?: ResourceProperty[];
  links?: Link[];
}

export interface JobRequest {
  version?: number;
  name?: string;
  description?: string;
  jobDefinitionUri?: string;
  jobDefinition?: JobDefinition;
  arguments?: Record<string, string>;
  expiresAfter?: string;
}

/** A job as the Job Execution service returns it. */
export interface ExecutionJob {
  id: string;
  state: JobState;
  stateDetails?: string;
  results?: Record<string, string>;
  error?: SasError;
  jobRequest?: JobRequest;
  logLocation?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  endTimeStamp?: string;
  elapsedTime?: number;
  createdBy?: string;
  submittedByApplication?: string;
  links?: Link[];
}

export interface ResourceCollection<T> {
  items?: T[];
  count?: number;
  start?: number;
  limit?: number;
  links?: Link[];
}

/** One file a finished job produced, in the Files service. */
export interface JobFile {
  /** The key in the job's `results` map. */
  key: string;
  /** `/files/files/{id}`. */
  uri: string;
  /** The file id on its own. */
  id: string;
  /** What this file is, as far as the key tells us. */
  kind: "log" | "logJson" | "listing" | "listingJson" | "other";
  /** Resolved from the Files service when the key is opaque. */
  name?: string;
  contentType?: string;
}

/** A compute context the user may run a job in. */
export interface ComputeContextSummary {
  id: string;
  name: string;
}

/** One line of a SAS log, as the Compute service represents it. */
export interface ComputeLogLine {
  type: string;
  line: string;
}

/** What the extension remembers about a definition it generated. */
export interface RememberedDefinition {
  id: string;
  name: string;
  codeHash: string;
  etag?: string;
}
