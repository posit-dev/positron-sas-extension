// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/WorkspaceModel.ts (Apache-2.0).
import { RepositoryModel } from "./RepositoryModel";
import {
  COLLECTION_MEDIA_TYPE,
  SYNCHRONIZATION_ITEMS,
  WORKSPACE_ITEMS_BATCH,
  WORKSPACE_ITEMS_CONTENT,
} from "./const";
import type {
  ActionStatus,
  CheckInBody,
  RepositoryItem,
  ResourceCollection,
  SynchronizationItem,
  VersionRow,
  WorkspaceItem,
} from "./types";
import {
  buildWorkspaceFolderUrl,
  buildWorkspaceItemsUrl,
  collectPages,
  joinWorkspacePath,
} from "./utils";

const baseName = (path: string): string => path.split("/").pop() ?? path;

/** The failure message of an action the server ended with ERROR. */
function assertActionSucceeded(status: ActionStatus): void {
  if (status.summary.completionStatus === "ERROR") {
    throw new Error(
      status.details?.[0]?.message ??
        status.summary.message ??
        "The server reported an error.",
    );
  }
}

/**
 * REST access to the signed-in user's Clinical Acceleration workspace: a
 * per-user area on the server holding the files that were copied or checked
 * out of the repository, and new files that are not in the repository yet.
 * It shares the connection (and sign-in) of the `RepositoryModel`.
 */
export class WorkspaceModel {
  constructor(private readonly repository: RepositoryModel) {}

  async getChildren(
    item: WorkspaceItem | undefined,
    onTruncated?: (reason: string) => void,
  ): Promise<WorkspaceItem[]> {
    const connection = await this.repository.getConnection();
    return collectPages<WorkspaceItem>(
      async (url) =>
        (
          await connection.get<ResourceCollection<WorkspaceItem>>(url, {
            headers: { Accept: COLLECTION_MEDIA_TYPE },
          })
        ).data,
      buildWorkspaceItemsUrl(item?.path, { includeSynchronizationInfo: true }),
      onTruncated,
    );
  }

  /** A file with its size, modification time and synchronization state. */
  async getItem(path: string): Promise<WorkspaceItem> {
    const connection = await this.repository.getConnection();
    const response = await connection.get<WorkspaceItem>(
      buildWorkspaceItemsUrl(path, {
        type: "FILE",
        includeSynchronizationInfo: true,
      }),
    );
    return response.data;
  }

  async getContent(path: string): Promise<Uint8Array> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<ArrayBuffer>(
      WORKSPACE_ITEMS_CONTENT,
      { paths: [path] },
      { responseType: "arraybuffer" },
    );
    return new Uint8Array(response.data);
  }

  /**
   * Create or replace a file. The API takes multipart/form-data with one
   * `file` part; axios sets the Content-Type and boundary.
   */
  async saveContent(path: string, content: Uint8Array): Promise<WorkspaceItem> {
    const connection = await this.repository.getConnection();
    const body = new FormData();
    // slice() hands Blob a plain ArrayBuffer-backed copy.
    body.append("file", new Blob([content.slice()]), baseName(path));
    const response = await connection.put<WorkspaceItem>(
      buildWorkspaceItemsUrl(path, { expand: false }),
      body,
    );
    return response.data;
  }

  createFile(parentPath: string, name: string): Promise<WorkspaceItem> {
    return this.saveContent(
      joinWorkspacePath(parentPath, name),
      new Uint8Array(0),
    );
  }

  async createFolder(parentPath: string, name: string): Promise<WorkspaceItem> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<WorkspaceItem>(
      buildWorkspaceFolderUrl(parentPath, name),
    );
    return response.data;
  }

  /** Rename an item and return it as it is named now. */
  async rename(item: WorkspaceItem, name: string): Promise<WorkspaceItem> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<WorkspaceItem | undefined>(
      buildWorkspaceItemsUrl(item.path, { action: "RENAME" }),
      // The body is the new name as a JSON string.
      JSON.stringify(name),
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );
    const parent = item.path.slice(0, item.path.length - item.name.length);
    return {
      ...item,
      ...(response.data?.path ? response.data : {}),
      name,
      path: response.data?.path ?? joinWorkspacePath(parent || "/", name),
    };
  }

  /** Run a workspace batch action and wait for the server to finish it. */
  runAction(
    action: string,
    body: unknown,
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.repository.runBatchAction(
      WORKSPACE_ITEMS_BATCH,
      action,
      body,
      isCancelled,
    );
  }

  /** Copy the latest version of files, or the files of folders. */
  copyLatestVersion(
    items: RepositoryItem[],
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction(
      "COPY_LATEST_VERSION",
      items.map((item) => item.path),
      isCancelled,
    );
  }

  /** Copy folders without their files. */
  copyFolderStructure(
    items: RepositoryItem[],
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction(
      "COPY_FOLDER_STRUCTURE",
      { paths: items.map((item) => item.path), includeSubfolders: true },
      isCancelled,
    );
  }

  copySpecificVersion(
    version: VersionRow,
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction(
      "COPY_SPECIFIC_VERSION",
      [{ path: version.path, fileVersion: version.fileVersion }],
      isCancelled,
    );
  }

  delete(
    items: WorkspaceItem[],
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction(
      "DELETE",
      items.map((item) => item.path),
      isCancelled,
    );
  }

  undoCheckout(
    items: WorkspaceItem[],
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction(
      "UNDO_CHECKOUT",
      items.map((item) => item.path),
      isCancelled,
    );
  }

  checkIn(
    body: CheckInBody,
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    return this.runAction("CHECK_IN", body, isCancelled);
  }

  /** The signed-in user, to tell their own check-outs apart. */
  getCurrentUserId(): Promise<string | undefined> {
    return this.repository.getCurrentUserId();
  }

  /** The files below `paths` that can be checked in. */
  async getCheckInCandidates(paths: string[]): Promise<SynchronizationItem[]> {
    const connection = await this.repository.getConnection();
    const response = await connection.post<
      ResourceCollection<SynchronizationItem>
    >(`${SYNCHRONIZATION_ITEMS}?type=CHECKIN`, paths, {
      headers: { Accept: COLLECTION_MEDIA_TYPE },
    });
    return response.data.items ?? [];
  }

  /**
   * Download items as the server sends them: a file as it is, anything else
   * as a zip. The content is requested for an announced DOWNLOAD action.
   */
  async download(
    items: WorkspaceItem[],
    isCancelled: () => boolean,
  ): Promise<Uint8Array> {
    const paths = items.map((item) => item.path);
    const token = await this.repository.startBatchAction(
      WORKSPACE_ITEMS_BATCH,
      "DOWNLOAD",
      paths,
    );
    const connection = await this.repository.getConnection();
    const response = await connection.post<ArrayBuffer>(
      WORKSPACE_ITEMS_CONTENT,
      { paths, actionStatusId: token },
      { responseType: "arraybuffer" },
    );
    assertActionSucceeded(
      await this.repository.waitForAction(token, isCancelled),
    );
    return new Uint8Array(response.data);
  }

  /**
   * Upload a file (or, with `expand`, a zip whose content is unpacked) into a
   * workspace folder. The upload is announced as an action, then sent.
   */
  async upload(
    parentPath: string,
    name: string,
    content: Uint8Array,
    expand: boolean,
    isCancelled: () => boolean,
  ): Promise<void> {
    const filePath = joinWorkspacePath(parentPath, name);
    const token = await this.repository.startBatchAction(
      WORKSPACE_ITEMS_BATCH,
      expand ? "UPLOAD_EXPAND" : "UPLOAD",
      [filePath],
    );
    const connection = await this.repository.getConnection();
    const body = new FormData();
    body.append("file", new Blob([content.slice()]), name);
    const root = parentPath === "/" || parentPath === "";
    await connection.put(
      buildWorkspaceItemsUrl(expand ? parentPath : filePath, {
        // A root can't be told from the items collection without `path`.
        ...(expand && root ? { path: "/" } : {}),
        expand,
        actionStatusId: token,
      }),
      body,
    );
    assertActionSucceeded(
      await this.repository.waitForAction(token, isCancelled),
    );
  }
}
