// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { TabInputText, Uri, window } from "vscode";

/** The open text editors whose resource satisfies `match`. */
function findTabs(match: (uri: Uri) => boolean) {
  return window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const input = tab.input;
      return input instanceof TabInputText && match(input.uri);
    });
}

/** Close the open text editors whose resource satisfies `match`. */
export async function closeEditors(
  match: (uri: Uri) => boolean,
): Promise<boolean> {
  const tabs = findTabs(match);
  if (tabs.length > 0) {
    await window.tabGroups.close(tabs);
  }
  return tabs.length > 0;
}
