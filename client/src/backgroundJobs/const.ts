// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Identifies this client's jobs on the server, as submittedByApplication. */
export const SUBMITTER = "positron-sas";

export const JOB_EXECUTION_ROOT = "/jobExecution/";
export const JOB_DEFINITIONS_ROOT = "/jobDefinitions/";
export const SCHEDULER_ROOT = "/scheduler/";

export const JOBS = "/jobExecution/jobs";
export const DEFINITIONS = "/jobDefinitions/definitions";
export const FILES = "/files/files";
export const COMPUTE_CONTEXTS = "/compute/contexts";
export const MY_FOLDER = "/folders/folders/@myFolder";
export const FOLDERS = "/folders/folders";

export const API_MEDIA_TYPE = "application/vnd.sas.api+json";
export const COLLECTION_MEDIA_TYPE = "application/vnd.sas.collection+json";
export const DEFINITION_MEDIA_TYPE = "application/vnd.sas.job.definition+json";
export const JOB_REQUEST_MEDIA_TYPE =
  "application/vnd.sas.job.execution.job.request+json";
export const JOB_MEDIA_TYPE = "application/vnd.sas.job.execution.job+json";
export const FOLDER_MEDIA_TYPE = "application/vnd.sas.content.folder+json";

export const JOBS_VIEW_ID = "sasbackgroundjobsprovider";

export const JOBS_AVAILABLE_CONTEXT_KEY = "SAS.backgroundJobsAvailable";
export const DEFINITIONS_AVAILABLE_CONTEXT_KEY = "SAS.jobDefinitionsAvailable";
export const SCHEDULING_AVAILABLE_CONTEXT_KEY = "SAS.jobSchedulingAvailable";

/** How often the view re-checks jobs that have not ended, while it is visible. */
export const REFRESH_INTERVAL_MS = 5000;

/** How many jobs a page of the view holds. */
export const JOBS_PAGE_LIMIT = 25;

/** The folder in SAS Content that holds the definitions the extension makes. */
export const DEFINITIONS_FOLDER_NAME = "Positron Jobs";

/** Marks a definition as one the extension created, so clean-up can find it. */
export const CREATED_BY_PROPERTY = "createdByPositron";
/** Records which document a generated definition came from. */
export const SOURCE_PROPERTY = "positronSource";

/**
 * The Job Execution service passes "mul" to the Compute Server when the
 * request carries no Accept-Language, and the server then fails every job with
 * error 5023. Always send a real language tag.
 */
export const DEFAULT_LANGUAGE = "en-US";
