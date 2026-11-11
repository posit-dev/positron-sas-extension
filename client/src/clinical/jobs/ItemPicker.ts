// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// A quick pick that browses the workspace or the repository folder by folder
// and returns the path of a file or folder: the FILE and FOLDER parameters of
// a job, and later the job editor's program and input lists.
import { QuickPickItem, l10n, window } from "vscode";

import type { RepositoryModel } from "../RepositoryModel";
import type { WorkspaceModel } from "../WorkspaceModel";
import type { RepositoryItem } from "../types";
import { isContainer, isWorkspaceFolder } from "../utils";
import { JobMessages } from "./messages";
import type { ResourceLocation } from "./types";
import { parentPath } from "./utils";

interface Entry {
  name: string;
  path: string;
  folder: boolean;
  /** Repository items are browsed by id. */
  item?: RepositoryItem;
}

interface PickItem extends QuickPickItem {
  action: "parent" | "use" | "open" | "pick";
  entry?: Entry;
}

export interface PickOptions {
  mode: "file" | "folder";
  location: ResourceLocation;
  title: string;
  /** Workspace only: the folder to start in. */
  startPath?: string;
}

export class ItemPicker {
  constructor(
    private readonly repository: RepositoryModel,
    private readonly workspace: WorkspaceModel,
  ) {}

  /** The chosen path, or undefined when the user cancels. */
  async pick(options: PickOptions): Promise<string | undefined> {
    // The folders above the current one; the last is the current folder.
    const trail: Entry[] = [];
    if (options.location === "WORKSPACE" && options.startPath) {
      let path = options.startPath;
      const chain: Entry[] = [];
      while (path !== "/") {
        chain.unshift({
          name: path.split("/").pop() ?? path,
          path,
          folder: true,
        });
        path = parentPath(path);
      }
      trail.push(...chain);
    }

    const quickPick = window.createQuickPick<PickItem>();
    quickPick.title = options.title;
    quickPick.matchOnDescription = true;
    try {
      for (;;) {
        const current = trail[trail.length - 1];
        quickPick.placeholder = current?.path ?? "/";
        quickPick.busy = true;
        quickPick.items = [];
        quickPick.show();
        let entries: Entry[];
        try {
          entries = await this.children(options.location, current);
        } catch (error) {
          window.showErrorMessage(String(error));
          return undefined;
        }
        quickPick.busy = false;
        quickPick.items = this.items(entries, options.mode, trail.length > 0);
        const chosen = await new Promise<PickItem | undefined>((resolve) => {
          const accept = quickPick.onDidAccept(() => {
            accept.dispose();
            hide.dispose();
            resolve(quickPick.selectedItems[0]);
          });
          const hide = quickPick.onDidHide(() => {
            accept.dispose();
            hide.dispose();
            resolve(undefined);
          });
        });
        if (!chosen) {
          return undefined;
        }
        switch (chosen.action) {
          case "parent":
            trail.pop();
            break;
          case "use":
            return current?.path ?? "/";
          case "open":
            if (chosen.entry) {
              trail.push(chosen.entry);
            }
            break;
          case "pick":
            return chosen.entry?.path;
        }
        quickPick.value = "";
      }
    } finally {
      quickPick.dispose();
    }
  }

  private items(
    entries: Entry[],
    mode: PickOptions["mode"],
    canGoUp: boolean,
  ): PickItem[] {
    const items: PickItem[] = [];
    if (canGoUp) {
      items.push({
        label: `$(arrow-up) ${JobMessages.ParentFolder}`,
        action: "parent",
        alwaysShow: true,
      });
    }
    if (mode === "folder") {
      items.push({
        label: `$(check) ${JobMessages.UseThisFolder}`,
        action: "use",
        alwaysShow: true,
      });
    }
    const sorted = [...entries].sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name),
    );
    for (const entry of sorted) {
      if (entry.folder) {
        items.push({
          label: `$(folder) ${entry.name}`,
          action: "open",
          entry,
        });
      } else if (mode === "file") {
        items.push({
          label: `$(file) ${entry.name}`,
          description: l10n.t("file"),
          action: "pick",
          entry,
        });
      }
    }
    return items;
  }

  private async children(
    location: ResourceLocation,
    folder: Entry | undefined,
  ): Promise<Entry[]> {
    if (location === "WORKSPACE") {
      const items = await this.workspace.getChildren(
        folder
          ? { name: folder.name, path: folder.path, type: "FOLDER" }
          : undefined,
      );
      return items.map((item) => ({
        name: item.name,
        path: item.path,
        folder: isWorkspaceFolder(item),
      }));
    }
    const items = await this.repository.getChildren(folder?.item);
    return items.map((item) => ({
      name: item.name,
      path: item.path,
      folder: isContainer(item),
      item,
    }));
  }
}
