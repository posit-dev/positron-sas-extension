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
