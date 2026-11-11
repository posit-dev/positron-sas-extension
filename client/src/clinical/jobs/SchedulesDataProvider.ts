// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The Clinical Job Schedules view: the user's schedules with their trigger in
// words and their status. A schedule expands into its job, its parameter
// values and its next run times.
import {
  Disposable,
  EventEmitter,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  l10n,
  window,
} from "vscode";

import { formatDate } from "../properties";
import type { JobsModel } from "./JobsModel";
import { describeValue } from "./manifestTree";
import { JobMessages, TriggerLabelText, jobErrorMessage } from "./messages";
import { uriForResource } from "./resources";
import {
  describeTrigger,
  scheduleContextValue,
  scheduleJob,
} from "./schedules";
import type { ParameterValue, Schedule } from "./types";

export const SCHEDULES_VIEW_ID = "clinicaljobschedulesprovider";

export type ScheduleNode =
  | { kind: "schedule"; schedule: Schedule }
  | { kind: "job"; schedule: Schedule }
  | { kind: "values"; values: ParameterValue[] }
  | { kind: "value"; value: ParameterValue }
  | { kind: "next"; schedule: Schedule }
  | { kind: "message"; text: string; icon?: string };

export class SchedulesDataProvider
  implements TreeDataProvider<ScheduleNode>, Disposable
{
  private readonly changed = new EventEmitter<ScheduleNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: TreeView<ScheduleNode>;

  constructor(
    private readonly model: JobsModel,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(SCHEDULES_VIEW_ID, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: ScheduleNode): Promise<ScheduleNode[]> {
    if (!node) {
      try {
        const schedules = await this.model.listSchedules();
        if (!schedules.length) {
          return [{ kind: "message", text: JobMessages.NoSchedules }];
        }
        return schedules
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((schedule) => ({ kind: "schedule", schedule }));
      } catch (error) {
        const message = jobErrorMessage(error);
        this.log(`Could not list clinical job schedules: ${message}`);
        return [
          {
            kind: "message",
            text: l10n.t(JobMessages.SchedulesError, { message }),
            icon: "error",
          },
        ];
      }
    }
    switch (node.kind) {
      case "schedule": {
        const values = node.schedule.jobInfo?.parameterValues ?? [];
        return [
          { kind: "job", schedule: node.schedule },
          ...(values.length
            ? [{ kind: "values", values } satisfies ScheduleNode]
            : []),
          { kind: "next", schedule: node.schedule },
        ];
      }
      case "values":
        return node.values.map((value) => ({ kind: "value", value }));
      case "next":
        return this.nextRuns(node.schedule);
      default:
        return [];
    }
  }

  getTreeItem(node: ScheduleNode): TreeItem {
    switch (node.kind) {
      case "schedule":
        return this.scheduleItem(node.schedule);
      case "job": {
        const job = scheduleJob(node.schedule);
        const item = new TreeItem(job?.name ?? "");
        item.description = `${JobMessages.ScheduleJob} · ${job?.location ?? ""}`;
        item.tooltip = job?.path;
        item.iconPath = new ThemeIcon("file-code");
        const uri = job && uriForResource(job);
        if (uri) {
          item.command = {
            command: "vscode.open",
            title: job.name,
            arguments: [uri],
          };
        }
        return item;
      }
      case "values": {
        const item = new TreeItem(
          JobMessages.GroupParameters,
          TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new ThemeIcon("symbol-parameter");
        item.description = String(node.values.length);
        return item;
      }
      case "value": {
        const item = new TreeItem(
          node.value.label && node.value.label !== "null"
            ? node.value.label
            : node.value.name,
        );
        item.description = describeValue(node.value);
        item.iconPath = new ThemeIcon("symbol-variable");
        return item;
      }
      case "next": {
        const item = new TreeItem(
          JobMessages.ScheduleNextRuns,
          TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new ThemeIcon("calendar");
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

  dispose(): void {
    this.treeView.dispose();
    this.changed.dispose();
  }

  private async nextRuns(schedule: Schedule): Promise<ScheduleNode[]> {
    try {
      const times = await this.model.getFutureRuns(schedule.id, 5);
      if (!times.length) {
        return [{ kind: "message", text: JobMessages.ScheduleNoNextRuns }];
      }
      return times.map((time) => ({
        kind: "message",
        text: formatDate(time),
        icon: "clock",
      }));
    } catch (error) {
      return [
        { kind: "message", text: jobErrorMessage(error), icon: "warning" },
      ];
    }
  }

  private scheduleItem(schedule: Schedule): TreeItem {
    const item = new TreeItem(
      schedule.name,
      TreeItemCollapsibleState.Collapsed,
    );
    item.id = `schedule:${schedule.id}`;
    const disabled = schedule.status === "DISABLED";
    const trigger = describeTrigger(schedule.trigger, TriggerLabelText);
    item.description = disabled
      ? `${trigger} · ${JobMessages.ScheduleDisabled}`
      : trigger;
    const missing = schedule.jobAvailable === false;
    item.iconPath = missing
      ? new ThemeIcon("warning", new ThemeColor("editorWarning.foreground"))
      : new ThemeIcon(disabled ? "circle-slash" : "calendar");
    const job = scheduleJob(schedule);
    item.tooltip = new MarkdownString(
      [
        `**${schedule.name}**`,
        trigger,
        l10n.t(JobMessages.ScheduleTooltip, {
          job: job?.path ?? "",
          runAs: schedule.runAsDisplayName ?? schedule.runAs ?? "",
        }),
        schedule.description ?? "",
        missing ? JobMessages.ScheduleJobMissing : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    item.contextValue = scheduleContextValue(schedule);
    return item;
  }
}
