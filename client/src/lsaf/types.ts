// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Shapes of the SAS Life Science Analytics Framework REST API 1.0, from its
// OpenAPI document. Not verified against a live server: fields are optional
// unless the spec requires them, and unknown fields are kept.

/** Where a file or job lives. */
export type Area = "repository" | "workspace";

export interface VersionLimits {
  majorVersionLimit?: number | null;
  minorVersionLimit?: number | null;
}

/**
 * A repository item (RepositoryItem, RepositoryFile, RepositoryExecutableFile,
 * RepositoryContainer, RepositoryContext). Without `expand=item` a listing
 * returns only `schemaType` and `path`.
 */
export interface RepositoryItem {
  schemaVersion?: number;
  /** context, sharedFolder, folder, file, executable, ... */
  schemaType: string;
  path: string;
  id?: string;
  typeId?: string;
  name?: string;
  description?: string;
  created?: string;
  createdBy?: string;
  lastModified?: string;
  lastModifiedBy?: string;
  propertiesLastModified?: string;
  propertiesLastModifiedBy?: string;
  syncable?: string;
  state?: string;
  sharedFolderPath?: string;
  container?: boolean;
  context?: boolean;
  shared?: boolean;
  defaultVersionLimits?: VersionLimits;
  sharedFolderCount?: number;
  // Files
  versioned?: boolean;
  version?: string;
  checkedOut?: boolean;
  checkedOutBy?: string;
  checkedOutDate?: string;
  locked?: boolean;
  digest?: string;
  signingStatus?: "NONE" | "CURRENT" | "PREVIOUS" | "BOTH" | string;
  size?: number;
  versionLimits?: VersionLimits;
  // Executable files (jobs)
  runAsOwner?: boolean;
  lastRunDate?: string;
  healthStatus?: "UNKNOWN" | "UP_TO_DATE" | "STALE" | string;
}

/** A workspace item (WorkspaceItem, WorkspaceFile, WorkspaceFolder). */
export interface WorkspaceItem {
  schemaVersion?: number;
  /** file or folder */
  schemaType: string;
  path: string;
  name?: string;
  lastModified?: string;
  symbolicLink?: boolean;
  sharedFolderPath?: string;
  /** In the spec's example, not its schema. */
  folder?: boolean;
  shared?: boolean;
  size?: number;
}

export interface ItemCollection<T> {
  schemaVersion?: number;
  items?: T[];
}

/** RepositoryFileVersionInfo */
export interface FileVersion {
  version: string;
  path: string;
  comment?: string;
  created?: string;
  createdBy?: string;
  size?: number;
  digest?: string;
  latest?: boolean;
  signed?: boolean;
}

/** RepositoryFileSignature */
export interface FileSignature {
  fileId?: string;
  filePath?: string;
  fileVersion?: string;
  userId: string;
  userDisplayName?: string;
  role?: string;
  reason?: string;
  comment?: string;
  created?: string;
}

/** Status: how an action or a job submission ended. */
export interface Status {
  schemaVersion?: number;
  code?: number;
  /** success, warning, failure, started, COMPLETED, ... */
  type?: string;
  /** Only with `expand=status`. */
  message?: string;
}

/** ActionResult, RepositoryActionResult, WorkspaceActionResult. */
export interface ActionResult<T = RepositoryItem | WorkspaceItem> {
  schemaType?: string;
  action?: string;
  status?: Status;
  item?: T;
  /** Run and submit results (…ExecuteActionResult). */
  submissionId?: string;
}

export interface ActionOutcome {
  count?: number;
  items?: ActionResult[];
}

/** ActionResults: the result of a zip upload. */
export interface ActionResults {
  action?: string;
  successes?: ActionOutcome;
  warnings?: ActionOutcome;
  failures?: ActionOutcome;
}

/** Resource: a repository or workspace path, as `/job` and `/manifest` return. */
export interface Resource {
  schemaType: string;
  path: string;
  id?: string;
  version?: string;
}

/** Job: what creating a job from programs returns. */
export interface Job {
  resource?: Resource;
  programs?: string[];
}

export interface JobSubmission {
  id: string;
  /** "completed" in the spec's example; other values are not documented. */
  state?: string;
  submittedBy?: string;
  submittedTimestamp?: string;
  completedTimestamp?: string;
  message?: string;
}

/** Error-2: the body of an `application/vnd.sas.hls.error+json` response. */
export interface ErrorBody {
  httpStatusCode?: number;
  errorCode?: number;
  message?: string;
  remediation?: string;
  details?: string[];
}
