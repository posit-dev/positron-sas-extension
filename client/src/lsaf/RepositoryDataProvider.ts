// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF Repository view, and the read-only file system (`sasLsaf:`) that
// opens its files and their versions.
import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FilePermission,
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
import { RepositoryModel } from "./RepositoryModel";
import { LsafSession } from "./auth";
import { REPOSITORY_VIEW_ID } from "./const";
import {
  checkoutState,
  containerIcon,
  fileIcon,
  isContainer,
  isSigned,
  repositoryContextValue,
  sortItems,
  versionLabel,
} from "./items";
import { Messages } from "./messages";
import type { RepositoryItem } from "./types";
import { CheckoutDecorator, iconPath, repositoryUri, versionOf } from "./uris";

const time = (value: string | undefined) =>
  value ? new Date(value).getTime() || 0 : 0;

export class RepositoryDataProvider
  implements TreeDataProvider<RepositoryItem>, FileSystemProvider, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    RepositoryItem | undefined
  >();
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly onDidChangeFile: Event<FileChangeEvent[]> =
    this._onDidChangeFile.event;
  readonly treeView: TreeView<RepositoryItem>;

  constructor(
    private readonly model: RepositoryModel,
    private readonly session: LsafSession,
    private readonly decorator: CheckoutDecorator,
    private readonly extensionUri: Uri,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(REPOSITORY_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: true,
    });
  }

  refresh(): void {
    this.treeView.message = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Tell open editors that repository files changed, e.g. after a check-in. */
  notifyChanged(paths: string[]): void {
    this._onDidChangeFile.fire(
      paths.map((path) => ({
        type: FileChangeType.Changed,
        uri: repositoryUri(path),
      })),
    );
  }

  /** The clicked item plus any other selected items. */
  selection(item: RepositoryItem | undefined): RepositoryItem[] {
    const selected = this.treeView.selection;
    if (!item) {
      return [...selected];
    }
    return selected.some((s) => s.path === item.path) ? [...selected] : [item];
  }

  async getChildren(item?: RepositoryItem): Promise<RepositoryItem[]> {
    if (!this.session.signedIn) {
      return [];
    }
    const path = item?.path ?? "/";
    try {
      const children = await this.model.getChildren(path, (count) =>
        this.log(
          `Listing ${path} returned ${count} items, the most the API returns; there may be more.`,
        ),
      );
      return sortItems(children, isContainer);
    } catch (error) {
      const message = l10n.t(Messages.ListError, {
        message: describeError(error),
      });
      this.log(message);
      if (!item) {
        this.treeView.message = message;
      }
      return [];
    }
  }

  getTreeItem(item: RepositoryItem): TreeItem {
    const container = isContainer(item);
    const uri = repositoryUri(item.path);
    const state = checkoutState(item, this.session.userId);
    if (!container) {
      this.decorator.set(uri, state, item.checkedOutBy);
    }
    const description = [
      versionLabel(item),
      isSigned(item) ? Messages.Signed : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `repo:${item.path}`,
      label: item.name,
      description: description || undefined,
      resourceUri: uri,
      tooltip:
        state === "none"
          ? item.path
          : `${item.path}\n${
              state === "self"
                ? Messages.CheckedOutBySelf
                : l10n.t(Messages.CheckedOutBy, {
                    user: item.checkedOutBy ?? "?",
                  })
            }`,
      iconPath: iconPath(
        this.extensionUri,
        container ? containerIcon(item) : fileIcon(item.path),
      ),
      contextValue: repositoryContextValue(item, this.session.userId),
      collapsibleState: container
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      command: container ? undefined : openCommand(uri),
    };
  }

  // --- FileSystemProvider (read-only) ---

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    const version = versionOf(uri);
    try {
      const item = await this.model.getFileProperties(uri.path, version);
      return {
        type: FileType.File,
        ctime: time(item.created),
        mtime: time(item.lastModified),
        size: item.size ?? 0,
        permissions: FilePermission.Readonly,
      };
    } catch (error) {
      if (!isNotFound(error) || version) {
        throw notFoundOr(error, uri);
      }
    }
    try {
      const item = await this.model.getContainerProperties(uri.path);
      return {
        type: FileType.Directory,
        ctime: time(item.created),
        mtime: time(item.lastModified),
        size: 0,
        permissions: FilePermission.Readonly,
      };
    } catch (error) {
      throw notFoundOr(error, uri);
    }
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    try {
      return await this.model.getContent(uri.path, versionOf(uri));
    } catch (error) {
      throw notFoundOr(error, uri);
    }
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const children = await this.model.getChildren(uri.path);
    return children.map((child) => [
      child.name ?? "",
      isContainer(child) ? FileType.Directory : FileType.File,
    ]);
  }

  createDirectory(): void {
    throw FileSystemError.NoPermissions(Messages.RepositoryReadOnly);
  }

  writeFile(): void {
    throw FileSystemError.NoPermissions(Messages.RepositoryReadOnly);
  }

  delete(): void {
    throw FileSystemError.NoPermissions(Messages.NoDeleteOrRename);
  }

  rename(): void {
    throw FileSystemError.NoPermissions(Messages.NoDeleteOrRename);
  }

  dispose(): void {
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeFile.dispose();
  }
}

export function notFoundOr(error: unknown, uri: Uri): unknown {
  return isNotFound(error) ? FileSystemError.FileNotFound(uri) : error;
}
