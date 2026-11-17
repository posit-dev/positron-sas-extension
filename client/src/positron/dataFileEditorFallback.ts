// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  Command,
  ExtensionContext,
  Tab,
  TabInputText,
  Uri,
  WebviewPanel,
  commands,
  window,
  workspace,
} from "vscode";

import type { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import {
  POSITRON_DATA_EXPLORER_EDITOR,
  positronHasReader,
  sasViewerFor,
} from "./dataFileReaders";
import {
  getActiveSession,
  isPositron,
  startSasConsole,
  waitForActiveSession,
} from "./index";

let fallbackNoticeShown = false;

// Files the user asked to open with SAS: no hand-off to Positron's reader.
const openWithSas = new Set<string>();

/**
 * The .sas7bdat and .xpt viewers open the file in Positron's Data Explorer,
 * which VS Code does not have (#92). Outside Positron, reopen the file in VS
 * Code's default editor instead of showing a viewer that can only fail, and
 * say why once per window. Returns true if the file was handed off.
 */
export async function reopenOutsidePositron(
  uri: Uri,
  panel: WebviewPanel,
): Promise<boolean> {
  if (isPositron()) {
    return false;
  }
  await commands.executeCommand("vscode.openWith", uri, "default");
  panel.dispose();
  if (!fallbackNoticeShown) {
    fallbackNoticeShown = true;
    void window.showInformationMessage(
      "SAS data files (.sas7bdat, .xpt) open in the Data Explorer in Positron. In VS Code, they open in the default editor.",
    );
  }
  return true;
}

/**
 * Whether Positron itself can open the file in the Data Explorer, without a
 * SAS session: Positron 2026.12 and later, unless the reader for the file
 * type is turned off in `dataExplorer.fileReaders`.
 */
export function positronCanRead(uri: Uri): boolean {
  return positronHasReader(
    workspace.getConfiguration("dataExplorer").get("fileReaders"),
    uri.path,
  );
}

/**
 * The command that opens a file from a view. In Positron, SAS data files
 * open with the extension's viewer, through the SAS session that is
 * connected to the view's content, rather than Positron's own reader.
 */
export function openCommand(uri: Uri, title = "Open"): Command {
  const viewer = isPositron() ? sasViewerFor(uri.path) : undefined;
  return viewer
    ? { command: "vscode.openWith", title, arguments: [uri, viewer] }
    : { command: "vscode.open", title, arguments: [uri] };
}

/** Open a file from a view, as {@link openCommand} does. */
export async function openResource(uri: Uri): Promise<void> {
  const { command, arguments: args = [] } = openCommand(uri);
  await commands.executeCommand(command, ...args);
}

/** Open a SAS data file from the Explorer with the extension's viewer. */
export async function openDataFileWithSas(uri: Uri | undefined): Promise<void> {
  const target = uri ?? window.activeTextEditor?.document.uri;
  const viewer = target && sasViewerFor(target.path);
  if (target && viewer) {
    openWithSas.add(target.toString());
    await commands.executeCommand("vscode.openWith", target, viewer);
  }
}

/**
 * With the viewers registered as an option (#141), a SAS data file that
 * Positron can't read (Positron before 2026.12, or its reader turned off)
 * would open as binary text. Reopen it with the extension's viewer instead.
 */
export function registerDataFileRedirect(context: ExtensionContext): void {
  const redirect = (tabs: readonly Tab[]) => {
    for (const tab of tabs) {
      if (!(tab.input instanceof TabInputText)) {
        continue;
      }
      const uri = tab.input.uri;
      const viewer = sasViewerFor(uri.path);
      if (!viewer || positronCanRead(uri)) {
        continue;
      }
      const options = {
        viewColumn: tab.group.viewColumn,
        preview: tab.isPreview,
      };
      void window.tabGroups
        .close(tab)
        .then(() =>
          commands.executeCommand("vscode.openWith", uri, viewer, options),
        );
    }
  };
  context.subscriptions.push(
    window.tabGroups.onDidChangeTabs(({ opened }) => redirect(opened)),
  );
  // Tabs that opened before the extension started.
  redirect(window.tabGroups.all.flatMap((group) => group.tabs));
}

/**
 * The SAS session to open a data file with. Without one, the file goes to
 * Positron's own Data Explorer if Positron can read it and the user didn't
 * ask for SAS with Open with SAS (`positronCanShow`
 * adds checks on the content) and the panel is closed; otherwise the user
 * can start a SAS session. Undefined when there is no session to use.
 */
export async function sessionForDataFile(
  uri: Uri,
  panel: WebviewPanel,
  showMessage: (message: string) => void,
  positronCanShow: () => Promise<boolean> = async () => true,
): Promise<SASLanguageRuntimeSession | undefined> {
  const explicit = openWithSas.delete(uri.toString());
  const session = getActiveSession();
  if (session) {
    return session;
  }
  if (
    !explicit &&
    positronCanRead(uri) &&
    (await positronCanShow().catch(() => false))
  ) {
    await commands.executeCommand(
      "vscode.openWith",
      uri,
      POSITRON_DATA_EXPLORER_EDITOR,
    );
    panel.dispose();
    return undefined;
  }
  let disposed = false;
  panel.onDidDispose(() => (disposed = true));
  const message = "No SAS session is running. Start one to open this file.";
  showMessage(message);
  const start = "Start SAS Session";
  if ((await window.showInformationMessage(message, start)) !== start) {
    return undefined;
  }
  if (!(await startSasConsole())) {
    if (!disposed) {
      showMessage(
        "No SAS connection profile to start. Add one with SAS: Add New Connection Profile.",
      );
    }
    return undefined;
  }
  const started = await waitForActiveSession();
  // Closing the tab while the session starts cancels opening the file.
  return disposed ? undefined : started;
}
