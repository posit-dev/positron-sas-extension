// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/types.ts (Apache-2.0).

export type ItemType = "CONTEXT" | "FOLDER" | "FILE" | "JOB_FILE" | "JOB";

export type Capability = "TOP" | "MEMBERSHIP" | "STATE" | "FILES";

export interface Link {
  method: string;
  rel: string;
  href: string;
  uri: string;
  type?: string;
}

export interface RepositoryItem {
  id: string;
  name: string;
  path: string;
  typeId: string;
  primaryType: ItemType;
  size?: number;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  versioned?: boolean;
  links?: Link[];
  description?: string;
  location?: string;
  owner?: string;
  ownerDisplayName?: string;
  createdByDisplayName?: string;
  modifiedByDisplayName?: string;
  // Contexts only (e.g. ACTIVE).
  state?: string;
  // Set for files only.
  locked?: boolean;
  checkedOut?: boolean;
  checkedOutBy?: string;
  checkedOutByDisplayName?: string;
  checkedOutTimestamp?: string;
  fileVersion?: string;
  synchronizationInfo?: SynchronizationInfo;
  /** Files only: whether the latest and/or earlier versions are signed. */
  signingStatus?: SigningStatus | string;
}

/**
 * Electronic signatures on a file: of its latest version (CURRENT), of
 * earlier versions only (PREVIOUS), of both (BOTH), or none.
 */
export type SigningStatus = "NONE" | "CURRENT" | "PREVIOUS" | "BOTH";

/** One electronic signature, from `items/{id}/signatures`. */
export interface Signature {
  id: string;
  fileId: string;
  /** Absent or "-" for a file without versioning. */
  fileVersion?: string;
  userId: string;
  userDisplayName?: string;
  role?: string;
  reason?: string;
  comment?: string;
  creationTimeStamp?: string;
}

export type WorkspaceStatus =
  "WORKSPACE_FILE_MISSING" | "OUT_OF_SYNC" | "IN_SYNC" | "NOT_SYNCED";

/** How a file in the user's workspace relates to the repository. */
export interface SynchronizationInfo {
  checkedOut?: boolean;
  checkedOutBy?: string;
  checkedOutByDisplayName?: string;
  checkedOutTimeStamp?: string;
  synchronizationFileVersion?: string;
  synchronizationTimeStamp?: string;
  workspaceStatus?: WorkspaceStatus | string;
  // "-" or empty for a file without versioning.
  fileVersion?: string;
  syncable?: string;
}

/** A file or folder in the signed-in user's Clinical Acceleration workspace. */
export interface WorkspaceItem {
  name: string;
  path: string;
  type: "FILE" | "FOLDER";
  location?: string;
  size?: number;
  contentType?: string;
  modifiedTimeStamp?: string;
  synchronizationInfo?: SynchronizationInfo;
}

/** A workspace file the server lists as a candidate for check-in. */
export interface SynchronizationItem {
  name: string;
  path: string;
  location?: string;
  synchronizationInfo: SynchronizationInfo;
}

/** One version of a versioned file, from `items/{id}/versions`. */
export interface VersionHistoryItem {
  fileId: string;
  fileVersion: string;
  comment?: string;
  createdByDisplayName?: string;
  creationTimeStamp?: string | number;
  modifiedByDisplayName?: string;
  modifiedTimeStamp?: string | number;
  size?: number;
  fileSize?: number;
  latest?: boolean;
  /** Whether this version has been signed. */
  signed?: boolean;
}

/** A version as listed in the Version History view, with its file's name. */
export type VersionRow = VersionHistoryItem & {
  name: string;
  /** Repository path of the file. */
  path: string;
};

/** The versioning privileges the signed-in user holds for an item. */
export interface ItemPrivileges {
  enableVersioning: boolean;
  manageVersioning: boolean;
  /** Sign Files: electronic signatures, with the signer's PIN. */
  signFiles: boolean;
}

export type VersioningAction = "ENABLE_VERSIONING" | "DISABLE_VERSIONING";

export interface ObjectType {
  id: string;
  name: string;
  capabilities?: Capability[];
}

export interface ResourceCollection<T> {
  count?: number;
  start?: number;
  limit?: number;
  items: T[];
  links?: Link[];
}

export type CompletionStatus = "INFO" | "WARN" | "ERROR";

export interface ActionStatusDetails {
  itemName: string;
  message: string;
  completionStatus?: CompletionStatus;
}

export interface ActionStatus {
  details?: ActionStatusDetails[];
  summary: {
    action?: string;
    message?: string;
    endTimeStamp?: string;
    completionStatus?: CompletionStatus;
  };
}

/** Workspace batch actions offered from the Repository view. */
export type CheckoutAction = "REPOSITORY_CHECK_OUT" | "UNDO_CHECKOUT";

/** Who has a repository file checked out, relative to the signed-in user. */
export type CheckoutState = "none" | "self" | "other";

/** Body of the `CHECK_IN` batch action. */
export interface CheckInBody {
  fileSpecifications: Array<{
    path: string;
    fileVersion?: string;
    type: "FILE";
  }>;
  comment: string;
  includeNewFiles: true;
}

/** One audit record, from `clinicalRepository/audit/entries`. */
export interface AuditEntry {
  id: string;
  timestamp?: string;
  userId?: string;
  userDisplayName?: string;
  /** Such as `checkedIn`; see `audit/actions`. */
  action?: string;
  actionDisplayName?: string;
  sourceId?: string;
  sourceTypeId?: string;
  /** FILE, FOLDER, CONTEXT, ... */
  sourcePrimaryType?: string;
  sourceName?: string;
  /** The folder the item was in: no trailing slash. */
  sourceLocation?: string;
  /** USER, ADMIN or SYSTEM. */
  mode?: string;
  /** Only when one entry is read: what changed. */
  auditEntryDetails?: AuditDetail[];
}

export interface AuditDetail {
  attributeType?: string;
  attributeId?: string;
  attributeName?: string;
  oldValue?: string;
  newValue?: string;
}

/** An audited action, from `clinicalRepository/audit/actions`. */
export interface AuditAction {
  action: string;
  displayName?: string;
  /** The object type the action applies to. */
  typeId?: string;
}
