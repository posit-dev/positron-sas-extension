// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/index.ts (Apache-2.0).
//
// What the Workspace view's commands do: prompts, progress, results. The
// requests themselves are in `WorkspaceModel`.
import {
  LogOutputChannel,
  ProgressLocation,
  QuickPickItem,
  Uri,
  commands,
  l10n,
  window,
  workspace,
} from "vscode";

import * as os from "os";

import {
  WorkspaceDataProvider,
  getWorkspaceUri,
} from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { BatchMessages, performBatchAction } from "./batchAction";
import { WORKSPACE_SCHEME } from "./const";
import { closeEditors } from "./editors";
import { Messages, errorMessage, toInputValidator } from "./messages";
import type { RepositoryItem, VersionRow, WorkspaceItem } from "./types";
import {
  CheckInAnswers,
  buildCheckInBody,
  downloadFileName,
  isSameOrUnder,
  isWorkspaceFolder,
  joinWorkspacePath,
  planCheckIn,
  validateComment,
  validateFileName,
  validateFolderName,
  validateVersion,
} from "./utils";

const COPY_MESSAGES: BatchMessages = {
  progress: Messages.CopyingMessage,
  success: Messages.CopySuccess,
  warn: Messages.CopyWarning,
  error: Messages.CopyError,
};

/** The parent folder of a workspace path ("/" for a top-level item). */
const parentOf = (path: string): string =>
  path.slice(0, path.lastIndexOf("/")) || "/";

export class WorkspaceActions {
  constructor(
    private readonly provider: WorkspaceDataProvider,
    private readonly model: WorkspaceModel,
    private readonly output: LogOutputChannel,
    // Refreshes every view that shows workspace or repository state.
    private readonly refresh: () => void,
  ) {}

  private fail(message: string): void {
    this.output.error(message);
    window.showErrorMessage(message);
  }

  /**
   * Where a new item goes: the folder that was clicked, the folder of a
   * clicked file, the first selected item likewise, or the workspace root.
   */
  private targetFolder(item: WorkspaceItem | undefined): string {
    const target = item ?? this.provider.selection(undefined)[0];
    if (!target) {
      return "/";
    }
    return isWorkspaceFolder(target) ? target.path : parentOf(target.path);
  }

  async newFile(item: WorkspaceItem | undefined): Promise<void> {
    const parent = this.targetFolder(item);
    const name = await window.showInputBox({
      prompt: Messages.NewFilePrompt,
      title: Messages.NewFileTitle,
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateFileName),
    });
    if (!name) {
      return;
    }
    try {
      const created = await this.model.createFile(parent, name);
      this.output.info(
        l10n.t(Messages.FileCreationSuccess, { name, location: parent }),
      );
      this.provider.refresh();
      await commands.executeCommand(
        "vscode.open",
        getWorkspaceUri(
          created.path ? created : { path: joinWorkspacePath(parent, name) },
        ),
      );
    } catch (error) {
      this.fail(
        l10n.t(Messages.FileCreationError, {
          name,
          location: parent,
          message: errorMessage(error),
        }),
      );
    }
  }

  async newFolder(item: WorkspaceItem | undefined): Promise<void> {
    const parent = this.targetFolder(item);
    const name = await window.showInputBox({
      prompt: Messages.NewFolderPrompt,
      title: Messages.NewFolderTitle,
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateFolderName),
    });
    if (!name) {
      return;
    }
    try {
      await this.model.createFolder(parent, name);
      this.output.info(
        l10n.t(Messages.FolderCreationSuccess, { name, location: parent }),
      );
      this.provider.refresh();
    } catch (error) {
      this.fail(
        l10n.t(Messages.FolderCreationError, {
          name,
          location: parent,
          message: errorMessage(error),
        }),
      );
    }
  }

  async rename(item: WorkspaceItem): Promise<void> {
    const folder = isWorkspaceFolder(item);
    const name = await window.showInputBox({
      prompt: Messages.RenamePrompt,
      title: folder ? Messages.RenameFolderTitle : Messages.RenameFileTitle,
      value: item.name,
      ignoreFocusOut: true,
      validateInput: toInputValidator(
        folder ? validateFolderName : validateFileName,
      ),
    });
    if (!name || name === item.name) {
      return;
    }
    try {
      const renamed = await this.model.rename(item, name);
      this.output.info(
        l10n.t(Messages.RenameSuccess, { oldName: item.name, newName: name }),
      );
      // Editors of the old name would save to a path that no longer exists.
      const hadEditor = await closeEditors(
        (uri) =>
          uri.scheme === WORKSPACE_SCHEME && isSameOrUnder(uri.path, item.path),
      );
      if (hadEditor && !folder) {
        await commands.executeCommand("vscode.open", getWorkspaceUri(renamed));
      }
      this.refresh();
    } catch (error) {
      this.fail(
        l10n.t(Messages.RenameError, {
          oldName: item.name,
          newName: name,
          message: errorMessage(error),
        }),
      );
    }
  }

  async delete(items: WorkspaceItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const answer = await window.showWarningMessage(
      items.length === 1
        ? l10n.t(Messages.DeleteConfirm, { name: items[0].name })
        : l10n.t(Messages.DeleteConfirmMany, { count: items.length }),
      { modal: true, detail: Messages.DeleteFromWorkspaceDetail },
      Messages.DeleteAction,
    );
    if (answer !== Messages.DeleteAction) {
      return;
    }
    await performBatchAction(
      (isCancelled) => this.model.delete(items, isCancelled),
      {
        progress: Messages.DeletingMessage,
        success: Messages.DeleteFromWorkspaceSuccess,
        warn: Messages.DeleteFromWorkspaceWarning,
        error: Messages.DeleteFromWorkspaceError,
      },
      this.output,
      () => {
        void closeEditors(
          (uri) =>
            uri.scheme === WORKSPACE_SCHEME &&
            items.some((item) => isSameOrUnder(uri.path, item.path)),
        );
        this.refresh();
      },
    );
  }

  async download(items: WorkspaceItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const target = await window.showSaveDialog({
      title: Messages.DownloadTitle,
      saveLabel: Messages.DownloadTitle,
      defaultUri: Uri.joinPath(
        Uri.file(os.homedir()),
        downloadFileName(
          items.map((i) => ({ name: i.name, primaryType: i.type })),
        ),
      ),
    });
    if (!target) {
      return;
    }
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: Messages.DownloadingMessage,
      },
      async () => {
        try {
          const content = await this.model.download(items, () => false);
          await workspace.fs.writeFile(target, content);
          this.output.info(
            l10n.t(Messages.DownloadedMessage, {
              name: items.map((i) => i.name).join(", "),
              location: target.fsPath,
            }),
          );
        } catch (error) {
          this.fail(
            l10n.t(Messages.DownloadError, { message: errorMessage(error) }),
          );
        }
      },
    );
  }

  async upload(
    item: WorkspaceItem | undefined,
    expand: boolean,
  ): Promise<void> {
    const parent = this.targetFolder(item);
    const files = await window.showOpenDialog({
      title: expand ? Messages.UploadAndExpandTitle : Messages.UploadTitle,
      openLabel: Messages.UploadTitle,
      defaultUri: Uri.file(os.homedir()),
      canSelectMany: !expand,
      filters: expand ? { "Zip File": ["zip"] } : undefined,
    });
    if (!files || files.length === 0) {
      return;
    }
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: Messages.UploadingMessage,
      },
      async () => {
        const results = await Promise.all(
          files.map(async (file) => {
            const name = file.path.split("/").pop() ?? file.fsPath;
            try {
              const content = await workspace.fs.readFile(file);
              await this.model.upload(
                parent,
                name,
                content,
                expand,
                () => false,
              );
              this.output.info(
                l10n.t(
                  expand
                    ? Messages.UploadedAndExpandedMessage
                    : Messages.UploadedMessage,
                  { name: file.fsPath, location: parent },
                ),
              );
              return true;
            } catch (error) {
              this.output.error(
                l10n.t(Messages.UploadErrorMessage, {
                  name: file.fsPath,
                  location: parent,
                  message: errorMessage(error),
                }),
              );
              return false;
            }
          }),
        );
        if (results.includes(false)) {
          window.showErrorMessage(Messages.UploadError);
          this.output.show(true);
        }
        if (results.includes(true)) {
          this.provider.refresh();
        }
      },
    );
  }

  async undoCheckout(items: WorkspaceItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await performBatchAction(
      (isCancelled) => this.model.undoCheckout(items, isCancelled),
      {
        progress: Messages.UndoCheckOutMessage,
        success: Messages.UndoCheckOutSuccess,
        warn: Messages.UndoCheckOutWarning,
        error: Messages.UndoCheckOutError,
      },
      this.output,
      this.refresh,
    );
  }

  /** Ask whether to version some files, and with which version. */
  private async askVersioning(
    prompt: string,
  ): Promise<{ version?: string } | undefined> {
    const choices: QuickPickItem[] = [
      { label: Messages.Yes },
      { label: Messages.No },
    ];
    const choice = await window.showQuickPick(choices, {
      placeHolder: prompt,
      ignoreFocusOut: true,
    });
    if (!choice) {
      return undefined;
    }
    if (choice.label !== Messages.Yes) {
      return {};
    }
    const version = await window.showInputBox({
      prompt: Messages.CheckInVersionPrompt,
      title: Messages.VersionTitle,
      value: "1.0",
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateVersion),
    });
    return version === undefined ? undefined : { version };
  }

  async checkIn(items: WorkspaceItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    let plan;
    try {
      plan = planCheckIn(
        await this.model.getCheckInCandidates(items.map((i) => i.path)),
      );
    } catch (error) {
      this.fail(
        l10n.t(Messages.StartActionError, { message: errorMessage(error) }),
      );
      return;
    }
    if (
      plan.newFiles.length + plan.versioned.length + plan.unversioned.length ===
      0
    ) {
      window.showErrorMessage(Messages.CheckInNoItems);
      return;
    }

    const answers: Partial<CheckInAnswers> = {};
    if (plan.newFiles.length > 0) {
      const answer = await this.askVersioning(
        l10n.t(Messages.VersionNewFiles, { count: plan.newFiles.length }),
      );
      if (!answer) {
        return;
      }
      answers.newFileVersion = answer.version;
    }
    if (plan.unversioned.length > 0) {
      const answer = await this.askVersioning(
        l10n.t(Messages.VersionExistingFiles, {
          count: plan.unversioned.length,
        }),
      );
      if (!answer) {
        return;
      }
      answers.unversionedVersion = answer.version;
    }
    if (plan.versioned.length > 0) {
      const choice = await window.showQuickPick(
        [
          {
            label: Messages.Major,
            description: Messages.MajorDetail,
            bump: "major" as const,
          },
          {
            label: Messages.Minor,
            description: Messages.MinorDetail,
            bump: "minor" as const,
          },
        ],
        {
          placeHolder: Messages.VersionBumpPlaceholder,
          ignoreFocusOut: true,
        },
      );
      if (!choice) {
        return;
      }
      answers.bump = choice.bump;
    }
    const comment = await window.showInputBox({
      prompt: Messages.CommentPrompt,
      title: Messages.CommentTitle,
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateComment),
    });
    if (comment === undefined) {
      return;
    }

    let body;
    try {
      body = buildCheckInBody(plan, { ...answers, comment });
    } catch (error) {
      this.fail(errorMessage(error));
      return;
    }
    await performBatchAction(
      (isCancelled) => this.model.checkIn(body, isCancelled),
      {
        progress: Messages.CheckingInMessage,
        success: Messages.CheckInSuccess,
        warn: Messages.CheckInWarning,
        error: Messages.CheckInError,
      },
      this.output,
      this.refresh,
    );
  }

  copyLatestVersion(items: RepositoryItem[]): Promise<void> {
    return performBatchAction(
      (isCancelled) => this.model.copyLatestVersion(items, isCancelled),
      COPY_MESSAGES,
      this.output,
      this.refresh,
    );
  }

  copyFolderStructure(items: RepositoryItem[]): Promise<void> {
    return performBatchAction(
      (isCancelled) => this.model.copyFolderStructure(items, isCancelled),
      COPY_MESSAGES,
      this.output,
      this.refresh,
    );
  }

  copySpecificVersion(version: VersionRow): Promise<void> {
    return performBatchAction(
      (isCancelled) => this.model.copySpecificVersion(version, isCancelled),
      COPY_MESSAGES,
      this.output,
      this.refresh,
    );
  }
}
