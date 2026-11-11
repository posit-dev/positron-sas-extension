// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Shapes of the SAS Clinical Job Management API (/clinicalJobs). The public
// spec and the live service disagree in places; the comments say which one a
// field follows. Live facts come from probing SAS Viya 2025 (2026-11-11).

export type ResourceLocation = "REPOSITORY" | "WORKSPACE";

/** A file or folder in the workspace or the repository. */
export interface JobResource {
  name: string;
  path: string;
  location: string;
  resourceLocation: ResourceLocation;
  /** Repository items only. */
  id?: string;
  /** Repository items only; "-" means not versioned. */
  fileVersion?: string;
}

export type ParameterType =
  "CHARACTER" | "CHARACTER_MASKED" | "NUMERIC" | "DATE" | "FOLDER" | "FILE";

/**
 * Value of a parameter. CHARACTER, CHARACTER_MASKED, NUMERIC and DATE are a
 * plain string (the service rejects the `{value}` form of the spec); FILE is
 * `{path, version?}` and FOLDER `{path, includeSubfolders}`.
 */
export type ParameterValueData =
  | string
  | { path: string; version?: string }
  | { path: string; includeSubfolders: boolean };

export interface JobParameter {
  name: string;
  label?: string;
  type: ParameterType;
  defaultValue?: ParameterValueData | null;
}

export interface ParameterValue {
  name: string;
  type: ParameterType;
  value: ParameterValueData;
  label?: string;
}

/**
 * A program of a job. The API returns `{path, name, location}`; the .cjob file
 * on disk stores `{path, version}`, with paths relative to the job's folder.
 */
export interface JobProgram {
  path: string;
  name?: string;
  location?: string;
  version?: string | null;
  fileVersion?: string;
}

export interface PublishSetup {
  files: { path: string; fileVersion?: string; version?: string }[];
  folders: {
    path: string;
    includeFiles?: boolean;
    includeSubfolders?: boolean;
  }[];
}

export interface PublishCheckin {
  enableVersioningOnNewFiles?: boolean;
  /** "", "MAJOR", "MINOR" or a version such as "2.0". */
  fileVersion?: string;
  locations: { path: string; includeSubfolders?: boolean }[];
}

/** A job definition, as the API returns it and as a .cjob file holds it. */
export interface ClinicalJob {
  /** Set by the API; the .cjob file has no resource. */
  resource?: JobResource;
  description?: string;
  useSingleOutputLocation?: boolean;
  outputLocation?: string | null;
  logsLocation?: string;
  resultsLocation?: string;
  manifestLocation?: string;
  owner?: string;
  ownerDisplayName?: string;
  runAsOwner?: boolean;
  programs?: JobProgram[];
  parameters?: JobParameter[];
  publishSetup?: PublishSetup;
  publishCheckin?: PublishCheckin;
}

/**
 * Body of `POST /submissions?action=RUN`. The service accepts only these two
 * fields: a `version` field (in the spec) is rejected.
 */
export interface RunInfo {
  job: Pick<JobResource, "name" | "path" | "location" | "resourceLocation">;
  parameterValues?: ParameterValue[];
}

export type SubmissionState =
  | "NOT_STARTED"
  | "STARTED"
  | "RUNNING_TASKS"
  | "CANCELING"
  | "POST_EXECUTION_PUBLISHING"
  | "COMPLETED_SUCCESSFUL"
  | "COMPLETED_PROGRAM_WARNINGS"
  | "COMPLETED_PROGRAM_WARNINGS_CHECKIN_ERROR"
  | "COMPLETED_PROGRAM_ERRORS"
  | "COMPLETED_PROGRAM_ERRORS_CHECKIN_ERROR"
  | "COMPLETED_CHECKIN_ERROR"
  | "COMPLETED_FAILED"
  | "COMPLETED_CANCELED";

export interface CheckinFailure {
  itemIdentifier?: string | null;
  itemName?: string | null;
  message: string;
}

/** One run of a job, in one shape whatever form the service sent. */
export interface Submission {
  id: string;
  /** The job's file name. */
  name: string;
  state: SubmissionState | string;
  info?: string;
  type?: ResourceLocation;
  jobRunContext?: string;
  submittedTimeStamp?: string;
  completedTimeStamp?: string;
  submittedBy?: string;
  submittedByDisplayName?: string;
  runAsUser?: string;
  runAsUserDisplayName?: string;
  lastSubmittedItem?: string;
  job: JobResource;
  jobOwner?: string;
  jobOwnerDisplayName?: string;
  jobRunAsOwner?: boolean;
  manifest?: JobResource;
  checkinFailures?: CheckinFailure[];
}

/**
 * A submission as the service sends it. The live service uses flat `job*`
 * fields; the spec describes a nested `job` object. Both are accepted.
 */
export interface RawSubmission extends Partial<
  Omit<Submission, "job" | "manifest">
> {
  id: string;
  job?: Partial<JobResource>;
  jobId?: string;
  jobName?: string;
  jobPath?: string;
  jobLocation?: string;
  jobResourceLocation?: ResourceLocation;
  jobVersion?: string;
  manifest?: Partial<JobResource>;
  summaryState?: string;
}

export type ExecutionState =
  "UNEXECUTED" | "FAILED" | "CANCELED" | "ERRORS" | "WARNINGS" | "SUCCESSFUL";

export interface ManifestFile {
  resource: JobResource;
  lastModifiedTimeStamp?: string;
  size?: number;
  /** MD5; repository files only. */
  digest?: string;
  referencingProgram?: string;
}

export interface ManifestProgram extends ManifestFile {
  executionState?: ExecutionState | string;
  /** Milliseconds. */
  executionTime?: number;
  executionInfo?: string;
}

export interface ManifestExternalReference {
  name: string;
  location: string;
  referencingProgram?: string;
}

export interface TransferMetric {
  total?: number;
  size?: number;
  time?: number;
}

/** The audit record of one run (`GET /submissions/{id}/manifest`). */
export interface Manifest {
  type?: ResourceLocation;
  jobSubmission?: {
    id?: string;
    state?: SubmissionState | string;
    jobRunContext?: string;
    submittedTimeStamp?: string;
    submittedBy?: string;
    submittedByDisplayName?: string;
    completedTimeStamp?: string;
    info?: string;
    runAsUser?: string;
    runAsUserDisplayName?: string;
  };
  job?: ManifestFile & {
    owner?: string;
    ownerDisplayName?: string;
    runAsOwner?: boolean;
    description?: string;
  };
  /** Milliseconds. */
  totalExecutionTime?: number;
  programs?: ManifestProgram[];
  logs?: ManifestFile[];
  results?: ManifestFile[];
  parameters?: ParameterValue[];
  inputs?: ManifestFile[];
  internalInputs?: ManifestFile[];
  externalInputs?: ManifestExternalReference[];
  outputs?: ManifestFile[];
  internalOutputs?: ManifestFile[];
  externalOutputs?: ManifestExternalReference[];
  manifest?: ManifestFile;
  metrics?: Record<string, TransferMetric | undefined>;
  checkinSpecification?: PublishCheckin;
}

export type TriggerType =
  | "MINUTELY"
  | "HOURLY"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY"
  | "DATELIST";

export interface Trigger {
  type: TriggerType;
  start?: string;
  /** The spec's example uses startDate. */
  startDate?: string;
  end?: string;
  timeZone?: string;
  numOccurrences?: number;
  interval?: number;
  dayOfMonth?: number;
  daysOfWeek?: DayOfWeek[];
  minutes?: string;
  hours?: string;
  dates?: string[];
  occurrence?: Occurrence;
  monthOfYear?: string;
}

export type Occurrence = "FIRST" | "SECOND" | "THIRD" | "FOURTH" | "LAST";
export type DayOfWeek = "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
export type ScheduleStatus = "ENABLED" | "DISABLED";

export interface Schedule {
  id: string;
  name: string;
  description?: string;
  runAs?: string;
  runAsDisplayName?: string;
  status?: ScheduleStatus;
  /** False when the job no longer exists or the user may not read it. */
  jobAvailable?: boolean;
  jobInfo?: { job?: Partial<JobResource>; parameterValues?: ParameterValue[] };
  trigger?: Trigger;
  createdBy?: string;
  createdByDisplayName?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
}

/**
 * Body of POST /schedules (not in the public spec; checked live). The service
 * fills in interval 1 and numOccurrences -1 (no limit) when they are missing.
 */
export interface ScheduleDefinition {
  name: string;
  description?: string;
  jobInfo: RunInfo;
  trigger: Trigger;
}
