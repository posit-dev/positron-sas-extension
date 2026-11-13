// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Sign Files: electronic signatures on repository files, as in SAS Clinical
// Acceleration Repository. The signer picks the files, a reason and a role
// (both configured on the server), adds a comment, confirms, and enters the
// current PIN of their authenticator app. The PIN is asked for last, since
// it is only valid for a short time, and is never logged or kept. When the
// server refuses it, the signer can link an app (EnableSignatures) and then
// enter a PIN from it.
import {
  LogOutputChannel,
  ProgressLocation,
  QuickPickItem,
  l10n,
  window,
} from "vscode";

import type { RepositoryModel } from "./RepositoryModel";
import type { SignatureHistory } from "./SignatureHistory";
import { ActionCancelledError, summarizeActionStatus } from "./actionStatus";
import { Messages, errorMessage, toInputValidator } from "./messages";
import {
  MAX_SIGN_FILES,
  SignRequest,
  buildSignRequest,
  describeSignRequest,
  isValidPin,
  normalizePin,
  partitionSignable,
} from "./signing";
import type { ActionStatus, RepositoryItem } from "./types";
import { isContainer, validateComment } from "./utils";

/** How one attempt to sign ended. */
type Attempt =
  | { kind: "done"; status: ActionStatus }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

interface FilePick extends QuickPickItem {
  file: RepositoryItem;
}

const STEPS = 4;

export class SignFiles {
  constructor(
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
    private readonly history: SignatureHistory,
    private readonly refresh: () => void,
    /** Link an authenticator app; resolves to true when the QR code shows. */
    private readonly setUpAuthenticator?: (
      item: RepositoryItem,
    ) => Promise<boolean>,
  ) {}

  /** Sign the selected files, and the files in the selected folders. */
  async sign(selection: RepositoryItem[]): Promise<void> {
    if (!selection.length) {
      return;
    }
    // The server enforces the privilege; stop early only when it is
    // known to be missing.
    const privileges = await this.model.getPrivileges(selection[0].id);
    if (privileges && !privileges.signFiles) {
      window.showWarningMessage(Messages.SignPrivilegeMissing);
      return;
    }

    let files: RepositoryItem[];
    let reasons: string[];
    let roles: string[];
    try {
      [files, reasons, roles] = await window.withProgress(
        { location: ProgressLocation.Window, title: Messages.SignPreparing },
        () =>
          Promise.all([
            this.collect(selection),
            this.model.getSignatureReasons(),
            this.model.getSignatureRoles(),
          ]),
      );
    } catch (error) {
      this.fail(Messages.SignPrepareError, errorMessage(error));
      return;
    }
    if (!reasons.length || !roles.length) {
      window.showErrorMessage(Messages.SignNoReasonsOrRoles);
      return;
    }
    const { signable, checkedOut } = partitionSignable(files);
    if (checkedOut.length) {
      this.output.info(
        `Not offered for signing, because they are checked out: ${checkedOut.map((f) => f.path).join(", ")}`,
      );
    }
    if (!signable.length) {
      window.showWarningMessage(Messages.SignNothing);
      return;
    }

    const chosen = await this.pickFiles(
      signable,
      checkedOut.length,
      selection.some(isContainer),
    );
    if (!chosen?.length) {
      return;
    }
    const reason = await window.showQuickPick(reasons, {
      title: step(2),
      placeHolder: Messages.SignReasonPlaceholder,
      ignoreFocusOut: true,
    });
    if (!reason) {
      return;
    }
    const role = await window.showQuickPick(roles, {
      title: step(3),
      placeHolder: Messages.SignRolePlaceholder,
      ignoreFocusOut: true,
    });
    if (!role) {
      return;
    }
    const comment = await window.showInputBox({
      title: step(4),
      prompt: Messages.SignCommentPrompt,
      ignoreFocusOut: true,
      validateInput: toInputValidator(validateComment),
    });
    if (comment === undefined) {
      return;
    }

    const signer = (await this.model.getCurrentUserId()) ?? "?";
    const confirm = await window.showWarningMessage(
      l10n.t(Messages.SignConfirm, { count: chosen.length }),
      {
        modal: true,
        detail: l10n.t(Messages.SignConfirmDetail, {
          signer,
          reason,
          role,
          files: listPaths(chosen),
        }),
      },
      Messages.SignConfirmButton,
    );
    if (confirm !== Messages.SignConfirmButton) {
      return;
    }

    // A wrong or expired PIN only needs a new PIN.
    for (;;) {
      const pin = await window.showInputBox({
        title: Messages.SignFilesTitle,
        prompt: Messages.SignPinPrompt,
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          isValidPin(value) ? undefined : Messages.SignPinInvalid,
      });
      if (pin === undefined) {
        return;
      }
      const request = buildSignRequest(
        chosen,
        { role, reason, comment },
        normalizePin(pin),
      );
      this.output.info(
        `Signing ${chosen.length} file(s) as ${signer}, ${describeSignRequest(request)}`,
      );
      const attempt = await this.attempt(request);
      if (attempt.kind === "cancelled") {
        this.output.info(
          "Stopped waiting for the signing; the server finishes it.",
        );
        this.refresh();
        return;
      }
      if (attempt.kind === "done") {
        const outcome = summarizeActionStatus(attempt.status);
        this.refresh();
        if (outcome.level === "info") {
          this.output.info(
            l10n.t(Messages.SignSuccess, { count: chosen.length }),
          );
          await this.reportSuccess(chosen);
          return;
        }
        if (outcome.level === "warn") {
          this.output.warn(
            l10n.t(Messages.SignWarning, { message: outcome.details }),
          );
          window.showWarningMessage(
            l10n.t(Messages.SignWarning, { message: outcome.firstMessage }),
          );
          return;
        }
        this.output.error(
          l10n.t(Messages.SignError, { message: outcome.details }),
        );
        if (!(await this.offerRetry(outcome.firstMessage, chosen[0]))) {
          return;
        }
        continue;
      }
      this.output.error(
        l10n.t(Messages.SignError, { message: attempt.message }),
      );
      if (!(await this.offerRetry(attempt.message, chosen[0]))) {
        return;
      }
    }
  }

  /** Step 1: confirm the files, which matters when folders were expanded. */
  private async pickFiles(
    files: RepositoryItem[],
    checkedOut: number,
    fromFolders: boolean,
  ): Promise<RepositoryItem[] | undefined> {
    if (files.length === 1 && !fromFolders && !checkedOut) {
      return files;
    }
    const picks = await window.showQuickPick<FilePick>(
      files.map((file) => ({
        label: file.name,
        description: parentPath(file.path),
        detail:
          file.versioned && file.fileVersion
            ? `v${file.fileVersion}`
            : undefined,
        picked: true,
        file,
      })),
      {
        title: step(1),
        placeHolder: checkedOut
          ? l10n.t(Messages.SignFilesPickSkipped, { count: checkedOut })
          : Messages.SignFilesPick,
        canPickMany: true,
        ignoreFocusOut: true,
        matchOnDescription: true,
      },
    );
    return picks?.map((p) => p.file);
  }

  private async attempt(request: SignRequest): Promise<Attempt> {
    return window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: Messages.SigningMessage,
        cancellable: true,
      },
      async (_progress, token): Promise<Attempt> => {
        try {
          const status = await this.model.runSignAction(
            request,
            () => token.isCancellationRequested,
          );
          return { kind: "done", status };
        } catch (error) {
          if (error instanceof ActionCancelledError) {
            return { kind: "cancelled" };
          }
          // errorMessage reads the server's message only, never the request.
          return { kind: "failed", message: errorMessage(error) };
        }
      },
    );
  }

  /**
   * Offer a new PIN, or first linking an authenticator app (the server's
   * error codes for a missing key have no known texts, so it is always
   * offered). True to ask for a PIN again.
   */
  private async offerRetry(
    message: string,
    file: RepositoryItem,
  ): Promise<boolean> {
    const choices = this.setUpAuthenticator
      ? [Messages.SignRetry, Messages.SignSetUpAuthenticator]
      : [Messages.SignRetry];
    const choice = await window.showErrorMessage(
      l10n.t(Messages.SignError, { message }),
      ...choices,
    );
    if (choice === Messages.SignSetUpAuthenticator && this.setUpAuthenticator) {
      return this.setUpAuthenticator(file);
    }
    return choice === Messages.SignRetry;
  }

  private async reportSuccess(files: RepositoryItem[]): Promise<void> {
    const message = l10n.t(Messages.SignSuccess, { count: files.length });
    if (files.length !== 1) {
      window.showInformationMessage(message);
      return;
    }
    const choice = await window.showInformationMessage(
      message,
      Messages.ShowSignatureHistory,
    );
    if (choice === Messages.ShowSignatureHistory) {
      await this.history.show(files[0]);
    }
  }

  /** The selected files plus the files in the selected folders, capped. */
  private async collect(
    selection: RepositoryItem[],
  ): Promise<RepositoryItem[]> {
    const files: RepositoryItem[] = [];
    const queue = [...selection];
    while (queue.length && files.length < MAX_SIGN_FILES) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      if (!isContainer(item)) {
        files.push(item);
        continue;
      }
      const children = await this.model.getChildren(item, (reason) =>
        this.output.warn(`Listing ${item.path} was truncated: ${reason}`),
      );
      queue.push(...children);
    }
    // Whatever is left unlisted may hold more files.
    if (queue.length) {
      window.showWarningMessage(
        l10n.t(Messages.SignTooMany, { max: MAX_SIGN_FILES }),
      );
    }
    return files;
  }

  private fail(template: string, message: string): void {
    const text = l10n.t(template, { message });
    this.output.error(text);
    window.showErrorMessage(text);
  }
}

const step = (n: number): string =>
  l10n.t(Messages.SignFilesStep, { step: n, total: STEPS });

const parentPath = (path: string): string =>
  path.slice(0, path.lastIndexOf("/")) || "/";

/** The paths for the confirmation: the first ten, then a count. */
function listPaths(files: RepositoryItem[]): string {
  const shown = files.slice(0, 10).map((f) => f.path);
  if (files.length > shown.length) {
    shown.push(
      l10n.t(Messages.SignMoreFiles, { count: files.length - shown.length }),
    );
  }
  return shown.join("\n");
}
