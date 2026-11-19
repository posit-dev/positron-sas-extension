// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Commands that change files, from either LSAF view: check out, check in,
// undo check-out, copy to the workspace, add to the repository, upload, and
// new files and folders.
import {
  Disposable,
  LogOutputChannel,
  ProgressLocation,
  QuickPickItem,
  commands,
  l10n,
  window,
  workspace,
} from "vscode";

import { describeError } from "./LsafClient";
import { RepositoryDataProvider } from "./RepositoryDataProvider";
import { RepositoryModel } from "./RepositoryModel";
import {
  WorkspaceDataProvider,
  WorkspaceNode,
  isWorkspaceNode,
} from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { isContainer, isWorkspaceFolder } from "./items";
import { Messages } from "./messages";
import { baseName, joinPath } from "./paths";
import type { RepositoryItem } from "./types";
import { repositoryUri, workspaceUri } from "./uris";

type Item = RepositoryItem | WorkspaceNode;

const VERSION_PATTERN = /^\d{1,5}\.\d{1,5}$/;
const MAX_COMMENT = 1024;

/** A versioning choice: `version` is the API value, undefined for none. */
interface VersionChoice {
  version: string | undefined;
}

export class WorkspaceCommands implements Disposable {
  private readonly disposables: Disposable[];

  constructor(
    private readonly repositoryView: RepositoryDataProvider,
    private readonly workspaceView: WorkspaceDataProvider,
    private readonly repository: RepositoryModel,
    private readonly workspaceModel: WorkspaceModel,
    private readonly output: LogOutputChannel,
    private readonly refreshAll: () => void,
  ) {
    const register = (id: string, action: (item: Item) => Promise<void>) =>
      commands.registerCommand(id, (item: Item) =>
        this.run(() => action(item)),
      );
    this.disposables = [
      register("SAS.lsaf.checkOut", (item) => this.checkOut(item)),
      register("SAS.lsaf.checkIn", (item) => this.checkIn(item)),
      register("SAS.lsaf.undoCheckOut", (item) => this.undoCheckOut(item)),
      register("SAS.lsaf.copyToWorkspace", (item) =>
        this.copyToWorkspace(item),
      ),
      register("SAS.lsaf.addToRepository", (item) =>
        this.addToRepository(item),
      ),
      register("SAS.lsaf.compareWithRepository", (item) =>
        this.compareWithRepository(item),
      ),
      register("SAS.lsaf.upload", (item) => this.upload(item)),
      register("SAS.lsaf.newFile", (item) => this.newFile(item)),
      register("SAS.lsaf.newFolder", (item) => this.newFolder(item)),
    ];
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = describeError(error);
      this.output.error(message);
      window.showErrorMessage(message);
    } finally {
      this.refreshAll();
    }
  }

  /** The clicked item plus the other selected ones, in its view. */
  private selection(item: Item | undefined): Item[] {
    return isWorkspaceNode(item)
      ? this.workspaceView.selection(item)
      : this.repositoryView.selection(item);
  }

  private selectedFiles(item: Item | undefined): Item[] {
    return this.selection(item).filter((each) =>
      isWorkspaceNode(each) ? !isWorkspaceFolder(each) : !isContainer(each),
    );
  }

  /** Run an action on each path, then report what failed. */
  private async forEach(
    title: string,
    paths: string[],
    action: (path: string) => Promise<void>,
  ): Promise<string[]> {
    const done: string[] = [];
    const failed: string[] = [];
    await window.withProgress(
      { location: ProgressLocation.Notification, title },
      async () => {
        for (const path of paths) {
          try {
            await action(path);
            done.push(path);
          } catch (error) {
            const message = `${path}: ${describeError(error)}`;
            this.output.error(message);
            failed.push(message);
          }
        }
      },
    );
    if (failed.length) {
      window.showErrorMessage(failed.join("\n"));
    }
    return done;
  }

  async checkOut(item: Item): Promise<void> {
    const paths = this.selectedFiles(item).map((each) => each.path);
    if (!paths.length) {
      return;
    }
    const existing = new Set<string>();
    for (const path of paths) {
      if (
        isWorkspaceNode(item) ||
        (await this.workspaceModel.fileExists(path))
      ) {
        existing.add(path);
      }
    }
    let replace = true;
    if (existing.size) {
      const keep = Messages.KeepWorkspaceCopy;
      const answer = await window.showWarningMessage(
        existing.size === 1
          ? l10n.t(Messages.CheckOutExistingOne, {
              name: baseName([...existing][0]),
            })
          : l10n.t(Messages.CheckOutExistingMany, { count: existing.size }),
        { modal: true },
        keep,
        Messages.ReplaceWorkspaceCopy,
      );
      if (!answer) {
        return;
      }
      replace = answer !== keep;
    }
    const done = await this.forEach(Messages.CheckingOut, paths, (path) =>
      this.repository.checkOut(path, replace || !existing.has(path)),
    );
    this.workspaceView.notifyChanged(done);
  }

  async checkIn(item: Item): Promise<void> {
    const files = this.selectedFiles(item);
    if (!files.length) {
      return;
    }
    // Check in what the editors show, not an older saved copy.
    for (const file of files) {
      const document = workspace.textDocuments.find(
        (d) => d.uri.toString() === workspaceUri(file.path).toString(),
      );
      if (document?.isDirty) {
        await document.save();
      }
    }
    const versioned = files.some((file) =>
      isWorkspaceNode(file) ? file.repository?.versioned : file.versioned,
    );
    let version: string | undefined;
    if (versioned) {
      const choice = await pickCheckInVersion();
      if (!choice) {
        return;
      }
      version = choice.version;
    }
    const comment = await askComment();
    if (comment === undefined) {
      return;
    }
    const done = await this.forEach(
      Messages.CheckingIn,
      files.map((file) => file.path),
      (path) => this.repository.checkIn(path, { version, comment }),
    );
    if (done.length) {
      window.showInformationMessage(
        l10n.t(Messages.CheckedIn, { count: done.length }),
      );
    }
    this.repositoryView.notifyChanged(done);
  }

  async undoCheckOut(item: Item): Promise<void> {
    const paths = this.selectedFiles(item).map((each) => each.path);
    if (!paths.length) {
      return;
    }
    const answer = await window.showWarningMessage(
      paths.length === 1
        ? l10n.t(Messages.UndoCheckOutOne, { name: baseName(paths[0]) })
        : l10n.t(Messages.UndoCheckOutMany, { count: paths.length }),
      { modal: true },
      Messages.UndoCheckOut,
    );
    if (answer !== Messages.UndoCheckOut) {
      return;
    }
    const done = await this.forEach(Messages.UndoingCheckOut, paths, (path) =>
      this.repository.undoCheckOut(path),
    );
    this.workspaceView.notifyChanged(done);
  }

  /** Copy repository files to the workspace without checking them out. */
  async copyToWorkspace(item: Item): Promise<void> {
    const paths = this.selectedFiles(item).map((each) => each.path);
    if (!paths.length) {
      return;
    }
    const existing: string[] = [];
    for (const path of paths) {
      if (await this.workspaceModel.fileExists(path)) {
        existing.push(path);
      }
    }
    if (existing.length) {
      const answer = await window.showWarningMessage(
        l10n.t(Messages.ReplaceInWorkspace, {
          names: existing.map(baseName).join(", "),
        }),
        { modal: true },
        Messages.Replace,
      );
      if (answer !== Messages.Replace) {
        return;
      }
    }
    const done = await this.forEach(Messages.Copying, paths, async (path) => {
      const content = await this.repository.getContent(path);
      await this.workspaceModel.write(path, content, {
        overwrite: true,
        createParents: true,
      });
    });
    this.workspaceView.notifyChanged(done);
  }

  /** Add workspace files that aren't in the repository yet. */
  async addToRepository(item: Item): Promise<void> {
    const files = this.selectedFiles(item).filter(
      (file) => isWorkspaceNode(file) && file.repository === undefined,
    );
    if (!files.length) {
      return;
    }
    const choice = await pickNewFileVersioning();
    if (!choice) {
      return;
    }
    const comment = await askComment();
    if (comment === undefined) {
      return;
    }
    const done = await this.forEach(
      Messages.AddingToRepository,
      files.map((file) => file.path),
      async (path) => {
        const content = await this.workspaceModel.getContent(path);
        await this.repository.upload(path, baseName(path), content, {
          version: choice.version,
          comment,
          createParents: true,
        });
      },
    );
    if (done.length) {
      window.showInformationMessage(
        l10n.t(Messages.AddedToRepository, { count: done.length }),
      );
    }
  }

  async compareWithRepository(item: Item): Promise<void> {
    if (!item) {
      return;
    }
    await commands.executeCommand(
      "vscode.diff",
      repositoryUri(item.path),
      workspaceUri(item.path),
      l10n.t(Messages.RepositoryVsWorkspace, { name: baseName(item.path) }),
    );
  }

  /** Upload local files into a workspace folder or repository container. */
  async upload(target: Item): Promise<void> {
    if (!target) {
      return;
    }
    const toWorkspace = isWorkspaceNode(target);
    const files = await window.showOpenDialog({
      title: l10n.t(Messages.UploadTitle, { folder: target.path }),
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: Messages.Upload,
    });
    if (!files?.length) {
      return;
    }
    const children: Array<{ path: string }> = toWorkspace
      ? await this.workspaceModel.getChildren(target.path)
      : await this.repository.getChildren(target.path);
    const existingByPath = new Set(children.map((child) => child.path));
    const targets = files.map((file) => ({
      file,
      path: joinPath(target.path, baseName(file.path)),
    }));
    const existing = targets.filter((t) => existingByPath.has(t.path));
    if (existing.length) {
      const answer = await window.showWarningMessage(
        l10n.t(
          toWorkspace
            ? Messages.ReplaceInWorkspace
            : Messages.ReplaceInRepository,
          { names: existing.map((t) => baseName(t.path)).join(", ") },
        ),
        { modal: true },
        Messages.Replace,
      );
      if (answer !== Messages.Replace) {
        return;
      }
    }
    let versioning: VersionChoice = { version: undefined };
    let comment = "";
    if (!toWorkspace) {
      if (existing.length < targets.length) {
        const choice = await pickNewFileVersioning();
        if (!choice) {
          return;
        }
        versioning = choice;
      }
      const answer = await askComment();
      if (answer === undefined) {
        return;
      }
      comment = answer;
    }
    await this.forEach(
      Messages.Uploading,
      targets.map((t) => t.path),
      async (path) => {
        const source = targets.find((t) => t.path === path)?.file;
        const content = await workspace.fs.readFile(source);
        if (toWorkspace) {
          await this.workspaceModel.write(path, content, { overwrite: true });
        } else {
          const isNew = !existingByPath.has(path);
          await this.repository.upload(path, baseName(path), content, {
            // An existing versioned file gets the server's next version.
            version: isNew ? versioning.version : undefined,
            comment,
            overwrite: true,
          });
        }
      },
    );
  }

  async newFile(folder: Item): Promise<void> {
    if (!isWorkspaceNode(folder)) {
      return;
    }
    const name = await window.showInputBox({
      title: l10n.t(Messages.NewFileTitle, { folder: folder.path }),
      prompt: Messages.NewFilePrompt,
      validateInput: validateName,
    });
    if (!name) {
      return;
    }
    const path = joinPath(folder.path, name.trim());
    await this.workspaceModel.write(path, new Uint8Array(), {
      overwrite: false,
      createParents: false,
    });
    this.workspaceView.refresh();
    await commands.executeCommand("vscode.open", workspaceUri(path));
  }

  async newFolder(folder: Item): Promise<void> {
    if (!isWorkspaceNode(folder)) {
      return;
    }
    const name = await window.showInputBox({
      title: l10n.t(Messages.NewFolderTitle, { folder: folder.path }),
      prompt: Messages.NewFolderPrompt,
      validateInput: validateName,
    });
    if (!name) {
      return;
    }
    await this.workspaceModel.createFolder(folder.path, name.trim());
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** A file or folder name: not empty, no slashes, not `.` or `..`. */
export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
    return Messages.InvalidName;
  }
  return undefined;
}

const validateVersion = (value: string) =>
  VERSION_PATTERN.test(value.trim()) ? undefined : Messages.VersionFormat;

interface VersionPick extends QuickPickItem {
  version?: string;
  custom?: boolean;
}

async function pickVersion(
  title: string,
  picks: VersionPick[],
): Promise<VersionChoice | undefined> {
  const picked = await window.showQuickPick(picks, { title });
  if (!picked) {
    return undefined;
  }
  if (!picked.custom) {
    return { version: picked.version };
  }
  const version = await window.showInputBox({
    title,
    prompt: Messages.VersionPrompt,
    validateInput: validateVersion,
  });
  return version ? { version: version.trim() } : undefined;
}

/** The version a check-in creates; the server's default is a major one. */
const pickCheckInVersion = () =>
  pickVersion(Messages.CheckInVersionTitle, [
    { label: Messages.MajorVersion, version: undefined },
    { label: Messages.MinorVersion, version: "MINOR" },
    { label: Messages.SpecificVersion, custom: true },
  ]);

/** Whether a new repository file is versioned, and from which version. */
const pickNewFileVersioning = () =>
  pickVersion(Messages.NewFileVersioningTitle, [
    { label: Messages.NotVersioned, version: undefined },
    { label: Messages.VersionedMajor, version: "MAJOR" },
    { label: Messages.VersionedMinor, version: "MINOR" },
    { label: Messages.VersionedSpecific, custom: true },
  ]);

/** An optional comment; undefined when cancelled. */
const askComment = () =>
  window.showInputBox({
    title: Messages.CommentTitle,
    prompt: Messages.CommentPrompt,
    validateInput: (value) =>
      value.length > MAX_COMMENT ? Messages.CommentTooLong : undefined,
  });
