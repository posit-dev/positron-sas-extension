// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Between job resources and the URIs of the Clinical Acceleration file
// systems, so job files open like any other repository or workspace file.
import { Uri } from "vscode";

import { getItemUri } from "../RepositoryDataProvider";
import { getVersionUri } from "../VersionHistoryProvider";
import { getWorkspaceUri } from "../WorkspaceDataProvider";
import { CLINICAL_SCHEME, WORKSPACE_SCHEME } from "../const";
import type { RepositoryItem, WorkspaceItem } from "../types";
import { isWorkspaceItem } from "../utils";
import type { JobResource } from "./types";
import { resourceFromPath } from "./utils";

/**
 * The URI that opens a file a run used or wrote. A versioned repository file
 * opens at the version the run recorded, so it shows exactly what was used.
 * Undefined for a repository file without an id.
 */
export function uriForResource(resource: JobResource): Uri | undefined {
  if (resource.resourceLocation === "WORKSPACE") {
    return getWorkspaceUri(resource);
  }
  if (!resource.id) {
    return undefined;
  }
  if (resource.fileVersion && resource.fileVersion !== "-") {
    return getVersionUri({
      fileId: resource.id,
      fileVersion: resource.fileVersion,
      name: resource.name,
    });
  }
  return getItemUri({
    id: resource.id,
    name: resource.name,
    path: resource.path,
  });
}

/** The job behind a URI of the workspace or repository file systems. */
export function resourceForUri(uri: Uri): JobResource | undefined {
  if (uri.scheme === WORKSPACE_SCHEME) {
    return resourceFromPath(uri.path, "WORKSPACE");
  }
  if (uri.scheme === CLINICAL_SCHEME) {
    const id = new URLSearchParams(uri.query).get("id") ?? undefined;
    return resourceFromPath(uri.path, "REPOSITORY", id ? { id } : {});
  }
  return undefined;
}

/** The job behind a tree item of the Repository or Workspace view. */
export function resourceForItem(
  item: RepositoryItem | WorkspaceItem,
): JobResource {
  if (isWorkspaceItem(item)) {
    return resourceFromPath(item.path, "WORKSPACE");
  }
  return resourceFromPath(item.path, "REPOSITORY", { id: item.id });
}
