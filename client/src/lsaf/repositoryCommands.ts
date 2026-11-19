// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Repository view commands that only read: Properties, Version History,
// Download and Copy Path.
import {
  Disposable,
  LogOutputChannel,
  ProgressLocation,
  QuickPickItem,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import { ReportPresenter } from "../clinical/report/ReportPresenter";
import { describeError } from "./LsafClient";
import { RepositoryDataProvider } from "./RepositoryDataProvider";
import { RepositoryModel } from "./RepositoryModel";
import {
  WorkspaceDataProvider,
  WorkspaceNode,
  isWorkspaceNode,
} from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { LsafSession } from "./auth";
import { REPOSITORY_SCHEME, WORKSPACE_SCHEME } from "./const";
import { isContainer, isWorkspaceFolder } from "./items";
import { Messages } from "./messages";
import { baseName } from "./paths";
import { renderPropertiesReport } from "./propertiesReport";
import type { FileSignature, FileVersion, RepositoryItem } from "./types";
import { lsafLocation, repositoryUri, workspaceUri } from "./uris";

/** What a command was invoked on: a tree item, or an editor's URI. */
export type ItemArg = RepositoryItem | Uri | undefined;

export class RepositoryCommands implements Disposable {
  private readonly presenter: ReportPresenter;
  private readonly disposables: Disposable[];

  constructor(
    private readonly provider: RepositoryDataProvider,
    private readonly model: RepositoryModel,
    private readonly workspaceView: WorkspaceDataProvider,
    private readonly workspaceModel: WorkspaceModel,
    private readonly session: LsafSession,
    private readonly output: LogOutputChannel,
  ) {
    this.presenter = new ReportPresenter(
      output,
      "SAS.lsaf.report",
      "LSAF",
      new Set([REPOSITORY_SCHEME, WORKSPACE_SCHEME]),
    );
    this.disposables = [
      this.presenter,
      commands.registerCommand("SAS.lsaf.showProperties", (item: ItemArg) =>
        this.run(() => this.showProperties(item)),
      ),
      commands.registerCommand("SAS.lsaf.showVersions", (item: ItemArg) =>
        this.run(() => this.showVersions(item)),
      ),
      commands.registerCommand(
        "SAS.lsaf.download",
        (item: RepositoryItem | WorkspaceNode) =>
          this.run(() => this.download(item)),
      ),
      commands.registerCommand("SAS.lsaf.copyPath", (item: { path: string }) =>
        env.clipboard.writeText(item?.path ?? ""),
      ),
    ];
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = describeError(error);
      this.output.error(message);
      window.showErrorMessage(message);
    }
  }

  /** The repository item a command acts on. */
  private async resolve(arg: ItemArg): Promise<RepositoryItem | undefined> {
    if (arg instanceof Uri) {
      const location = lsafLocation(arg);
      if (!location) {
        return undefined;
      }
      return this.model.getFileProperties(location.path);
    }
    return arg ?? this.provider.treeView.selection[0];
  }

  async showProperties(arg: ItemArg): Promise<void> {
    const selected = await this.resolve(arg);
    if (!selected) {
      return;
    }
    const container = isContainer(selected);
    const item = container
      ? await this.model.getContainerProperties(selected.path)
      : await this.model.getFileProperties(selected.path);
    let versions: FileVersion[] = [];
    let signatures: FileSignature[] = [];
    if (!container) {
      // Either may be refused (permissions, unversioned files on some
      // servers); the rest of the report is still worth showing.
      [versions, signatures] = await Promise.all([
        this.model.getVersions(item.path).catch((error) => {
          this.output.warn(`Versions of ${item.path}: ${describeError(error)}`);
          return [];
        }),
        this.model.getSignatures(item.path).catch((error) => {
          this.output.warn(
            `Signatures of ${item.path}: ${describeError(error)}`,
          );
          return [];
        }),
      ]);
    }
    await this.presenter.show({
      title: l10n.t(Messages.PropertiesTitle, { name: item.name }),
      name: `lsaf-properties-${item.name}`,
      render: (links) =>
        renderPropertiesReport({
          item,
          versions: item.versioned ? versions : [],
          signatures,
          userId: this.session.userId,
          versionLink: links
            ? (version) =>
                ReportPresenter.linkTo(repositoryUri(item.path, version))
            : undefined,
        }),
    });
  }

  async showVersions(arg: ItemArg): Promise<void> {
    const item = await this.resolve(arg);
    if (!item || isContainer(item)) {
      return;
    }
    const versions = await this.model.getVersions(item.path);
    if (!versions.length) {
      window.showInformationMessage(
        l10n.t(Messages.NoVersions, { name: item.name }),
      );
      return;
    }
    interface VersionPick extends QuickPickItem {
      version: FileVersion;
    }
    const picked = await window.showQuickPick<VersionPick>(
      [...versions].reverse().map((version) => ({
        label: version.latest
          ? l10n.t(Messages.LatestVersion, { version: version.version })
          : version.version,
        description: [version.createdBy, version.created]
          .filter(Boolean)
          .join(" · "),
        detail: version.comment,
        version,
      })),
      {
        title: l10n.t(Messages.VersionsTitle, { name: item.name }),
        placeHolder: Messages.PickVersion,
      },
    );
    if (!picked) {
      return;
    }
    const version = picked.version.version;
    const versionUri = repositoryUri(item.path, version);
    const latest = versions.find((v) => v.latest)?.version;
    const inWorkspace = await workspace.fs.stat(workspaceUri(item.path)).then(
      () => true,
      () => false,
    );
    const actions = [
      { label: Messages.OpenVersion, id: "open" },
      ...(latest && latest !== version
        ? [{ label: Messages.CompareWithLatest, id: "latest" }]
        : []),
      ...(inWorkspace
        ? [{ label: Messages.CompareWithWorkspace, id: "workspace" }]
        : []),
    ];
    const action =
      actions.length === 1
        ? actions[0]
        : await window.showQuickPick(actions, {
            title: l10n.t(Messages.VersionActionTitle, {
              name: item.name,
              version,
            }),
          });
    switch (action?.id) {
      case "open":
        await commands.executeCommand("vscode.open", versionUri, {
          preview: false,
        });
        break;
      case "latest":
        await commands.executeCommand(
          "vscode.diff",
          versionUri,
          repositoryUri(item.path, latest),
          `${item.name} (${version} ↔ ${latest})`,
        );
        break;
      case "workspace":
        await commands.executeCommand(
          "vscode.diff",
          versionUri,
          workspaceUri(item.path),
          l10n.t(Messages.VersionVsWorkspace, { name: item.name, version }),
        );
        break;
    }
  }

  async download(arg: RepositoryItem | WorkspaceNode | undefined) {
    const items: Array<{
      name: string;
      folder: boolean;
      content: () => Promise<Uint8Array>;
    }> = isWorkspaceNode(arg)
      ? this.workspaceView.selection(arg).map((node) => ({
          name: node.name ?? baseName(node.path),
          folder: isWorkspaceFolder(node),
          content: () =>
            isWorkspaceFolder(node)
              ? this.workspaceModel.downloadFolder(node.path)
              : this.workspaceModel.getContent(node.path),
        }))
      : this.provider.selection(arg).map((item) => ({
          name: item.name ?? baseName(item.path),
          folder: isContainer(item),
          content: () =>
            isContainer(item)
              ? this.model.downloadContainer(item.path)
              : this.model.getContent(item.path),
        }));
    if (!items.length) {
      return;
    }
    const fileName = (each: (typeof items)[number]) =>
      each.folder ? `${each.name}.zip` : each.name;
    if (items.length === 1) {
      const only = items[0];
      const target = await window.showSaveDialog({
        title: Messages.DownloadTitle,
        defaultUri: defaultTarget(fileName(only)),
      });
      if (!target) {
        return;
      }
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: l10n.t(Messages.Downloading, { name: only.name }),
        },
        async () => workspace.fs.writeFile(target, await only.content()),
      );
      return;
    }
    const folder = await window.showOpenDialog({
      title: Messages.DownloadTitle,
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: Messages.DownloadHere,
      defaultUri: workspace.workspaceFolders?.[0]?.uri,
    });
    if (!folder?.[0]) {
      return;
    }
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: l10n.t(Messages.DownloadingCount, { count: items.length }),
      },
      async () => {
        for (const each of items) {
          await workspace.fs.writeFile(
            Uri.joinPath(folder[0], fileName(each)),
            await each.content(),
          );
        }
      },
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** A file name in the first workspace folder, for save dialogs. */
export function defaultTarget(name: string): Uri | undefined {
  const folder = workspace.workspaceFolders?.[0]?.uri;
  return folder ? Uri.joinPath(folder, name) : undefined;
}
