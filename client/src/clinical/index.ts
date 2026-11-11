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

import { PropertyProvider } from "./PropertyProvider";
import { RepositoryDataProvider, getItemUri } from "./RepositoryDataProvider";
import { RepositoryDecorator } from "./RepositoryDecorator";
import { RepositoryModel } from "./RepositoryModel";
import {
  VersionFileSystemProvider,
  VersionHistoryProvider,
  getVersionUri,
} from "./VersionHistoryProvider";
import { WorkspaceActions } from "./WorkspaceActions";
import {
  WorkspaceDataProvider,
  getWorkspaceUri,
} from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { BatchMessages, performBatchAction } from "./batchAction";
import {
  CLINICAL_SCHEME,
  COMPARE_SELECTED_KEY,
  TWO_ITEMS_KEY,
  TWO_VERSIONS_KEY,
  TWO_WORKSPACE_ITEMS_KEY,
  VERSION_SCHEME,
  VIEW_ID,
  WORKSPACE_SCHEME,
  WORKSPACE_VIEW_ID,
} from "./const";
import { closeEditors } from "./editors";
import { registerClinicalJobs } from "./jobs";
import { Messages, errorMessage, toInputValidator } from "./messages";
import { CLINICAL_JOBS_PROBE, ClinicalAvailability } from "./probe";
import type {
  CheckoutAction,
  RepositoryItem,
  VersionRow,
  VersioningAction,
  WorkspaceItem,
} from "./types";
import {
  downloadFileName,
  extractSingleZipEntry,
  isContainer,
  isSameOrUnder,
  isVersionRow,
  isWorkspaceFolder,
  isWorkspaceItem,
  isZip,
  validateComment,
  validateFileName,
  validateFolderName,
  validateVersion,
  versionFileName,
} from "./utils";

/** What the compare commands work on: a repository file, a version of one, or a workspace file. */
type CompareSource = RepositoryItem | VersionRow | WorkspaceItem;
interface CompareTarget {
  uri: Uri;
  label: string;
}

export class ClinicalRepository {
  static register(context: ExtensionContext): void {
    const output = window.createOutputChannel("SAS Clinical Repository", {
      log: true,
    });
    const log = (message: string) => output.info(message);
    const model = new RepositoryModel(log);
    const decorator = new RepositoryDecorator();
    const provider = new RepositoryDataProvider(
      model,
      decorator,
      context.extensionUri,
      log,
    );
    const properties = new PropertyProvider();
    const versions = new VersionHistoryProvider(model, log);
    const workspaceModel = new WorkspaceModel(model);
    const workspaceProvider = new WorkspaceDataProvider(
      workspaceModel,
      model,
      decorator,
      context.extensionUri,
      log,
    );
    const repository = new ClinicalRepository(
      provider,
      model,
      output,
      properties,
      versions,
      workspaceProvider,
    );
    const actions = new WorkspaceActions(
      workspaceProvider,
      workspaceModel,
      output,
      () => repository.refreshAll(),
    );
    const availability = new ClinicalAvailability((available) => {
      model.reset();
      if (available) {
        repository.refreshAll();
      }
    }, log);
    // SAS Clinical Job Management, a separate service: the Jobs view and the
    // job commands show when SAS.clinical.jobsAvailable is set.
    const jobs = registerClinicalJobs(
      context,
      model,
      workspaceModel,
      output,
      () => repository.refreshAll(),
    );
    const jobsAvailability = new ClinicalAvailability(
      (available) => {
        if (available) {
          jobs.refresh();
        }
      },
      log,
      CLINICAL_JOBS_PROBE,
    );

    context.subscriptions.push(
      output,
      decorator,
      provider,
      properties,
      versions,
      workspaceProvider,
      availability,
      jobs,
      jobsAvailability,
      workspace.registerFileSystemProvider(
        WORKSPACE_SCHEME,
        workspaceProvider,
        { isCaseSensitive: true },
      ),
      workspace.registerFileSystemProvider(CLINICAL_SCHEME, provider, {
        isCaseSensitive: true,
        isReadonly: true,
      }),
      workspace.registerFileSystemProvider(
        VERSION_SCHEME,
        new VersionFileSystemProvider(model),
        { isCaseSensitive: true, isReadonly: true },
      ),
      window.registerFileDecorationProvider(decorator),
      provider.treeView.onDidChangeSelection((event) =>
        repository.onSelectionChanged(event.selection),
      ),
      versions.treeView.onDidChangeSelection((event) =>
        commands.executeCommand(
          "setContext",
          TWO_VERSIONS_KEY,
          event.selection.length === 2,
        ),
      ),
      workspaceProvider.treeView.onDidChangeSelection((event) =>
        commands.executeCommand(
          "setContext",
          TWO_WORKSPACE_ITEMS_KEY,
          event.selection.length === 2,
        ),
      ),
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("SAS.connectionProfiles")) {
          model.reset();
          repository.refreshAll();
        }
      }),
      commands.registerCommand("SAS.clinical.refresh", () => {
        model.reset();
        repository.refreshAll();
        availability.schedule(0);
        jobsAvailability.schedule(0);
        jobs.refresh();
      }),
      commands.registerCommand("SAS.clinical.refreshDetails", () =>
        repository.showDetails(repository.current),
      ),
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
      commands.registerCommand("SAS.clinical.delete", (item: RepositoryItem) =>
        repository.delete(provider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.enableVersioning",
        (item: RepositoryItem) =>
          repository.setVersioning("ENABLE_VERSIONING", item),
      ),
      commands.registerCommand(
        "SAS.clinical.disableVersioning",
        (item: RepositoryItem) =>
          repository.setVersioning("DISABLE_VERSIONING", item),
      ),
      commands.registerCommand(
        "SAS.clinical.downloadVersion",
        (row: VersionRow) =>
          repository.downloadVersion(versions.selection(row)),
      ),
      commands.registerCommand(
        "SAS.clinical.selectForCompare",
        (source: CompareSource) => repository.selectForCompare(source),
      ),
      commands.registerCommand(
        "SAS.clinical.compareWithSelected",
        (source: CompareSource) => repository.compareWithSelected(source),
      ),
      commands.registerCommand(
        "SAS.clinical.compareSelected",
        (source: CompareSource) =>
          repository.compareSelected(
            isVersionRow(source)
              ? versions.selection(source)
              : isWorkspaceItem(source)
                ? workspaceProvider.selection(source)
                : provider.selection(source),
          ),
      ),
      // Copy repository items and versions into the workspace.
      commands.registerCommand(
        "SAS.clinical.copyLatestVersion",
        (item: RepositoryItem) =>
          actions.copyLatestVersion(provider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.copyFolderStructure",
        (item: RepositoryItem) =>
          actions.copyFolderStructure(provider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.copySpecificVersion",
        (row: VersionRow) => actions.copySpecificVersion(row),
      ),
      // The Workspace view.
      commands.registerCommand("SAS.clinical.workspace.refresh", () =>
        workspaceProvider.refresh(),
      ),
      commands.registerCommand("SAS.clinical.workspace.collapseAll", () =>
        commands.executeCommand(
          `workbench.actions.treeView.${WORKSPACE_VIEW_ID}.collapseAll`,
        ),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.newFile",
        (item?: WorkspaceItem) => actions.newFile(item),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.newFolder",
        (item?: WorkspaceItem) => actions.newFolder(item),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.rename",
        (item: WorkspaceItem) => actions.rename(item),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.delete",
        (item: WorkspaceItem) =>
          actions.delete(workspaceProvider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.copyPath",
        (item: WorkspaceItem) =>
          env.clipboard.writeText(
            workspaceProvider
              .selection(item)
              .map((i) => i.path)
              .join("\n"),
          ),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.download",
        (item: WorkspaceItem) =>
          actions.download(workspaceProvider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.upload",
        (item?: WorkspaceItem) => actions.upload(item, false),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.uploadAndExpand",
        (item?: WorkspaceItem) => actions.upload(item, true),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.checkIn",
        (item: WorkspaceItem) =>
          actions.checkIn(workspaceProvider.selection(item)),
      ),
      commands.registerCommand(
        "SAS.clinical.workspace.undoCheckout",
        (item: WorkspaceItem) =>
          actions.undoCheckout(workspaceProvider.selection(item)),
      ),
    );
  }

  /** The single item whose details are shown, if exactly one is selected. */
  current: RepositoryItem | undefined;
  // Drops the result of a details lookup that a newer selection overtook.
  private detailsGeneration = 0;
  private compareFrom: CompareTarget | undefined;

  private constructor(
    private readonly provider: RepositoryDataProvider,
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
    private readonly properties: PropertyProvider,
    private readonly versions: VersionHistoryProvider,
    private readonly workspaceProvider: WorkspaceDataProvider,
  ) {}

  /** Refresh the tree and the views that describe the selected item. */
  refreshAll(): void {
    this.provider.refresh();
    this.workspaceProvider.refresh();
    void this.showDetails(this.current);
  }

  onSelectionChanged(selection: readonly RepositoryItem[]): void {
    commands.executeCommand(
      "setContext",
      TWO_ITEMS_KEY,
      selection.length === 2,
    );
    void this.showDetails(selection.length === 1 ? selection[0] : undefined);
  }

  /** Show the properties and versions of an item, read afresh from the server. */
  async showDetails(item: RepositoryItem | undefined): Promise<void> {
    this.current = item;
    const generation = ++this.detailsGeneration;
    if (!item) {
      this.properties.clear();
      this.versions.clear();
      return;
    }
    try {
      // The listing can be stale, e.g. right after versioning was enabled.
      const fresh = await this.model.getItem(item.id);
      const type = await this.model.getObjectType(fresh.typeId);
      if (generation !== this.detailsGeneration) {
        return;
      }
      this.properties.show(fresh, type?.name);
      void this.showAccess(fresh, type?.name, generation);
      await this.versions.show(fresh);
    } catch (error) {
      if (generation !== this.detailsGeneration) {
        return;
      }
      const message = l10n.t(Messages.PropertiesError, {
        message: errorMessage(error),
      });
      this.output.error(message);
      this.properties.showError(message);
      this.versions.clear();
    }
  }

  /** Add the user's permissions to the Properties once they are read. */
  private async showAccess(
    item: RepositoryItem,
    typeName: string | undefined,
    generation: number,
  ): Promise<void> {
    const [permissions, privileges] = await Promise.all([
      this.model.getPermissionNames(item.id),
      this.model.getPrivileges(item.id),
    ]);
    if (generation === this.detailsGeneration && (permissions || privileges)) {
      this.properties.show(item, typeName, { permissions, privileges });
    }
  }

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
      this.refreshAll();
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
      this.refreshAll();
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
          this.refreshAll();
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
    await performBatchAction(
      (isCancelled) =>
        this.model.runCheckoutAction(action, items, copyContent, isCancelled),
      messages,
      this.output,
      () => this.provider.refresh(),
    );
  }

  async delete(items: RepositoryItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const answer = await window.showWarningMessage(
      items.length === 1
        ? l10n.t(Messages.DeleteConfirm, { name: items[0].name })
        : l10n.t(Messages.DeleteConfirmMany, { count: items.length }),
      { modal: true, detail: Messages.DeleteDetail },
      Messages.DeleteAction,
    );
    if (answer !== Messages.DeleteAction) {
      return;
    }
    const deleted: RepositoryItem[] = [];
    await Promise.all(
      items.map(async (item) => {
        try {
          await this.model.delete(item);
          deleted.push(item);
          this.output.info(l10n.t(Messages.DeleteSuccess, { name: item.name }));
        } catch (error) {
          this.output.error(
            l10n.t(Messages.DeleteItemError, {
              name: item.name,
              message: errorMessage(error),
            }),
          );
        }
      }),
    );
    await this.closeEditorsOf(deleted);
    if (deleted.length < items.length) {
      window.showErrorMessage(Messages.DeleteError);
      this.output.show(true);
    }
    // Whatever was deleted can't stay selected.
    this.current = undefined;
    this.refreshAll();
  }

  /** Close the editors that show deleted items, or things inside deleted folders. */
  private async closeEditorsOf(deleted: RepositoryItem[]): Promise<void> {
    const ids = new Set(deleted.map((item) => item.id));
    await closeEditors((uri) =>
      uri.scheme === VERSION_SCHEME
        ? ids.has(new URLSearchParams(uri.query).get("id") ?? "")
        : uri.scheme === CLINICAL_SCHEME &&
          deleted.some((item) => isSameOrUnder(uri.path, item.path)),
    );
  }

  async setVersioning(
    action: VersioningAction,
    item: RepositoryItem,
  ): Promise<void> {
    const enable = action === "ENABLE_VERSIONING";
    // The server enforces the privileges. Only stop early when we know for
    // sure that the user holds neither of the two that allow this.
    const privileges = await this.model.getPrivileges(item.id);
    if (
      privileges &&
      !privileges.enableVersioning &&
      !privileges.manageVersioning
    ) {
      window.showWarningMessage(Messages.VersioningPrivilegeMissing);
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
    let version: string | undefined;
    if (enable) {
      version = await window.showInputBox({
        prompt: Messages.EnableVersionPrompt,
        title: Messages.VersionTitle,
        value: "1.0",
        ignoreFocusOut: true,
        validateInput: toInputValidator(validateVersion),
      });
      if (version === undefined) {
        return;
      }
    }
    const messages: BatchMessages = enable
      ? {
          progress: Messages.EnableVersioningMessage,
          success: Messages.EnableVersioningSuccess,
          warn: Messages.EnableVersioningWarning,
          error: Messages.EnableVersioningError,
        }
      : {
          progress: Messages.DisableVersioningMessage,
          success: Messages.DisableVersioningSuccess,
          warn: Messages.DisableVersioningWarning,
          error: Messages.DisableVersioningError,
        };
    await performBatchAction(
      (isCancelled) =>
        this.model.runVersioningAction(
          action,
          item,
          comment,
          version,
          isCancelled,
        ),
      messages,
      this.output,
      () => this.refreshAll(),
    );
  }

  async downloadVersion(rows: VersionRow[]): Promise<void> {
    // Each version is saved on its own, next to where the last one went.
    for (const row of rows) {
      const target = await window.showSaveDialog({
        title: Messages.DownloadTitle,
        saveLabel: Messages.DownloadTitle,
        defaultUri: Uri.joinPath(
          Uri.file(os.homedir()),
          versionFileName(row.name, row.fileVersion),
        ),
      });
      if (!target) {
        return;
      }
      try {
        const content = await this.model.getVersionContent(
          row.fileId,
          row.fileVersion,
        );
        await workspace.fs.writeFile(target, content);
        this.output.info(
          l10n.t(Messages.DownloadedMessage, {
            name: `${row.name} (v${row.fileVersion})`,
            location: target.fsPath,
          }),
        );
      } catch (error) {
        this.fail(
          l10n.t(Messages.DownloadError, { message: errorMessage(error) }),
        );
      }
    }
  }

  private compareTarget(source: CompareSource): CompareTarget {
    if (isVersionRow(source)) {
      return {
        uri: getVersionUri(source),
        label: `${source.name} (v${source.fileVersion})`,
      };
    }
    if (isWorkspaceItem(source)) {
      return {
        uri: getWorkspaceUri(source),
        label: `${source.name} (${l10n.t("workspace")})`,
      };
    }
    return { uri: getItemUri(source), label: source.name };
  }

  private diff(left: CompareTarget, right: CompareTarget): Thenable<unknown> {
    return commands.executeCommand(
      "vscode.diff",
      left.uri,
      right.uri,
      `${left.label} ↔ ${right.label}`,
    );
  }

  async selectForCompare(source: CompareSource): Promise<void> {
    this.compareFrom = this.compareTarget(source);
    await commands.executeCommand("setContext", COMPARE_SELECTED_KEY, true);
  }

  async compareWithSelected(source: CompareSource): Promise<void> {
    if (this.compareFrom) {
      await this.diff(this.compareFrom, this.compareTarget(source));
    }
  }

  async compareSelected(selection: CompareSource[]): Promise<void> {
    if (
      selection.length !== 2 ||
      selection.some((s) =>
        isVersionRow(s)
          ? false
          : isWorkspaceItem(s)
            ? isWorkspaceFolder(s)
            : isContainer(s),
      )
    ) {
      window.showInformationMessage(Messages.CompareFilesOnly);
      return;
    }
    await this.diff(
      this.compareTarget(selection[0]),
      this.compareTarget(selection[1]),
    );
  }
}
