// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The SAS Job Schedules view: the schedules this extension created for the
// user, most recently changed first. The description says when a schedule
// runs; the next runs, the last run and the values it passes are read when
// the user hovers.
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

import type { SchedulesModel } from "./SchedulesModel";
import { JOBS_PAGE_LIMIT } from "./const";
import {
  BackgroundJobMessages,
  TriggerWordText,
  backgroundJobErrorMessage,
} from "./messages";
import {
  SchedulerJob,
  describeTrigger,
  isEnabled,
  jobRequestIdOf,
  lastRun,
} from "./schedules";

export const SCHEDULES_VIEW_ID = "sasjobschedulesprovider";

export type ScheduleNode =
  | { kind: "schedule"; schedule: SchedulerJob }
  | { kind: "message"; text: string; icon?: string }
  | { kind: "more" };

/** When a schedule runs, as a sentence. */
export const whenText = (schedule: SchedulerJob) =>
  schedule.triggers.map((t) => describeTrigger(t, TriggerWordText)).join("; ");

export class SchedulesDataProvider
  implements TreeDataProvider<ScheduleNode>, Disposable
{
  private readonly changed = new EventEmitter<ScheduleNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly treeView: TreeView<ScheduleNode>;
  private schedules: SchedulerJob[] = [];
  private hasMore = false;
  private loaded = false;
  private loadError: string | undefined;
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly model: SchedulesModel,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(SCHEDULES_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
    this.disposables.push(this.treeView, this.changed);
  }

  refresh(): void {
    this.loaded = false;
    this.schedules = [];
    this.hasMore = false;
    this.changed.fire(undefined);
  }

  /** Show a schedule that just changed, without reloading the list. */
  upsert(schedule: SchedulerJob): void {
    const index = this.schedules.findIndex((s) => s.id === schedule.id);
    if (index >= 0) {
      this.schedules[index] = schedule;
    } else if (this.loaded) {
      this.schedules.unshift(schedule);
    }
    this.changed.fire(undefined);
  }

  getParent(): undefined {
    return undefined;
  }

  async getChildren(node?: ScheduleNode): Promise<ScheduleNode[]> {
    if (node) {
      return [];
    }
    if (!this.loaded) {
      try {
        const page = await this.model.listSchedules(0, JOBS_PAGE_LIMIT);
        this.schedules = page.items;
        this.hasMore = page.hasMore;
        this.loadError = undefined;
      } catch (error) {
        this.schedules = [];
        this.hasMore = false;
        this.loadError = backgroundJobErrorMessage(error);
        this.log(`Could not list schedules: ${this.loadError}`);
      }
      this.loaded = true;
    }
    if (this.loadError) {
      return [
        {
          kind: "message",
          text: l10n.t(BackgroundJobMessages.SchedulesListError, {
            message: this.loadError,
          }),
          icon: "error",
        },
      ];
    }
    if (!this.schedules.length) {
      return [{ kind: "message", text: BackgroundJobMessages.NoSchedules }];
    }
    const nodes: ScheduleNode[] = this.schedules.map((schedule) => ({
      kind: "schedule",
      schedule,
    }));
    return this.hasMore ? [...nodes, { kind: "more" }] : nodes;
  }

  async loadMore(): Promise<void> {
    try {
      const page = await this.model.listSchedules(
        this.schedules.length,
        JOBS_PAGE_LIMIT,
      );
      const known = new Set(this.schedules.map((s) => s.id));
      this.schedules = [
        ...this.schedules,
        ...page.items.filter((s) => !known.has(s.id)),
      ];
      this.hasMore = page.hasMore;
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SchedulesListError, {
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
    this.changed.fire(undefined);
  }

  getTreeItem(node: ScheduleNode): TreeItem {
    switch (node.kind) {
      case "schedule": {
        const { schedule } = node;
        const enabled = isEnabled(schedule);
        const item = new TreeItem(schedule.name);
        item.id = schedule.id;
        item.iconPath = new ThemeIcon(enabled ? "calendar" : "circle-slash");
        item.description = [
          whenText(schedule),
          enabled ? "" : BackgroundJobMessages.Disabled,
        ]
          .filter(Boolean)
          .join(" · ");
        item.contextValue = `;sasschedule;${enabled ? "enabled" : "disabled"};`;
        return item;
      }
      case "more": {
        const item = new TreeItem(BackgroundJobMessages.LoadMore);
        item.command = {
          command: "SAS.sasJobSchedules.loadMore",
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

  /** Next runs, last run and the values passed, read when hovering. */
  async resolveTreeItem(
    item: TreeItem,
    node: ScheduleNode,
    token: CancellationToken,
  ): Promise<TreeItem> {
    if (node.kind !== "schedule" || !node.schedule.id) {
      return item;
    }
    const { schedule } = node;
    const markdown = new MarkdownString();
    markdown.appendMarkdown(`**${escapeMarkdown(schedule.name)}**\n\n`);
    markdown.appendMarkdown(`${escapeMarkdown(whenText(schedule))}  \n`);
    const zone = schedule.triggers[0]?.timezone;
    if (zone) {
      markdown.appendMarkdown(
        `${BackgroundJobMessages.TimeZone}: ${escapeMarkdown(zone)}  \n`,
      );
    }
    try {
      const requestId = jobRequestIdOf(schedule);
      const [request, next, history] = await Promise.all([
        requestId ? this.model.getJobRequest(requestId) : undefined,
        this.model.fireTimes(schedule.id!),
        this.model.history(schedule.id!),
      ]);
      if (request?.name) {
        markdown.appendMarkdown(
          `${BackgroundJobMessages.SasJob}: ${escapeMarkdown(request.name)}  \n`,
        );
      }
      const values = Object.entries(request?.arguments ?? {}).filter(
        ([k]) => !k.startsWith("_"),
      );
      if (values.length) {
        markdown.appendMarkdown(
          `${BackgroundJobMessages.Values}: ${values
            .map(([k, v]) => `\`&${k}\` = ${escapeMarkdown(v || '""')}`)
            .join(", ")}  \n`,
        );
      }
      markdown.appendMarkdown(
        `${BackgroundJobMessages.NextRuns}: ${
          next.length
            ? next.map((t) => new Date(t).toLocaleString()).join(", ")
            : isEnabled(schedule)
              ? BackgroundJobMessages.NoMoreRuns
              : BackgroundJobMessages.Disabled
        }  \n`,
      );
      const last = lastRun(history);
      if (last?.at) {
        markdown.appendMarkdown(
          `${BackgroundJobMessages.LastRun}: ${new Date(last.at).toLocaleString()}, ${
            last.ok
              ? BackgroundJobMessages.LastRunStarted
              : l10n.t(BackgroundJobMessages.LastRunFailed, {
                  status: last.status ?? "?",
                })
          }  \n`,
        );
      }
    } catch (error) {
      this.log(`Could not read schedule ${schedule.id}: ${error}`);
    }
    if (!token.isCancellationRequested) {
      item.tooltip = markdown;
    }
    return item;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
