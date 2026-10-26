// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-unused-vars */

import * as path from "path";
import {
  CancellationToken,
  CustomDocument,
  CustomReadonlyEditorProvider,
  CustomDocumentOpenContext,
  ExtensionContext,
  Uri,
  WebviewPanel,
  window,
  workspace,
} from "vscode";
import { getActiveSession } from "./index";
import { TransportLibrefPool, findSasErrors } from "./xptFormat";

/** Minimal document representing a .sas7bdat file. */
class Sas7bdatDocument implements CustomDocument {
  constructor(readonly uri: Uri) {}
  dispose(): void {}
}

/**
 * Custom readonly editor for .sas7bdat files.
 *
 * When a .sas7bdat file is double-clicked in the Explorer, this provider:
 * 1. Assigns a temporary LIBNAME to the file's directory
 * 2. Opens the dataset in the Positron Data Explorer
 * 3. Shows a brief info panel in the editor tab
 */
export class Sas7bdatEditorProvider
  implements CustomReadonlyEditorProvider<Sas7bdatDocument>
{
  static readonly viewType = "sas.sas7bdatViewer";

  // Datasets from non-local views (Clinical Repository, SAS Content) are
  // copied into WORK, one directory and libref per file.
  private readonly uploadLibrefs = new TransportLibrefPool("_FVW");

  static register(context: ExtensionContext): void {
    const provider = new Sas7bdatEditorProvider();
    context.subscriptions.push(
      window.registerCustomEditorProvider(
        Sas7bdatEditorProvider.viewType,
        provider,
        { supportsMultipleEditorsPerDocument: false },
      ),
    );
  }

  async openCustomDocument(
    uri: Uri,
    _openContext: CustomDocumentOpenContext,
    _token: CancellationToken,
  ): Promise<Sas7bdatDocument> {
    return new Sas7bdatDocument(uri);
  }

  async resolveCustomEditor(
    document: Sas7bdatDocument,
    webviewPanel: WebviewPanel,
    _token: CancellationToken,
  ): Promise<void> {
    const uri = document.uri;
    const local = uri.scheme === "file";
    const filePath = local ? uri.fsPath : uri.path;
    let dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const member = path.basename(filePath, ext).toUpperCase();
    let libname = "_FVIEW";

    webviewPanel.webview.html = this.getLoadingHtml(member);

    const session = getActiveSession();
    if (!session) {
      webviewPanel.webview.html = this.getErrorHtml(
        "No active SAS session. Please start a SAS session first.",
      );
      return;
    }

    try {
      if (!local) {
        // Not on a disk SAS can read: copy it into WORK first. SAS on UNIX
        // only finds datasets whose file names are lowercase.
        libname = this.uploadLibrefs.librefFor(uri.toString());
        const serverPath = await session.uploadToWork(
          libname.toLowerCase(),
          `${member.toLowerCase()}${ext.toLowerCase()}`,
          await workspace.fs.readFile(uri),
        );
        dir = path.posix.dirname(serverPath);
      }
      const code = `libname ${libname} '${dir.replace(/'/g, "''")}';`;
      const errors = findSasErrors(await session.runSilent(code));
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }
      session.openDataExplorer(libname, member);
      webviewPanel.webview.html = this.getSuccessHtml(
        member,
        local ? dir : path.dirname(filePath),
        libname,
      );
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      webviewPanel.webview.html = this.getErrorHtml(
        `Failed to open ${member}: ${msg}`,
      );
    }
  }

  private getLoadingHtml(member: string): string {
    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;color:#ccc;background:#1e1e1e;">
<h2>Opening ${member} in Data Explorer...</h2>
</body></html>`;
  }

  private getSuccessHtml(member: string, dir: string, libname: string): string {
    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;color:#ccc;background:#1e1e1e;">
<h2>${member}</h2>
<p style="color:#999;">Opened in Data Explorer</p>
<p style="color:#666;font-size:12px;">Source: ${dir}</p>
<p style="color:#666;font-size:12px;">Library: ${libname}</p>
<p style="margin-top:20px;color:#999;">You can close this tab — the data is displayed in the Data Explorer pane.</p>
</body></html>`;
  }

  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;color:#ccc;background:#1e1e1e;">
<h2 style="color:#f44;">Error</h2>
<p>${message}</p>
</body></html>`;
  }
}
