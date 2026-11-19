// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The user's LSAF workspace over the REST API: listing, contents, saving,
// new files and folders. Check-in and check-out go through the repository
// (RepositoryModel), whose endpoints take a comment and a version. Nothing
// here imports `vscode`.
import {
  LsafClient,
  checkAction,
  checkActions,
  isNotFound,
} from "./LsafClient";
import { fileForm } from "./RepositoryModel";
import { CHILDREN_LIMIT } from "./const";
import { normalizeWorkspaceItem } from "./items";
import { baseName, workspaceFileUrl, workspaceFolderUrl } from "./paths";
import type {
  ActionResult,
  ActionResults,
  ItemCollection,
  WorkspaceItem,
} from "./types";
import { emptyFolderZip } from "./zip";

const EXPAND_ACTION = "item,status";

export class WorkspaceModel {
  constructor(private readonly client: () => LsafClient) {}

  /** The items in a workspace folder (`/` for the top level). */
  async getChildren(
    path: string,
    onTruncated?: (count: number) => void,
  ): Promise<WorkspaceItem[]> {
    const collection = await this.client().getJson<
      ItemCollection<WorkspaceItem>
    >(workspaceFolderUrl(path), {
      component: "children",
      childType: "all",
      expand: "item",
      limit: CHILDREN_LIMIT,
    });
    const items = (collection?.items ?? []).map(normalizeWorkspaceItem);
    if (items.length >= CHILDREN_LIMIT) {
      onTruncated?.(items.length);
    }
    return items;
  }

  async getFileProperties(path: string): Promise<WorkspaceItem> {
    return normalizeWorkspaceItem(
      await this.client().getJson<WorkspaceItem>(workspaceFileUrl(path), {
        component: "properties",
      }),
    );
  }

  async getFolderProperties(path: string): Promise<WorkspaceItem> {
    return normalizeWorkspaceItem(
      await this.client().getJson<WorkspaceItem>(workspaceFolderUrl(path), {
        component: "properties",
      }),
    );
  }

  /** Whether a file exists in the workspace. */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileProperties(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  getContent(path: string): Promise<Uint8Array> {
    return this.client().getBytes(workspaceFileUrl(path), {
      component: "contents",
    });
  }

  /** A folder and everything below it, as a zip. */
  downloadFolder(path: string): Promise<Uint8Array> {
    return this.client().getBytes(workspaceFolderUrl(path), {
      component: "contents",
    });
  }

  /**
   * Write a file. Without `overwrite` an existing file is kept and this
   * throws (the server answers with a warning).
   */
  async write(
    path: string,
    content: Uint8Array,
    { overwrite = true, createParents = true } = {},
  ): Promise<WorkspaceItem | undefined> {
    const result = await this.client().putJson<ActionResult<WorkspaceItem>>(
      workspaceFileUrl(path),
      { action: "upload", overwrite, createParents, expand: EXPAND_ACTION },
      fileForm(baseName(path), content),
    );
    checkAction(result, `Saving ${path}`);
    return result?.item;
  }

  /**
   * Create an empty folder by uploading a zip with just that folder and
   * having the server expand it into `parent`: the API has no other way.
   */
  async createFolder(parent: string, name: string): Promise<void> {
    const form = new FormData();
    form.append(
      "uploadFile",
      new Blob([emptyFolderZip(name).slice()], { type: "application/zip" }),
      `${name}.zip`,
    );
    const result = await this.client().putJson<ActionResults>(
      workspaceFolderUrl(parent),
      {
        createParents: true,
        overwrite: false,
        expand: "failures.items.status,warnings.items.status",
      },
      form,
    );
    checkActions(result, `Creating the folder ${name}`);
  }
}
