// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Ask where in the repository to search: anywhere, a folder chosen in a
// picker, or a typed path. Shared by the repository and audit searches.
import { QuickPickItem, window } from "vscode";

import { normalizeLocation, validateLocation } from "./auditQuery";
import type { ItemPicker } from "./jobs/ItemPicker";
import { Messages } from "./messages";

interface Choice extends QuickPickItem {
  value: "any" | "keep" | "suggested" | "pick" | "type";
}

export interface LocationPromptOptions {
  title: string;
  /** The location of the last search, offered again. */
  previous?: string;
  /** A folder to offer first, such as the one the search started from. */
  suggested?: string;
}

/**
 * The chosen folder path, "" for anywhere, or undefined when cancelled.
 * Paths have no trailing slash.
 */
export async function askLocation(
  picker: ItemPicker,
  { title, previous, suggested }: LocationPromptOptions,
): Promise<string | undefined> {
  const items: Choice[] = [
    ...(suggested
      ? [
          {
            label: suggested,
            description: Messages.LocationSelected,
            value: "suggested" as const,
          },
        ]
      : []),
    { label: Messages.LocationAnywhere, value: "any" },
    ...(previous && previous !== suggested
      ? [
          {
            label: previous,
            description: Messages.LocationKeep,
            value: "keep" as const,
          },
        ]
      : []),
    { label: Messages.LocationChooseFolder, value: "pick" },
    { label: Messages.LocationEnterPath, value: "type" },
  ];
  const choice = await window.showQuickPick(items, {
    title,
    placeHolder: Messages.LocationPlaceholder,
    ignoreFocusOut: true,
  });
  switch (choice?.value) {
    case undefined:
      return undefined;
    case "any":
      return "";
    case "suggested":
      return suggested;
    case "keep":
      return previous;
    case "pick": {
      const path = await picker.pick({
        mode: "folder",
        location: "REPOSITORY",
        title: Messages.LocationChooseFolder,
      });
      return path === undefined ? undefined : normalizeLocation(path);
    }
    default: {
      const path = await window.showInputBox({
        title,
        prompt: Messages.LocationPathPrompt,
        value: previous || suggested || "/",
        ignoreFocusOut: true,
        validateInput: (value) =>
          validateLocation(value) ? Messages.LocationPathInvalid : undefined,
      });
      return path === undefined ? undefined : normalizeLocation(path);
    }
  }
}
