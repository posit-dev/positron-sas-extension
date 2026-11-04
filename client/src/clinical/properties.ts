// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/PropertyProvider.ts (Apache-2.0).
//
// The rows of the Properties view. Nothing here imports `vscode`: the labels
// are passed in, so the logic can be unit tested outside the extension host.
import type { RepositoryItem } from "./types";

export type PropertyKind = "string" | "user" | "date" | "number" | "sync";

export interface PropertyRow {
  key: string;
  kind: PropertyKind;
  label: string;
  value: string;
}

/** The text shown for every property and for the values of some of them. */
export interface PropertyLabels {
  name: string;
  description: string;
  location: string;
  type: string;
  owner: string;
  createdBy: string;
  dateCreated: string;
  modifiedBy: string;
  dateModified: string;
  state: string;
  size: string;
  lockStatus: string;
  versionStatus: string;
  version: string;
  checkedOut: string;
  checkedOutBy: string;
  checkedOutDate: string;
  workspaceStatus: string;
  locked: string;
  unlocked: string;
  versioned: string;
  unversioned: string;
  checkedOutYes: string;
  checkedOutNo: string;
  syncMissing: string;
  syncOutOfSync: string;
  syncInSync: string;
  syncNotSynced: string;
  syncUnknown: string;
}

export function formatBytes(bytes: number | undefined, decimals = 0): string {
  if (!bytes || bytes < 0) {
    return "0 Bytes";
  }
  const units = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${parseFloat((bytes / 1024 ** i).toFixed(decimals))} ${units[i]}`;
}

export function formatDate(
  value: string | number | undefined,
  locale?: string,
): string {
  if (value === undefined || value === "") {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function syncLabel(status: string | undefined, labels: PropertyLabels) {
  switch (status) {
    case "WORKSPACE_FILE_MISSING":
      return labels.syncMissing;
    case "OUT_OF_SYNC":
      return labels.syncOutOfSync;
    case "IN_SYNC":
      return labels.syncInSync;
    case "NOT_SYNCED":
      return labels.syncNotSynced;
    default:
      return status ?? labels.syncUnknown;
  }
}

const capitalize = (value: string): string =>
  value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";

/**
 * The properties of an item, in display order. Empty values are left out.
 * `typeName` is the readable name of the item's object type.
 */
export function buildPropertyRows(
  item: RepositoryItem,
  typeName: string | undefined,
  labels: PropertyLabels,
  locale?: string,
): PropertyRow[] {
  const rows: PropertyRow[] = [];
  const add = (
    key: string,
    kind: PropertyKind,
    label: string,
    value: string | undefined,
  ) => {
    if (value) {
      rows.push({ key, kind, label, value });
    }
  };

  add("name", "string", labels.name, item.name);
  add("description", "string", labels.description, item.description);
  add("location", "string", labels.location, item.location ?? item.path);
  add("type", "string", labels.type, typeName ?? item.typeId);
  add("owner", "user", labels.owner, item.ownerDisplayName ?? item.owner);
  add("createdBy", "user", labels.createdBy, item.createdByDisplayName);
  add(
    "dateCreated",
    "date",
    labels.dateCreated,
    formatDate(item.creationTimeStamp, locale),
  );
  add("modifiedBy", "user", labels.modifiedBy, item.modifiedByDisplayName);
  add(
    "dateModified",
    "date",
    labels.dateModified,
    formatDate(item.modifiedTimeStamp, locale),
  );

  if (item.primaryType === "CONTEXT") {
    add("state", "string", labels.state, capitalize(item.state ?? ""));
  }

  if (["FILE", "JOB", "JOB_FILE"].includes(item.primaryType)) {
    add("size", "number", labels.size, formatBytes(item.size));
    add(
      "locked",
      "string",
      labels.lockStatus,
      item.locked ? labels.locked : labels.unlocked,
    );
    add(
      "versioned",
      "string",
      labels.versionStatus,
      item.versioned ? labels.versioned : labels.unversioned,
    );
    if (item.versioned) {
      add("fileVersion", "number", labels.version, item.fileVersion);
    }
    add(
      "checkedOut",
      "string",
      labels.checkedOut,
      item.checkedOut ? labels.checkedOutYes : labels.checkedOutNo,
    );
    if (item.checkedOut) {
      add(
        "checkedOutBy",
        "user",
        labels.checkedOutBy,
        item.checkedOutByDisplayName ?? item.checkedOutBy,
      );
      add(
        "checkedOutDate",
        "date",
        labels.checkedOutDate,
        formatDate(item.checkedOutTimestamp, locale),
      );
    }
    add(
      "workspaceStatus",
      "sync",
      labels.workspaceStatus,
      syncLabel(item.synchronizationInfo?.workspaceStatus, labels),
    );
  }
  return rows;
}
