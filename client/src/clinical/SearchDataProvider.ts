// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The Search Results view: repository items found by name, location, file
// content and properties, like the Search page of SAS Clinical Acceleration
// Repository. Results are ordinary repository items, drawn and menued like
// in the Clinical Repository view, so the same commands work on them.
import {
  Disposable,
  EventEmitter,
  QuickPickItem,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  commands,
  l10n,
  window,
} from "vscode";

import type { RepositoryDataProvider } from "./RepositoryDataProvider";
import type { RepositoryModel } from "./RepositoryModel";
import { SEARCH_VIEW_ID } from "./const";
import type { ItemPicker } from "./jobs/ItemPicker";
import { askLocation } from "./locationPrompt";
import { Messages, errorMessage } from "./messages";
import {
  SearchQuery,
  buildSearchFilter,
  isEmptyQuery,
  parentPath,
  validateContentText,
} from "./searchQuery";
import type { RepositoryItem } from "./types";
import { isContainer } from "./utils";

/** At most this many results per search (one page of the server). */
export const MAX_SEARCH_RESULTS = 500;

const STEPS = 4;

type Refinement =
  | "files"
  | "folders"
  | "ownedByMe"
  | "checkedOutByMe"
  | "signed"
  | "modified7"
  | "modified30";

interface RefinePick extends QuickPickItem {
  value: Refinement;
}

export class SearchDataProvider
  implements TreeDataProvider<RepositoryItem>, Disposable
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    RepositoryItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly treeView: TreeView<RepositoryItem>;
  private results: RepositoryItem[] = [];
  private query: SearchQuery | undefined;
  // Drops the result of a search that a newer one has overtaken.
  private generation = 0;

  constructor(
    private readonly model: RepositoryModel,
    private readonly repository: RepositoryDataProvider,
    private readonly picker: ItemPicker,
    private readonly output: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(SEARCH_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
  }

  /** The clicked result plus any other selected results. */
  selection(item: RepositoryItem | undefined): RepositoryItem[] {
    const selected = this.treeView.selection;
    if (!item) {
      return [...selected];
    }
    return selected.some((s) => s.id === item.id) ? [...selected] : [item];
  }

  /** Whether `item` is selected in this view (so commands act on its selection). */
  isSelected(item: RepositoryItem | undefined): boolean {
    return !!item && this.treeView.selection.some((s) => s.id === item.id);
  }

  /** Ask for a new search, starting in `folder` if given, and run it. */
  async newSearch(folder?: RepositoryItem): Promise<void> {
    // From a folder's menu: a fresh search in that folder. Otherwise the
    // last search's choices are offered again.
    const inFolder = folder && isContainer(folder) ? folder.path : undefined;
    const query = await this.ask(inFolder ? {} : (this.query ?? {}), inFolder);
    if (query) {
      await this.run(query);
    }
  }

  /** Change the current search. */
  async editSearch(): Promise<void> {
    const query = await this.ask(this.query ?? {});
    if (query) {
      await this.run(query);
    }
  }

  /** Run the current search again. */
  async refresh(): Promise<void> {
    if (this.query) {
      await this.run(this.query, false);
    }
  }

  clear(): void {
    this.generation++;
    this.query = undefined;
    this.results = [];
    this.treeView.message = undefined;
    this.treeView.description = undefined;
    void commands.executeCommand("setContext", SEARCH_ACTIVE_KEY, false);
    this._onDidChangeTreeData.fire(undefined);
  }

  private async run(query: SearchQuery, reveal = true): Promise<void> {
    this.query = query;
    const generation = ++this.generation;
    void commands.executeCommand("setContext", SEARCH_ACTIVE_KEY, true);
    if (reveal) {
      void commands.executeCommand(`${SEARCH_VIEW_ID}.focus`);
    }
    try {
      const userId = await this.model.getCurrentUserId();
      const filter = buildSearchFilter(query, userId);
      this.output(
        `Repository search: filter ${filter ?? "(none)"}${query.text ? `, content "${query.text}"` : ""}`,
      );
      const found = await window.withProgress(
        { location: { viewId: SEARCH_VIEW_ID } },
        () => this.model.searchItems(filter, query.text, MAX_SEARCH_RESULTS),
      );
      if (generation !== this.generation) {
        return;
      }
      this.results = found.items;
      const count = found.items.length;
      this.treeView.message = !count
        ? Messages.SearchNoResults
        : found.total !== undefined && found.total > count
          ? l10n.t(Messages.SearchMoreResults, { count, total: found.total })
          : found.limitReached
            ? l10n.t(Messages.SearchMayHaveMore, { count })
            : l10n.t(Messages.SearchResultCount, { count });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      const message = l10n.t(Messages.SearchError, {
        message: errorMessage(error),
      });
      this.output(message);
      this.results = [];
      this.treeView.message = message;
    }
    this.treeView.description = describe(query);
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(
    item?: RepositoryItem,
  ): Promise<RepositoryItem[]> | RepositoryItem[] {
    return item ? this.repository.getChildren(item) : this.results;
  }

  async getTreeItem(item: RepositoryItem): Promise<TreeItem> {
    // The menus depend on the permission: read it before drawing, since this
    // view isn't told when the Clinical Repository view learns it.
    if (!this.model.getKnownPermission(item.id)) {
      await this.model.loadPermission(item.id).catch(() => undefined);
    }
    const treeItem = await this.repository.getTreeItem(item);
    // An item can be a result and inside another result: ids must be unique.
    treeItem.id = undefined;
    if (this.results.includes(item)) {
      treeItem.description = [treeItem.description, parentPath(item.path)]
        .filter(Boolean)
        .join(" · ");
      if (isContainer(item)) {
        treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed;
      }
    }
    return treeItem;
  }

  private async ask(
    previous: SearchQuery,
    suggested?: string,
  ): Promise<SearchQuery | undefined> {
    const name = await window.showInputBox({
      title: step(1),
      prompt: Messages.SearchNamePrompt,
      value: previous.name ?? "",
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return undefined;
    }
    const location = await askLocation(this.picker, {
      title: step(2),
      previous: previous.location,
      suggested,
    });
    if (location === undefined) {
      return undefined;
    }
    const text = await window.showInputBox({
      title: step(3),
      prompt: Messages.SearchContentPrompt,
      value: previous.text ?? "",
      ignoreFocusOut: true,
      validateInput: (value) =>
        validateContentText(value) ? Messages.SearchContentInvalid : undefined,
    });
    if (text === undefined) {
      return undefined;
    }
    const refine = await this.askRefinements(previous);
    if (refine === undefined) {
      return undefined;
    }
    const query: SearchQuery = {
      name: name.trim() || undefined,
      location: location || undefined,
      text: text.trim() || undefined,
      ...refine,
    };
    if (isEmptyQuery(query)) {
      const all = await window.showWarningMessage(
        Messages.SearchEverything,
        { modal: true },
        Messages.SearchEverythingButton,
      );
      if (all !== Messages.SearchEverythingButton) {
        return undefined;
      }
    }
    return query;
  }

  private async askRefinements(
    previous: SearchQuery,
  ): Promise<Partial<SearchQuery> | undefined> {
    const items: RefinePick[] = [
      { label: Messages.SearchOnlyFiles, value: "files" },
      { label: Messages.SearchOnlyFolders, value: "folders" },
      { label: Messages.SearchOwnedByMe, value: "ownedByMe" },
      { label: Messages.SearchCheckedOutByMe, value: "checkedOutByMe" },
      { label: Messages.SearchSigned, value: "signed" },
      { label: Messages.SearchModified7, value: "modified7" },
      { label: Messages.SearchModified30, value: "modified30" },
    ];
    const was = (value: Refinement): boolean => {
      switch (value) {
        case "files":
        case "folders":
          return previous.kind === value;
        case "modified7":
          return previous.modifiedDays === 7;
        case "modified30":
          return previous.modifiedDays === 30;
        default:
          return !!previous[value];
      }
    };
    const picks = await window.showQuickPick(
      items.map((item) => ({ ...item, picked: was(item.value) })),
      {
        title: step(4),
        placeHolder: Messages.SearchRefinePlaceholder,
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    if (!picks) {
      return undefined;
    }
    const picked = new Set(picks.map((p) => p.value));
    return {
      // Both kinds is the same as either.
      kind:
        picked.has("files") === picked.has("folders")
          ? undefined
          : picked.has("files")
            ? "files"
            : "folders",
      ownedByMe: picked.has("ownedByMe") || undefined,
      checkedOutByMe: picked.has("checkedOutByMe") || undefined,
      signed: picked.has("signed") || undefined,
      // The shorter period wins.
      modifiedDays: picked.has("modified7")
        ? 7
        : picked.has("modified30")
          ? 30
          : undefined,
    };
  }

  dispose(): void {
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

/** Context key: a search has been run, for the view's title bar actions. */
export const SEARCH_ACTIVE_KEY = "SAS.clinical.searchActive";

const step = (n: number): string =>
  l10n.t(Messages.SearchStep, { step: n, total: STEPS });

/** The search in a few words, for the view's description. */
function describe(query: SearchQuery): string {
  return [
    query.name,
    query.text && `"${query.text}"`,
    query.location && `${Messages.SearchIn} ${query.location}`,
  ]
    .filter(Boolean)
    .join(" ");
}
