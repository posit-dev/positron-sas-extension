// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/WorkspaceDataProvider.ts
// (Apache-2.0).
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
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  l10n,
  window,
} from "vscode";

import { isAxiosError } from "axios";

import { RepositoryDecorator } from "./RepositoryDecorator";
import { RepositoryModel } from "./RepositoryModel";
import { WorkspaceModel } from "./WorkspaceModel";
import { WORKSPACE_SCHEME, WORKSPACE_VIEW_ID } from "./const";
import { Messages, errorMessage } from "./messages";
import type { WorkspaceItem } from "./types";
import {
  buildWorkspaceContextValue,
  getWorkspaceCheckoutState,
  isWorkspaceFolder,
  workspaceIconName,
} from "./utils";

/** URI of a workspace item: `sasClinicalWorkspace:/<path in the workspace>`. */
export const getWorkspaceUri = (item: { path: string }): Uri =>
  Uri.from({ scheme: WORKSPACE_SCHEME, path: item.path });

/** The Workspace view, and the file system that makes its files editable. */
export class WorkspaceDataProvider
  implements TreeDataProvider<WorkspaceItem>, FileSystemProvider, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    WorkspaceItem | undefined
  >();
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly onDidChangeFile: Event<FileChangeEvent[]> =
    this._onDidChangeFile.event;
  readonly treeView: TreeView<WorkspaceItem>;

  constructor(
    private readonly model: WorkspaceModel,
    private readonly repository: RepositoryModel,
    private readonly decorator: RepositoryDecorator,
    private readonly extensionUri: Uri,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(WORKSPACE_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: false,
    });
  }

  refresh(): void {
    this.treeView.message = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Tell open editors that a file changed on the server, such as a job that
   * Run and populate rewrote, so they show the new content.
   */
  notifyChanged(path: string): void {
    this._onDidChangeFile.fire([
      { type: FileChangeType.Changed, uri: getWorkspaceUri({ path }) },
    ]);
    this.refresh();
  }

  /** The clicked item plus any other selected items. */
  selection(item: WorkspaceItem | undefined): WorkspaceItem[] {
    const selected = this.treeView.selection;
    if (!item) {
      return [...selected];
    }
    return selected.some((s) => s.path === item.path) ? [...selected] : [item];
  }

  async getChildren(item?: WorkspaceItem): Promise<WorkspaceItem[]> {
    try {
      const children = await this.model.getChildren(item, (reason) =>
        this.log(`Listing ${item?.path ?? "/"} was truncated: ${reason}`),
      );
      return children.sort(
        (a, b) =>
          Number(isWorkspaceFolder(b)) - Number(isWorkspaceFolder(a)) ||
          a.name.localeCompare(b.name),
      );
    } catch (error) {
      const message = l10n.t(Messages.WorkspaceListError, {
        message: errorMessage(error),
      });
      this.log(message);
      if (!item) {
        this.treeView.message = message;
      }
      return [];
    }
  }

  async getTreeItem(item: WorkspaceItem): Promise<TreeItem> {
    const folder = isWorkspaceFolder(item);
    const uri = getWorkspaceUri(item);
    const userId = await this.repository.getCurrentUserId();
    if (!folder) {
      this.decorator.set(
        uri,
        getWorkspaceCheckoutState(item, userId),
        item.synchronizationInfo?.checkedOutByDisplayName ??
          item.synchronizationInfo?.checkedOutBy,
      );
    }
    return {
      id: item.path,
      label: item.name,
      resourceUri: uri,
      tooltip: item.path,
      iconPath: this.iconFor(item),
      contextValue: buildWorkspaceContextValue(item, userId),
      collapsibleState: folder
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      command: folder
        ? undefined
        : { command: "vscode.open", title: "Open", arguments: [uri] },
    };
  }

  private iconFor(item: WorkspaceItem): ThemeIcon | { light: Uri; dark: Uri } {
    if (isWorkspaceFolder(item)) {
      return ThemeIcon.Folder;
    }
    const icon = workspaceIconName(item.name);
    return icon
      ? {
          light: Uri.joinPath(
            this.extensionUri,
            "icons",
            "light",
            `${icon}Light.svg`,
          ),
          dark: Uri.joinPath(
            this.extensionUri,
            "icons",
            "dark",
            `${icon}Dark.svg`,
          ),
        }
      : ThemeIcon.File;
  }

  // --- FileSystemProvider ---

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    try {
      const item = await this.model.getItem(uri.path);
      const time = item.modifiedTimeStamp
        ? new Date(item.modifiedTimeStamp).getTime()
        : 0;
      return {
        type: FileType.File,
        ctime: time,
        mtime: time,
        size: item.size ?? 0,
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

  /** Save the editor's content to the workspace. */
  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    try {
      await this.model.saveContent(uri.path, content);
    } catch (error) {
      this.log(
        l10n.t(Messages.SaveError, {
          name: uri.path,
          message: errorMessage(error),
        }),
      );
      throw error;
    }
    this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri }]);
    this.refreshSoon();
  }

  // Saving changes what the server says about a file (its modification time
  // and synchronization state). Typing and saving in bursts is common, so the
  // tree is refreshed once the saving stops.
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private refreshSoon(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 1000);
  }

  readDirectory(): [string, FileType][] {
    return [];
  }

  createDirectory(): void {
    throw FileSystemError.NoPermissions();
  }

  delete(): void {
    throw FileSystemError.NoPermissions();
  }

  rename(): void {
    throw FileSystemError.NoPermissions();
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeFile.dispose();
  }
}

function notFoundOr(error: unknown, uri: Uri): unknown {
  return isAxiosError(error) && error.response?.status === 404
    ? FileSystemError.FileNotFound(uri)
    : error;
}
