// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, WebviewPanel, commands, window } from "vscode";

import { isPositron } from "./index";

let fallbackNoticeShown = false;

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
