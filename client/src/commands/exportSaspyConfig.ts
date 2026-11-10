// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, l10n, window, workspace } from "vscode";

import * as fs from "fs";
import * as path from "path";

import { ConnectionType, ProfileConfig } from "../components/profile";
import {
  SASPY_TOKEN_ENV,
  profileToSaspyConfig,
  saspyConfigName,
  writeSaspyConfig,
} from "../positron/saspyConfig";

export interface ExportSaspyConfigResult {
  /** Full path of the sascfg_personal.py file. */
  path: string;
  /** Name of the configuration in the file, for saspy's `cfgname`. */
  configName: string;
  /** Set when the connection needs a token in this environment variable. */
  tokenEnvVar?: string;
  /**
   * Set when the connection needs a token. Run this command, or set the
   * environment variable, before connecting.
   */
  tokenCommand?: string;
  /** False when the file already had this exact content. */
  changed: boolean;
  /** Set when a different file was there: where its content was kept. */
  backupPath?: string;
}

/** A folder from the command argument: a folder, or a file in the folder. */
function folderFromArgument(target: string | Uri): string {
  const fsPath = typeof target === "string" ? target : target.fsPath;
  return fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()
    ? fsPath
    : path.dirname(fsPath);
}

async function pickFolder(): Promise<string | undefined> {
  // Next to the .qmd file when one is open: saspy searches the working
  // directory, and Quarto renders with the document's folder as that.
  const editor = window.activeTextEditor;
  if (
    editor?.document.uri.scheme === "file" &&
    /\.qmd$/i.test(editor.document.fileName)
  ) {
    return path.dirname(editor.document.fileName);
  }
  const folder =
    workspace.workspaceFolders?.length > 1
      ? await window.showWorkspaceFolderPick()
      : workspace.workspaceFolders?.[0];
  if (folder) {
    return folder.uri.fsPath;
  }
  const picked = await window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: l10n.t("Save here"),
  });
  return picked?.[0]?.fsPath;
}

/**
 * Write the active SAS connection profile as a saspy configuration
 * (sascfg_personal.py), the file sasquatch and saspy read to connect to SAS.
 * Never writes secrets: SAS Viya reads its token from the environment.
 *
 * Also called by Posit Assistant, so it returns a result and throws on errors.
 *
 * @param target Optional folder, or a file in the folder, to write into.
 *   Without it, the folder of the open .qmd file, or the workspace folder.
 */
export async function exportSaspyConfig(
  target?: string | Uri,
): Promise<ExportSaspyConfigResult | undefined> {
  const profileConfig = new ProfileConfig();
  const profileName = profileConfig.getActiveProfile();
  if (!profileName) {
    throw new Error(
      l10n.t(
        "No active SAS connection profile. Add one with SAS: Add New Connection Profile.",
      ),
    );
  }
  const profile = profileConfig.getProfileByName(profileName);
  if (!profile) {
    throw new Error(
      l10n.t(
        'SAS connection profile "{0}" was not found in the settings.',
        profileName,
      ),
    );
  }

  const dir = target ? folderFromArgument(target) : await pickFolder();
  if (!dir) {
    return undefined;
  }

  // Never asks: an assistant may run this unattended, and a dialog would block
  // it. A different file is kept as a backup instead.
  const result = writeSaspyConfig(
    dir,
    profileToSaspyConfig(profileName, profile),
  );

  const tokenEnvVar =
    profile.connectionType === ConnectionType.Rest
      ? SASPY_TOKEN_ENV
      : undefined;
  const parts = [
    result.backupPath
      ? l10n.t(
          "Saved {0}. The previous file was kept as {1}.",
          result.path,
          result.backupPath,
        )
      : l10n.t("Saved {0}.", result.path),
  ];
  if (tokenEnvVar) {
    parts.push(
      l10n.t(
        "Before a render, run SAS: Save Viya Token for saspy, or set the {0} environment variable to a SAS Viya access token.",
        tokenEnvVar,
      ),
    );
  }
  const message = parts.join(" ");
  // Not awaited: the message stays up until dismissed, and callers need the result.
  window
    .showInformationMessage(message, l10n.t("Open"))
    .then((answer) =>
      answer ? window.showTextDocument(Uri.file(result.path)) : undefined,
    );

  return {
    path: result.path,
    configName: saspyConfigName(profileName),
    tokenEnvVar,
    tokenCommand: tokenEnvVar ? "SAS.saveViyaTokenForSaspy" : undefined,
    changed: result.status === "written",
    backupPath: result.backupPath,
  };
}
