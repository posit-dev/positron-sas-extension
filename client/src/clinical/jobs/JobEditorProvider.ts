// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The clinical job editor: a form over the JSON text of a .cjob file. It is a
// custom text editor, so dirty state, undo, save, revert and Reopen With ->
// Text Editor all work on the same document. Workspace jobs save through the
// workspace file system; repository jobs and versions are read-only.
import {
  CustomTextEditorProvider,
  Disposable,
  ExtensionContext,
  Range,
  TextDocument,
  Uri,
  WebviewPanel,
  WorkspaceEdit,
  commands,
  window,
  workspace,
} from "vscode";

import { randomBytes } from "crypto";

import { getWorkspaceUri } from "../WorkspaceDataProvider";
import { WORKSPACE_SCHEME } from "../const";
import type { ItemPicker } from "./ItemPicker";
import type { FromEditor, ToEditor } from "./jobForm";
import { EditorLabelText, JobMessages } from "./messages";
import { resourceForUri } from "./resources";
import { baseName, parentPath } from "./utils";

export const JOB_EDITOR_VIEW_TYPE = "SAS.clinical.jobEditor";

export class JobEditorProvider implements CustomTextEditorProvider {
  static register(context: ExtensionContext, picker: ItemPicker): Disposable {
    return window.registerCustomEditorProvider(
      JOB_EDITOR_VIEW_TYPE,
      new JobEditorProvider(context.extensionUri, picker),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(
    private readonly extensionUri: Uri,
    private readonly picker: ItemPicker,
  ) {}

  async resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
  ): Promise<void> {
    const distUri = Uri.joinPath(
      this.extensionUri,
      "client",
      "dist",
      "webview",
    );
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri],
    };
    panel.webview.html = this.html(panel, distUri);

    const resource = resourceForUri(document.uri);
    const isWorkspace = document.uri.scheme === WORKSPACE_SCHEME;
    // Only workspace jobs are written by this editor; the repository and its
    // versions are read-only file systems, and the service owns other files.
    const readOnly = !isWorkspace && document.uri.scheme !== "file";
    const post = (message: ToEditor) => panel.webview.postMessage(message);
    // The text this editor last wrote, so its own edits are not sent back.
    let written: string | undefined;

    const subscriptions: Disposable[] = [
      workspace.onDidChangeTextDocument((event) => {
        if (
          event.document.uri.toString() !== document.uri.toString() ||
          !event.contentChanges.length
        ) {
          return;
        }
        // Skip the echo of this editor's own edit, once: an undo and redo
        // back to the same text must still reach the form.
        if (document.getText() === written) {
          written = undefined;
          return;
        }
        void post({ type: "text", text: document.getText() });
      }),
      panel.webview.onDidReceiveMessage(async (message: FromEditor) => {
        switch (message.type) {
          case "ready":
            void post({
              type: "init",
              text: document.getText(),
              readOnly,
              location: resource?.location ?? parentPath(document.uri.path),
              resourceLocation: resource?.resourceLocation ?? "WORKSPACE",
              canBrowse: !!resource && !readOnly,
              fileName: baseName(document.uri.path),
              labels: EditorLabelText,
            });
            break;
          case "edit":
            if (!readOnly && message.text !== document.getText()) {
              written = message.text;
              const edit = new WorkspaceEdit();
              edit.replace(
                document.uri,
                new Range(0, 0, document.lineCount, 0),
                message.text,
              );
              await workspace.applyEdit(edit);
            }
            break;
          case "pick": {
            const path = await this.picker.pick({
              mode: message.mode,
              location: message.resourceLocation,
              title:
                message.mode === "file"
                  ? JobMessages.EditorPickFile
                  : JobMessages.EditorPickFolder,
              startPath: message.startPath,
            });
            void post({ type: "picked", requestId: message.requestId, path });
            break;
          }
          case "open":
            if (isWorkspace) {
              await commands.executeCommand(
                "vscode.open",
                getWorkspaceUri({ path: message.path }),
                { preview: false },
              );
            }
            break;
          case "run":
            if (document.isDirty && !(await document.save())) {
              return;
            }
            await commands.executeCommand("SAS.clinical.job.run", document.uri);
            break;
          case "openText":
            await commands.executeCommand(
              "vscode.openWith",
              document.uri,
              "default",
            );
            break;
        }
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((d) => d.dispose()));
  }

  private html(panel: WebviewPanel, distUri: Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const webview = panel.webview;
    const script = webview.asWebviewUri(
      Uri.joinPath(distUri, "ClinicalJobEditor.js"),
    );
    const style = webview.asWebviewUri(
      Uri.joinPath(distUri, "ClinicalJobEditor.css"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
