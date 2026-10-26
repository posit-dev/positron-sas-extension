// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/index.ts (Apache-2.0).
//
// SAS Clinical Acceleration Repository view (posit-dev/positron-sas-extension#60).
// It appears in the SAS view container when the active profile is a SAS Viya
// profile and the server runs the Clinical Repository service, and uses the
// extension's own SAS Viya sign-in.
import {
  ExtensionContext,
  LogOutputChannel,
  ProgressLocation,
  TabInputText,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import * as os from "os";

import { RepositoryDataProvider, getItemUri } from "./RepositoryDataProvider";
import { RepositoryDecorator } from "./RepositoryDecorator";
import { RepositoryModel } from "./RepositoryModel";
import { ActionCancelledError } from "./actionStatus";
import { CLINICAL_SCHEME, VIEW_ID } from "./const";
import { Messages, errorMessage, toInputValidator } from "./messages";
import { ClinicalAvailability } from "./probe";
import type { ActionStatus, CheckoutAction, RepositoryItem } from "./types";
import {
  downloadFileName,
  extractSingleZipEntry,
  isContainer,
  isZip,
  validateComment,
  validateFileName,
  validateFolderName,
  validateVersion,
} from "./utils";

export class ClinicalRepository {
  static register(context: ExtensionContext): void {
    const output = window.createOutputChannel("SAS Clinical Repository", {
      log: true,
    });
    const log = (message: string) => output.info(message);
    const model = new RepositoryModel();
    const decorator = new RepositoryDecorator();
    const provider = new RepositoryDataProvider(
      model,
      decorator,
      context.extensionUri,
      log,
    );
    const availability = new ClinicalAvailability((available) => {
      model.reset();
      if (available) {
        provider.refresh();
      }
    }, log);
    const repository = new ClinicalRepository(provider, model, output);

    context.subscriptions.push(
      output,
      decorator,
      provider,
      availability,
      workspace.registerFileSystemProvider(CLINICAL_SCHEME, provider, {
        isCaseSensitive: true,
        isReadonly: true,
      }),
      window.registerFileDecorationProvider(decorator),
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("SAS.connectionProfiles")) {
          model.reset();
          provider.refresh();
        }
      }),
      commands.registerCommand("SAS.clinical.refresh", () => {
        model.reset();
        provider.refresh();
        availability.schedule(0);
      }),
      commands.registerCommand("SAS.clinical.collapseAll", () =>
        commands.executeCommand(
          `workbench.actions.treeView.${VIEW_ID}.collapseAll`,
        ),
      ),
      commands.registerCommand(
        "SAS.clinical.copyPath",
        (item: RepositoryItem) =>
          env.clipboard.writeText(
            provider
              .selection(item)
              .map((i) => i.path)
              .join("\n"),
          ),
      ),
      commands.registerCommand(
        "SAS.clinical.addFolder",
        (item: RepositoryItem) => repository.addFolder(item),
      ),
      commands.registerCommand("SAS.clinical.rename", (item: RepositoryItem) =>
        repository.rename(item),
      ),
      commands.registerCommand(
        "SAS.clinical.download",
        (item: RepositoryItem) => repository.download(provider.selection(item)),
      ),
      commands.registerCommand("SAS.clinical.upload", (item: RepositoryItem) =>
        repository.upload(item, false),
      ),
      commands.registerCommand(
        "SAS.clinical.uploadAndExpand",
        (item: RepositoryItem) => repository.upload(item, true),
      ),
      commands.registerCommand(
        "SAS.clinical.checkoutWithContent",
        (item: RepositoryItem) =>
          repository.checkout(
            "REPOSITORY_CHECK_OUT",
            provider.selection(item),
            true,
          ),
      ),
      commands.registerCommand(
        "SAS.clinical.checkoutWithoutContent",
        (item: RepositoryItem) =>
          repository.checkout(
            "REPOSITORY_CHECK_OUT",
            provider.selection(item),
            false,
          ),
      ),
      commands.registerCommand(
        "SAS.clinical.undoCheckout",
        (item: RepositoryItem) =>
          repository.checkout("UNDO_CHECKOUT", provider.selection(item), false),
      ),
    );
  }

  private constructor(
    private readonly provider: RepositoryDataProvider,
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
  ) {}

  private fail(message: string): void {
    this.output.error(message);
    window.showErrorMessage(message);
  }

  async addFolder(parent: RepositoryItem): Promise<void> {
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
        l10n.t(Messages.FolderCreationSuccess, { name, location: parent.path }),
      );
      this.provider.refresh();
    } catch (error) {
      this.fail(
        l10n.t(Messages.FolderCreationError, {
          name,
          location: parent.path,
          message: errorMessage(error),
        }),
      );
    }
  }

  async rename(item: RepositoryItem): Promise<void> {
    const container = isContainer(item);
    const name = await window.showInputBox({
      prompt: Messages.RenamePrompt,
      title: container ? Messages.RenameFolderTitle : Messages.RenameFileTitle,
      value: item.name,
      ignoreFocusOut: true,
      validateInput: toInputValidator(
        container ? validateFolderName : validateFileName,
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
      // Reopen an open editor under the new name.
      const oldUri = getItemUri(item).toString();
      const tabs = window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof TabInputText &&
            tab.input.uri.toString() === oldUri,
        );
      if (tabs.length > 0) {
        await window.tabGroups.close(tabs);
        await commands.executeCommand("vscode.open", getItemUri(renamed));
      }
      this.provider.refresh();
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

  async download(items: RepositoryItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const target = await window.showSaveDialog({
      title: Messages.DownloadTitle,
      saveLabel: Messages.DownloadTitle,
      defaultUri: Uri.joinPath(Uri.file(os.homedir()), downloadFileName(items)),
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
          let content = await this.model.download(items);
          // A single file may still arrive zipped; save the file itself.
          if (items.length === 1 && !isContainer(items[0]) && isZip(content)) {
            content = extractSingleZipEntry(content) ?? content;
          }
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

  async upload(container: RepositoryItem, expand: boolean): Promise<void> {
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
    const comment = await window.showInputBox({
      prompt: Messages.CommentPrompt,
      title: Messages.CommentTitle,
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateComment),
    });
    if (comment === undefined) {
      return;
    }
    const version = await window.showInputBox({
      prompt: Messages.VersionPrompt,
      title: Messages.VersionTitle,
      value: "1.0",
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateVersion),
    });
    if (version === undefined) {
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
                container,
                name,
                content,
                expand,
                comment,
                version,
              );
              this.output.info(
                l10n.t(
                  expand
                    ? Messages.UploadedAndExpandedMessage
                    : Messages.UploadedMessage,
                  { name: file.fsPath, location: container.path },
                ),
              );
              return true;
            } catch (error) {
              this.output.error(
                l10n.t(Messages.UploadErrorMessage, {
                  name: file.fsPath,
                  location: container.path,
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

  async checkout(
    action: CheckoutAction,
    items: RepositoryItem[],
    copyContent: boolean,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const undo = action === "UNDO_CHECKOUT";
    const messages = undo
      ? {
          progress: Messages.UndoCheckOutMessage,
          success: Messages.UndoCheckOutSuccess,
          warn: Messages.UndoCheckOutWarning,
          error: Messages.UndoCheckOutError,
        }
      : {
          progress: Messages.CheckingOutMessage,
          success: Messages.CheckOutSuccess,
          warn: Messages.CheckOutWarning,
          error: Messages.CheckOutError,
        };
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: messages.progress,
        cancellable: true,
      },
      async (_progress, token) => {
        let status: ActionStatus;
        try {
          status = await this.model.runCheckoutAction(
            action,
            items,
            copyContent,
            () => token.isCancellationRequested,
          );
        } catch (error) {
          if (!(error instanceof ActionCancelledError)) {
            this.fail(
              l10n.t(Messages.StartActionError, {
                message: errorMessage(error),
              }),
            );
          }
          return;
        }
        const details = (status.details ?? [])
          .map((d) => `\n\t${d.itemName} - ${d.message}`)
          .join("");
        switch (status.summary.completionStatus) {
          case "WARN":
            this.output.info(l10n.t(messages.warn, { message: details }));
            window.showWarningMessage(l10n.t(messages.warn, { message: "" }));
            break;
          case "ERROR":
            this.output.error(l10n.t(messages.error, { message: details }));
            window.showErrorMessage(
              l10n.t(messages.error, {
                message: status.details?.[0]?.message ?? "",
              }),
            );
            break;
          default:
            this.output.info(messages.success);
            window.showInformationMessage(messages.success);
        }
        this.provider.refresh();
      },
    );
  }
}
