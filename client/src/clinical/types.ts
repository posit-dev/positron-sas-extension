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
  // Set for files only.
  checkedOut?: boolean;
  checkedOutBy?: string;
  checkedOutByDisplayName?: string;
  fileVersion?: string;
}

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
