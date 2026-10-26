// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/RepositoryDataProvider.ts
// (Apache-2.0).
import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FilePermission,
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

import { RepositoryDecorator } from "./RepositoryDecorator";
import { RepositoryModel } from "./RepositoryModel";
import { CLINICAL_SCHEME, VIEW_ID } from "./const";
import { Messages, errorMessage } from "./messages";
import type { RepositoryItem } from "./types";
import {
  buildContextValue,
  extractSingleZipEntry,
  getCheckoutState,
  isContainer,
  isZip,
} from "./utils";

/** Stable URI of a repository item: `sasClinical:/<path>?id=<id>`. */
export function getItemUri(item: RepositoryItem): Uri {
  return Uri.from({
    scheme: CLINICAL_SCHEME,
    path: item.path || `/${item.name}`,
    query: `id=${encodeURIComponent(item.id)}`,
  });
}

export function getItemId(uri: Uri): string {
  return new URLSearchParams(uri.query).get("id") ?? "";
}

const SAS_PROGRAM_TYPES = new Set(["sasprogram", "sasProgram"]);
const SAS_DATASET_TYPES = new Set(["sasdataset", "sasDataSet", "sasview"]);

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
    private readonly decorator: RepositoryDecorator,
    private readonly extensionUri: Uri,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: false,
    });
  }

  refresh(): void {
    this.treeView.message = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** The clicked item plus any other selected items. */
  selection(item: RepositoryItem | undefined): RepositoryItem[] {
    const selected = this.treeView.selection;
    if (!item) {
      return [...selected];
    }
    return selected.some((s) => s.id === item.id) ? [...selected] : [item];
  }

  async getChildren(item?: RepositoryItem): Promise<RepositoryItem[]> {
    try {
      const children = await this.model.getChildren(item, (reason) =>
        this.log(`Listing ${item?.path ?? "/"} was truncated: ${reason}`),
      );
      return children.sort(
        (a, b) =>
          Number(isContainer(b)) - Number(isContainer(a)) ||
          a.name.localeCompare(b.name),
      );
    } catch (error) {
      const message = l10n.t(Messages.ListError, {
        message: errorMessage(error),
      });
      this.log(message);
      if (!item) {
        this.treeView.message = message;
      }
      return [];
    }
  }

  async getTreeItem(item: RepositoryItem): Promise<TreeItem> {
    const container = isContainer(item);
    const uri = getItemUri(item);
    const type = await this.model.getObjectType(item.typeId);
    const userId = await this.model.getCurrentUserId();
    if (!container) {
      this.decorator.set(
        uri,
        getCheckoutState(item, userId),
        item.checkedOutByDisplayName ?? item.checkedOutBy,
      );
    }
    return {
      id: item.id,
      label: item.name,
      resourceUri: uri,
      tooltip: item.path,
      iconPath: this.iconFor(item, type?.name),
      contextValue: buildContextValue(item, type, userId),
      collapsibleState: container
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      command: container
        ? undefined
        : {
            command: "vscode.open",
            title: "Open",
            arguments: [uri],
          },
    };
  }

  private iconFor(
    item: RepositoryItem,
    typeName: string | undefined,
  ): ThemeIcon | { light: Uri; dark: Uri } {
    const svg = (name: string) => ({
      light: Uri.joinPath(
        this.extensionUri,
        "icons",
        "light",
        `${name}Light.svg`,
      ),
      dark: Uri.joinPath(this.extensionUri, "icons", "dark", `${name}Dark.svg`),
    });
    const typeId = item.typeId ?? "";
    if (item.primaryType === "CONTEXT") {
      return /study/i.test(typeId) || /study/i.test(typeName ?? "")
        ? new ThemeIcon("project")
        : new ThemeIcon("organization");
    }
    if (item.primaryType === "FOLDER") {
      return ThemeIcon.Folder;
    }
    if (SAS_PROGRAM_TYPES.has(typeId)) {
      return svg("sasProgramFile");
    }
    if (SAS_DATASET_TYPES.has(typeId)) {
      return svg("sasDataSet");
    }
    const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      case "sas":
        return svg("sasProgramFile");
      case "sas7bdat":
      case "xpt":
        return svg("sasDataSet");
      case "pdf":
        return new ThemeIcon("file-pdf");
      case "zip":
        return new ThemeIcon("file-zip");
      case "log":
      case "lst":
        return new ThemeIcon("output");
      default:
        return ThemeIcon.File;
    }
  }

  // --- FileSystemProvider (read-only) ---

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    const item = await this.model.getItem(getItemId(uri));
    return {
      type: isContainer(item) ? FileType.Directory : FileType.File,
      ctime: item.creationTimeStamp
        ? new Date(item.creationTimeStamp).getTime()
        : 0,
      mtime: item.modifiedTimeStamp
        ? new Date(item.modifiedTimeStamp).getTime()
        : 0,
      size: item.size ?? 0,
      permissions: FilePermission.Readonly,
    };
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    const content = await this.model.getContent(getItemId(uri));
    // Some servers wrap even a single file in a zip archive.
    return (isZip(content) && extractSingleZipEntry(content)) || content;
  }

  readDirectory(): [string, FileType][] {
    return [];
  }

  createDirectory(): void {
    throw FileSystemError.NoPermissions();
  }

  writeFile(): void {
    throw FileSystemError.NoPermissions();
  }

  delete(): void {
    throw FileSystemError.NoPermissions();
  }

  rename(): void {
    throw FileSystemError.NoPermissions();
  }

  dispose(): void {
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeFile.dispose();
  }
}
