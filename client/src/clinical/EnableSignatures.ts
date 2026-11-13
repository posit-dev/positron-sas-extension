// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Enable Signatures: link an authenticator app to the user's account, as
// the Enable Signatures setting of SAS Clinical Acceleration Repository's
// web app does, so that the app's PINs sign files. The QR code holds the
// user's one-time password secret, so it is shown in a webview of its own:
// not in the Viewer, which Posit Assistant reads, and not through the
// report server. It runs no scripts, isn't restored after a reload, closes
// after a while, and the image is never logged or written to a file.
import {
  Disposable,
  LogOutputChannel,
  ProgressLocation,
  ViewColumn,
  WebviewPanel,
  l10n,
  window,
} from "vscode";

import type { RepositoryModel } from "./RepositoryModel";
import { Messages, SignatureKeyLabelText, errorMessage } from "./messages";
import { renderSignatureKeyPage } from "./signatureKey";
import type { RepositoryItem } from "./types";

export const ENABLE_SIGNATURES_VIEW_TYPE = "SAS.clinical.enableSignatures";

/** The QR code tab closes on its own after this long. */
const PANEL_LIFETIME_MS = 10 * 60 * 1000;

export class EnableSignatures implements Disposable {
  private panel: WebviewPanel | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
  ) {}

  /**
   * Generate a QR code and show it. Resolves to true when it was shown.
   * `item`, when given, is used to check the Sign Files privilege.
   */
  async setUp(item?: RepositoryItem): Promise<boolean> {
    if (item) {
      // The server enforces the privilege; stop early only when it is
      // known to be missing.
      const privileges = await this.model.getPrivileges(item.id);
      if (privileges && !privileges.signFiles) {
        window.showWarningMessage(Messages.SignPrivilegeMissing);
        return false;
      }
    }
    const confirm = await window.showWarningMessage(
      Messages.EnableSignaturesConfirm,
      { modal: true, detail: Messages.EnableSignaturesConfirmDetail },
      Messages.EnableSignaturesButton,
    );
    if (confirm !== Messages.EnableSignaturesButton) {
      return false;
    }

    let image: string;
    try {
      image = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: Messages.EnableSignaturesGenerating,
        },
        () => this.model.generateSignatureKey(),
      );
    } catch (error) {
      // errorMessage reads the server's message only, never the response.
      const text = l10n.t(Messages.EnableSignaturesError, {
        message: errorMessage(error),
      });
      this.output.error(text);
      window.showErrorMessage(text);
      return false;
    }
    this.output.info(
      "Generated a new signature key; its QR code is shown, not logged.",
    );
    this.show(image);
    window.showInformationMessage(Messages.EnableSignaturesShown);
    return true;
  }

  private show(image: string): void {
    const html = renderSignatureKeyPage(image, SignatureKeyLabelText);
    if (!this.panel) {
      this.panel = window.createWebviewPanel(
        ENABLE_SIGNATURES_VIEW_TYPE,
        Messages.EnableSignaturesTitle,
        ViewColumn.Active,
        {
          enableScripts: false,
          enableForms: false,
          enableCommandUris: false,
          enableFindWidget: false,
          retainContextWhenHidden: false,
          localResourceRoots: [],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.clearTimer();
      });
    } else {
      this.panel.reveal(ViewColumn.Active);
    }
    this.panel.webview.html = html;
    this.clearTimer();
    this.timer = setTimeout(() => this.panel?.dispose(), PANEL_LIFETIME_MS);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.clearTimer();
    this.panel?.dispose();
  }
}
