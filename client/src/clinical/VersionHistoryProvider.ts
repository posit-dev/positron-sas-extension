// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/VersionHistoryProvider.ts
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
  MarkdownString,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeView,
  Uri,
  env,
  l10n,
  window,
} from "vscode";

import { RepositoryModel } from "./RepositoryModel";
import { VERSIONS_VIEW_ID, VERSION_SCHEME } from "./const";
import { Messages, errorMessage } from "./messages";
import { formatBytes, formatDate } from "./properties";
import type { RepositoryItem, VersionHistoryItem, VersionRow } from "./types";
import { isContainer, sortVersions, versionFileName } from "./utils";

/** URI of one version: `sasClinicalVersion:/<name>-v<version>.<ext>?id=&version=`. */
export function getVersionUri(row: VersionRow): Uri {
  return Uri.from({
    scheme: VERSION_SCHEME,
    path: `/${versionFileName(row.name, row.fileVersion)}`,
    query: new URLSearchParams({
      id: row.fileId,
      version: row.fileVersion,
    }).toString(),
  });
}

function parseVersionUri(uri: Uri): { id: string; version: string } {
  const query = new URLSearchParams(uri.query);
  return { id: query.get("id") ?? "", version: query.get("version") ?? "" };
}

/** The Version History view: the versions of the file selected in the repository. */
export class VersionHistoryProvider
  implements TreeDataProvider<VersionRow>, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    VersionRow | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly treeView: TreeView<VersionRow>;
  private rows: VersionRow[] = [];
  // Drops the result of a listing that a newer selection has overtaken.
  private generation = 0;

  constructor(
    private readonly model: RepositoryModel,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(VERSIONS_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
    this.clear();
  }

  /** The clicked version plus any other selected versions. */
  selection(row: VersionRow | undefined): VersionRow[] {
    const selected = this.treeView.selection;
    if (!row) {
      return [...selected];
    }
    return selected.some(
      (s) => s.fileId === row.fileId && s.fileVersion === row.fileVersion,
    )
      ? [...selected]
      : [row];
  }

  clear(message: string = Messages.NoVersionHistory): void {
    this.generation++;
    this.rows = [];
    this.treeView.description = undefined;
    this.treeView.message = message;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** List the versions of `item` (which must be up to date). */
  async show(item: RepositoryItem | undefined): Promise<void> {
    if (!item || isContainer(item)) {
      this.clear();
      return;
    }
    if (!item.versioned) {
      this.clear(Messages.NotVersioned);
      this.treeView.description = item.name;
      return;
    }
    const generation = ++this.generation;
    try {
      const versions = await this.model.getVersions(item, (reason) =>
        this.log(
          `Listing the versions of ${item.path} was truncated: ${reason}`,
        ),
      );
      if (generation !== this.generation) {
        return;
      }
      this.rows = sortVersions(versions).map((version) => ({
        ...version,
        fileId: version.fileId || item.id,
        name: item.name,
        path: item.path,
      }));
      this.treeView.message = undefined;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      const message = l10n.t(Messages.VersionListError, {
        message: errorMessage(error),
      });
      this.log(message);
      this.rows = [];
      this.treeView.message = message;
    }
    this.treeView.description = item.name;
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(): VersionRow[] {
    return this.rows;
  }

  getTreeItem(row: VersionRow): TreeItem {
    return {
      id: `${row.fileId}--${row.fileVersion}`,
      label: `v${row.fileVersion}`,
      description: row.comment,
      iconPath: new ThemeIcon("git-commit"),
      contextValue: ";version;",
      tooltip: versionTooltip(row),
      command: {
        command: "vscode.open",
        title: "Open Version",
        arguments: [getVersionUri(row)],
      },
    };
  }

  /** The list may lack author or size, so fetch the details when hovered. */
  async resolveTreeItem(item: TreeItem, row: VersionRow): Promise<TreeItem> {
    try {
      const details = await this.model.getVersion(row.fileId, row.fileVersion);
      item.tooltip = versionTooltip({ ...row, ...details });
    } catch (error) {
      this.log(
        `Unable to load version ${row.fileVersion}: ${errorMessage(error)}`,
      );
    }
    return item;
  }

  dispose(): void {
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

function versionTooltip(version: VersionHistoryItem): MarkdownString {
  const tooltip = new MarkdownString();
  const line = (label: string, value: string | undefined) => {
    if (value) {
      tooltip.appendMarkdown(`**${label}**  \n`).appendText(value);
      tooltip.appendMarkdown("\n\n");
    }
  };
  line(
    Messages.VersionCreatedBy,
    version.modifiedByDisplayName ?? version.createdByDisplayName,
  );
  line(
    Messages.VersionDate,
    formatDate(
      version.modifiedTimeStamp ?? version.creationTimeStamp,
      env.language,
    ),
  );
  const size = version.fileSize ?? version.size;
  line(Messages.VersionSize, size === undefined ? "" : formatBytes(size));
  line(Messages.VersionCommentLabel, version.comment);
  return tooltip;
}

/** Read-only file system behind `sasClinicalVersion:` URIs. */
export class VersionFileSystemProvider implements FileSystemProvider {
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> =
    this._onDidChangeFile.event;

  constructor(private readonly model: RepositoryModel) {}

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    const { id, version } = parseVersionUri(uri);
    const details = await this.model.getVersion(id, version);
    const time = new Date(
      details.modifiedTimeStamp ?? details.creationTimeStamp ?? 0,
    ).getTime();
    return {
      type: FileType.File,
      ctime: time || 0,
      mtime: time || 0,
      size: details.fileSize ?? details.size ?? 0,
      permissions: FilePermission.Readonly,
    };
  }

  readFile(uri: Uri): Promise<Uint8Array> {
    const { id, version } = parseVersionUri(uri);
    return this.model.getVersionContent(id, version);
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
}
