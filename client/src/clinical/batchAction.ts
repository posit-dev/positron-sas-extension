// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Progress and result reporting shared by every Clinical Acceleration batch
// action (check out, check in, versioning, copy to workspace, ...).
import { LogOutputChannel, ProgressLocation, l10n, window } from "vscode";

import { ActionCancelledError, summarizeActionStatus } from "./actionStatus";
import { Messages, errorMessage } from "./messages";
import type { ActionStatus } from "./types";

/**
 * Message templates for one kind of action. `warn` and `error` may contain a
 * `{message}` placeholder for the per-item details.
 */
export interface BatchMessages {
  progress: string;
  success: string;
  warn: string;
  error: string;
}

/**
 * Run a batch action behind a cancellable progress notification and report
 * how it ended. Cancelling only stops waiting; the server finishes the action.
 * `onSettled` runs once the action ended, whatever its outcome, so the caller
 * can refresh its views.
 */
export async function performBatchAction(
  run: (isCancelled: () => boolean) => Promise<ActionStatus>,
  messages: BatchMessages,
  output: LogOutputChannel,
  onSettled: () => void,
): Promise<void> {
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: messages.progress,
      cancellable: true,
    },
    async (_progress, token) => {
      let status: ActionStatus;
      try {
        status = await run(() => token.isCancellationRequested);
      } catch (error) {
        if (!(error instanceof ActionCancelledError)) {
          const message = l10n.t(Messages.StartActionError, {
            message: errorMessage(error),
          });
          output.error(message);
          window.showErrorMessage(message);
        }
        return;
      }
      const outcome = summarizeActionStatus(status);
      switch (outcome.level) {
        case "warn":
          output.info(l10n.t(messages.warn, { message: outcome.details }));
          window.showWarningMessage(l10n.t(messages.warn, { message: "" }));
          break;
        case "error":
          output.error(l10n.t(messages.error, { message: outcome.details }));
          window.showErrorMessage(
            l10n.t(messages.error, { message: outcome.firstMessage }),
          );
          break;
        default:
          output.info(messages.success);
          window.showInformationMessage(messages.success);
      }
      onSettled();
    },
  );
}
