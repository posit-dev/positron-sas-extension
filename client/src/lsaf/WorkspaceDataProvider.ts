// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF Workspace view, and the writable file system
// (`sasLsafWorkspace:`) that edits its files.
//
// The workspace API says nothing about check-out state, so each listed
// folder is also listed in the repository at the same path: that tells which
// files are in the repository, versioned, and checked out (and by whom).
import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  l10n,
  window,
} from "vscode";

import { openCommand } from "../positron/dataFileEditorFallback";
import { describeError, isNotFound } from "./LsafClient";
import { notFoundOr } from "./RepositoryDataProvider";
import { RepositoryModel } from "./RepositoryModel";
import { WorkspaceModel } from "./WorkspaceModel";
import { LsafSession } from "./auth";
import { WORKSPACE_VIEW_ID } from "./const";
import {
  checkoutState,
  fileIcon,
  isWorkspaceFolder,
  sortItems,
  versionLabel,
  workspaceContextValue,
} from "./items";
import { Messages } from "./messages";
import { baseName, parentPath } from "./paths";
import type { RepositoryItem, WorkspaceItem } from "./types";
import { CheckoutDecorator, iconPath, workspaceUri } from "./uris";

/**
 * A workspace item in the tree, with the repository file at its path:
 * undefined when there is none, null when the repository couldn't be read.
 */
export interface WorkspaceNode extends WorkspaceItem {
  area: "workspace";
  repository?: RepositoryItem | null;
}

export const isWorkspaceNode = (value: unknown): value is WorkspaceNode =>
  !!value &&
  typeof value === "object" &&
  "area" in value &&
  value.area === "workspace";

const time = (value: string | undefined) =>
  value ? new Date(value).getTime() || 0 : 0;

export class WorkspaceDataProvider
  implements TreeDataProvider<WorkspaceNode>, FileSystemProvider, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    WorkspaceNode | undefined
  >();
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly onDidChangeFile: Event<FileChangeEvent[]> =
    this._onDidChangeFile.event;
  readonly treeView: TreeView<WorkspaceNode>;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly model: WorkspaceModel,
    private readonly repository: RepositoryModel,
    private readonly session: LsafSession,
    private readonly decorator: CheckoutDecorator,
    private readonly extensionUri: Uri,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(WORKSPACE_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: true,
    });
  }

  refresh(): void {
    this.treeView.message = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Tell open editors that workspace files changed on the server. */
  notifyChanged(paths: string[]): void {
    this._onDidChangeFile.fire(
      paths.map((path) => ({
        type: FileChangeType.Changed,
        uri: workspaceUri(path),
      })),
    );
  }

  selection(item: WorkspaceNode | undefined): WorkspaceNode[] {
    const selected = this.treeView.selection;
    if (!item) {
      return [...selected];
    }
    return selected.some((s) => s.path === item.path) ? [...selected] : [item];
  }

  async getChildren(item?: WorkspaceNode): Promise<WorkspaceNode[]> {
    if (!this.session.signedIn) {
      return [];
    }
    const path = item?.path ?? "/";
    let children: WorkspaceItem[];
    try {
      children = await this.model.getChildren(path, (count) =>
        this.log(
          `Listing workspace ${path} returned ${count} items, the most the API returns; there may be more.`,
        ),
      );
    } catch (error) {
      const message = l10n.t(Messages.WorkspaceListError, {
        message: describeError(error),
      });
      this.log(message);
      if (!item) {
        this.treeView.message = message;
      }
      return [];
    }
    const repository = await this.repositoryChildren(path);
    return sortItems(children, isWorkspaceFolder).map((child) => ({
      ...child,
      area: "workspace",
      repository:
        repository === null ? null : (repository.get(child.path) ?? undefined),
    }));
  }

  /** The repository files at a workspace folder's path; null if unknown. */
  private async repositoryChildren(
    path: string,
  ): Promise<Map<string, RepositoryItem> | null> {
    try {
      const items = await this.repository.getChildren(path);
      return new Map(items.map((item) => [item.path, item]));
    } catch (error) {
      if (isNotFound(error)) {
        return new Map();
      }
      this.log(
        `Unable to read the repository at ${path} for check-out states: ${describeError(error)}`,
      );
      return null;
    }
  }

  getTreeItem(item: WorkspaceNode): TreeItem {
    const folder = isWorkspaceFolder(item);
    const uri = workspaceUri(item.path);
    const state = checkoutState(
      item.repository ?? undefined,
      this.session.userId,
    );
    if (!folder) {
      this.decorator.set(uri, state, item.repository?.checkedOutBy);
    }
    let description: string | undefined;
    if (!folder && item.repository === undefined) {
      description = Messages.NotInRepository;
    } else if (item.repository) {
      description = versionLabel(item.repository);
    }
    const tooltip = [item.path];
    if (state === "self") {
      tooltip.push(Messages.CheckedOutBySelf);
    } else if (state === "other") {
      tooltip.push(
        l10n.t(Messages.CheckedOutBy, {
          user: item.repository?.checkedOutBy ?? "?",
        }),
      );
    }
    return {
      id: `ws:${item.path}`,
      label: item.name,
      description,
      resourceUri: uri,
      tooltip: tooltip.join("\n"),
      iconPath: iconPath(
        this.extensionUri,
        folder ? "$folder" : fileIcon(item.path),
      ),
      contextValue: workspaceContextValue(
        item,
        item.repository,
        this.session.userId,
      ),
      collapsibleState: folder
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      command: folder ? undefined : openCommand(uri),
    };
  }

  // --- FileSystemProvider ---

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    try {
      const item = await this.model.getFileProperties(uri.path);
      return {
        type: FileType.File,
        ctime: time(item.lastModified),
        mtime: time(item.lastModified),
        size: item.size ?? 0,
      };
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
    try {
      const item = await this.model.getFolderProperties(uri.path);
      return {
        type: FileType.Directory,
        ctime: time(item.lastModified),
        mtime: time(item.lastModified),
        size: 0,
      };
    } catch (error) {
      throw notFoundOr(error, uri);
    }
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    try {
      return await this.model.getContent(uri.path);
    } catch (error) {
      throw notFoundOr(error, uri);
    }
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const children = await this.model.getChildren(uri.path);
    return children.map((child) => [
      child.name ?? baseName(child.path),
      isWorkspaceFolder(child) ? FileType.Directory : FileType.File,
    ]);
  }

  /** Save an editor, or create a file. */
  async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    if (!options.overwrite && (await this.model.fileExists(uri.path))) {
      throw FileSystemError.FileExists(uri);
    }
    try {
      await this.model.write(uri.path, content, {
        overwrite: options.overwrite,
      });
    } catch (error) {
      this.log(
        l10n.t(Messages.SaveError, {
          path: uri.path,
          message: describeError(error),
        }),
      );
      throw error;
    }
    this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri }]);
    // Typing and saving come in bursts: refresh once the saving stops.
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 1000);
  }

  async createDirectory(uri: Uri): Promise<void> {
    await this.model.createFolder(parentPath(uri.path), baseName(uri.path));
    this.refresh();
  }

  delete(): void {
    throw FileSystemError.NoPermissions(Messages.NoDeleteOrRename);
  }

  rename(): void {
    throw FileSystemError.NoPermissions(Messages.NoDeleteOrRename);
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeFile.dispose();
  }
}
