// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, window } from "vscode";

import { profileConfig } from "../commands/profile";
import { editorCodeToRun } from "./consoleDiagnostics";
import { getPositronApi } from "./index";

/**
 * In Positron, run SAS code from the editor (Run, Run Selection, Run Region)
 * in the SAS console, as Positron does for R and Python. Results then open in
 * the Viewer instead of a Result tab beside the editor (#77), and the log
 * goes to the console.
 *
 * Returns false when the run should take the upstream path: no editor, no
 * active profile (upstream asks for one), or a Python, R or SQL file from
 * SAS Content, which needs SASCodeDocument's PROC wrapping.
 */
export async function runEditorInConsole(
  selected: boolean,
  uri?: Uri,
): Promise<boolean> {
  const api = getPositronApi();
  const editor = uri
    ? window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === uri.toString(),
      )
    : window.activeTextEditor;
  if (
    !api ||
    !editor ||
    editor.document.languageId !== "sas" ||
    profileConfig.getActiveProfile() === ""
  ) {
    return false;
  }

  const document = editor.document;
  const code = editorCodeToRun(
    document.getText(),
    selected ? editor.selections.map((s) => document.getText(s)) : [],
  );
  await api.runtime.executeCode(
    "sas",
    code,
    true,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    document.uri,
  );
  return true;
}
