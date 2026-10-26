// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  CustomDocument,
  CustomReadonlyEditorProvider,
  ExtensionContext,
  Uri,
  WebviewPanel,
  window,
} from "vscode";

import * as fs from "fs";
import * as path from "path";

import { getActiveSession } from "./index";
import {
  TRANSPORT_HEADER_BYTES,
  TransportLibrefPool,
  buildTransportLoadCode,
  detectTransportFormat,
  findSasErrors,
} from "./xptFormat";

/** Minimal document representing a .xpt file. */
class XptDocument implements CustomDocument {
  constructor(readonly uri: Uri) {}
  dispose(): void {}
}

/** Read the first bytes of a file without loading all of it. */
async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = new Uint8Array(TRANSPORT_HEADER_BYTES);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      TRANSPORT_HEADER_BYTES,
      0,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Custom readonly editor for SAS transport files (.xpt).
 *
 * When a .xpt file is opened from the Explorer, this provider:
 * 1. Detects the format (XPORT v5, XPORT v8/9 or PROC CPORT) from the header
 * 2. Unpacks the file into a library under WORK in the active SAS session
 * 3. Opens the dataset(s) in the Positron Data Explorer
 */
export class XptEditorProvider implements CustomReadonlyEditorProvider<XptDocument> {
  static readonly viewType = "sas.xptViewer";

  private readonly librefs = new TransportLibrefPool();

  static register(context: ExtensionContext): void {
    context.subscriptions.push(
      window.registerCustomEditorProvider(
        XptEditorProvider.viewType,
        new XptEditorProvider(),
        { supportsMultipleEditorsPerDocument: false },
      ),
    );
  }

  async openCustomDocument(uri: Uri): Promise<XptDocument> {
    return new XptDocument(uri);
  }

  async resolveCustomEditor(
    document: XptDocument,
    webviewPanel: WebviewPanel,
  ): Promise<void> {
    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);
    const webview = webviewPanel.webview;

    webview.html = this.getHtml(
      `<h2>Opening ${escapeHtml(fileName)} in Data Explorer...</h2>`,
    );

    const session = getActiveSession();
    if (!session) {
      webview.html = this.getErrorHtml(
        "No active SAS session. Please start a SAS session first.",
      );
      return;
    }

    try {
      const format = detectTransportFormat(await readHeader(filePath));
      if (!format) {
        webview.html = this.getErrorHtml(
          `${fileName} is not a SAS transport file (XPORT or CPORT).`,
        );
        return;
      }

      const libref = this.librefs.librefFor(filePath);
      const log = await session.runSilent(
        buildTransportLoadCode(format, filePath, libref),
      );
      const errors = findSasErrors(log);
      if (errors.length > 0) {
        webview.html = this.getErrorHtml(
          `Failed to read ${fileName}:\n${errors.join("\n")}`,
        );
        return;
      }

      const members = (await session.listMembers(libref)).map((m) => m.name);
      if (members.length === 0) {
        webview.html = this.getErrorHtml(`${fileName} contains no datasets.`);
        return;
      }

      let selected = members;
      if (members.length > 1) {
        selected =
          (await window.showQuickPick(members, {
            canPickMany: true,
            title: `${fileName} contains ${members.length} datasets`,
            placeHolder: "Select the datasets to open in the Data Explorer",
          })) ?? [];
      }

      for (const member of selected) {
        session.openDataExplorer(libref, member, `${fileName}: ${member}`);
      }
      webview.html = this.getSuccessHtml(fileName, selected, libref);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      webview.html = this.getErrorHtml(`Failed to open ${fileName}: ${msg}`);
    }
  }

  private getHtml(body: string): string {
    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;color:#ccc;background:#1e1e1e;">
${body}
</body></html>`;
  }

  private getSuccessHtml(
    fileName: string,
    members: string[],
    libref: string,
  ): string {
    const opened =
      members.length > 0
        ? `Opened ${members.map(escapeHtml).join(", ")} in Data Explorer`
        : "No datasets selected";
    return this.getHtml(`<h2>${escapeHtml(fileName)}</h2>
<p style="color:#999;">${opened}</p>
<p style="color:#666;font-size:12px;">Library: ${libref}</p>
<p style="margin-top:20px;color:#999;">You can close this tab — the data is displayed in the Data Explorer pane.</p>`);
  }

  private getErrorHtml(message: string): string {
    return this.getHtml(`<h2 style="color:#f44;">Error</h2>
<p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`);
  }
}
