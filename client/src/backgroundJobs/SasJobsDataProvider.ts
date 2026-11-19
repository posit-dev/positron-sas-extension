// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The SAS Jobs view: the user's job definitions on the active SAS Viya
// server, most recently changed first. That includes jobs saved from
// Positron, jobs made in SAS Studio, and the copies Submit as Background Job
// keeps in My Folder/Positron Jobs.
import {
  CancellationToken,
  Disposable,
  EventEmitter,
  MarkdownString,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeView,
  l10n,
  window,
} from "vscode";

import type { JobsModel } from "./JobsModel";
import { CREATED_BY_PROPERTY, JOBS_PAGE_LIMIT } from "./const";
import { BackgroundJobMessages, backgroundJobErrorMessage } from "./messages";
import { folderPath, promptableParameters } from "./parameters";
import type { JobDefinition } from "./types";

export const SAS_JOBS_VIEW_ID = "sasjobsprovider";

export type SasJobNode =
  | { kind: "definition"; definition: JobDefinition }
  | { kind: "message"; text: string; icon?: string }
  | { kind: "more" };

/** Whether Submit as Background Job made this definition. */
export const fromSubmit = (definition: JobDefinition) =>
  (definition.properties ?? []).some(
    (p) => p.name === CREATED_BY_PROPERTY && p.value === "true",
  );

export class SasJobsDataProvider
  implements TreeDataProvider<SasJobNode>, Disposable
{
  private readonly changed = new EventEmitter<SasJobNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly treeView: TreeView<SasJobNode>;
  private definitions: JobDefinition[] = [];
  private hasMore = false;
  private loaded = false;
  private loadError: string | undefined;
  /** Folder paths by definition id, read on demand. */
  private readonly folders = new Map<string, string>();
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly model: JobsModel,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(SAS_JOBS_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
    this.disposables.push(this.treeView, this.changed);
  }

  refresh(): void {
    this.loaded = false;
    this.definitions = [];
    this.hasMore = false;
    this.folders.clear();
    this.changed.fire(undefined);
  }

  getParent(): undefined {
    return undefined;
  }

  async getChildren(node?: SasJobNode): Promise<SasJobNode[]> {
    if (node) {
      return [];
    }
    if (!this.loaded) {
      try {
        const page = await this.model.listDefinitions(0, JOBS_PAGE_LIMIT);
        this.definitions = page.items;
        this.hasMore = page.hasMore;
        this.loadError = undefined;
      } catch (error) {
        this.definitions = [];
        this.hasMore = false;
        this.loadError = backgroundJobErrorMessage(error);
        this.log(`Could not list SAS jobs: ${this.loadError}`);
      }
      this.loaded = true;
    }
    if (this.loadError) {
      return [
        {
          kind: "message",
          text: l10n.t(BackgroundJobMessages.SasJobsListError, {
            message: this.loadError,
          }),
          icon: "error",
        },
      ];
    }
    if (!this.definitions.length) {
      return [{ kind: "message", text: BackgroundJobMessages.NoSasJobs }];
    }
    const nodes: SasJobNode[] = this.definitions.map((definition) => ({
      kind: "definition",
      definition,
    }));
    return this.hasMore ? [...nodes, { kind: "more" }] : nodes;
  }

  async loadMore(): Promise<void> {
    try {
      const page = await this.model.listDefinitions(
        this.definitions.length,
        JOBS_PAGE_LIMIT,
      );
      const known = new Set(this.definitions.map((d) => d.id));
      this.definitions = [
        ...this.definitions,
        ...page.items.filter((d) => !known.has(d.id)),
      ];
      this.hasMore = page.hasMore;
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SasJobsListError, {
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
    this.changed.fire(undefined);
  }

  getTreeItem(node: SasJobNode): TreeItem {
    switch (node.kind) {
      case "definition":
        return this.definitionItem(node.definition);
      case "more": {
        const item = new TreeItem(BackgroundJobMessages.LoadMore);
        item.command = {
          command: "SAS.sasJobs.loadMore",
          title: BackgroundJobMessages.LoadMore,
        };
        return item;
      }
      case "message": {
        const item = new TreeItem(node.text);
        item.iconPath = node.icon ? new ThemeIcon(node.icon) : undefined;
        item.tooltip = node.text;
        return item;
      }
    }
  }

  /** The tooltip, with the folder, is built when the user hovers. */
  async resolveTreeItem(
    item: TreeItem,
    node: SasJobNode,
    token: CancellationToken,
  ): Promise<TreeItem> {
    if (node.kind !== "definition" || !node.definition.id) {
      return item;
    }
    const id = node.definition.id;
    if (!this.folders.has(id)) {
      try {
        const ancestors = await this.model.getAncestors(
          `/jobDefinitions/definitions/${id}`,
        );
        this.folders.set(id, ancestors.length ? folderPath(ancestors) : "");
      } catch (error) {
        this.log(`Could not read the folder of SAS job ${id}: ${error}`);
        this.folders.set(id, "");
      }
    }
    if (!token.isCancellationRequested) {
      item.tooltip = tooltip(node.definition, this.folders.get(id));
    }
    return item;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  private definitionItem(definition: JobDefinition): TreeItem {
    const item = new TreeItem(definition.name);
    item.id = definition.id;
    const parameters = promptableParameters(definition);
    const submitted = fromSubmit(definition);
    item.iconPath = new ThemeIcon(submitted ? "cloud-upload" : "symbol-event");
    item.description = [
      parameters.length
        ? l10n.t("{count} parameter(s)", { count: parameters.length })
        : "",
      submitted ? BackgroundJobMessages.FromSubmit : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const tokens = [
      "sasjob",
      parameters.length ? "hasParameters" : "",
      submitted ? "fromSubmit" : "",
    ].filter(Boolean);
    item.contextValue = `;${tokens.join(";")};`;
    return item;
  }
}

function tooltip(definition: JobDefinition, folder?: string): MarkdownString {
  const markdown = new MarkdownString();
  markdown.appendMarkdown(`**${escapeMarkdown(definition.name)}**\n\n`);
  if (definition.description) {
    markdown.appendMarkdown(`${escapeMarkdown(definition.description)}\n\n`);
  }
  if (folder) {
    markdown.appendMarkdown(
      `${BackgroundJobMessages.Folder}: ${escapeMarkdown(folder)}  \n`,
    );
  }
  for (const parameter of promptableParameters(definition)) {
    const detail = [
      parameter.type,
      parameter.defaultValue !== undefined
        ? `${BackgroundJobMessages.Default}: ${parameter.defaultValue}`
        : "",
      parameter.required ? BackgroundJobMessages.Required : "",
    ]
      .filter(Boolean)
      .join(", ");
    markdown.appendMarkdown(
      // A SAS name has no backticks, so it needs no escaping in a code span.
      `- \`&${parameter.name}\` (${escapeMarkdown(detail)})\n`,
    );
  }
  return markdown;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
