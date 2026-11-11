// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The Jobs view: the signed-in user's clinical job runs, newest first, with
// their live state. A run expands into its manifest, the audit record of what
// it ran, read and wrote; every file in it opens.
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

import { JOBS_VIEW_ID } from "../const";
import type { JobsModel } from "./JobsModel";
import { type JobNode, describeValue, manifestNodes } from "./manifestTree";
import { JobMessages, errorStatus, jobErrorMessage } from "./messages";
import { uriForResource } from "./resources";
import {
  executionIcon,
  humanizeState,
  isTerminal,
  outcomeOf,
  stateIcon,
} from "./state";
import type { Manifest, ManifestFile, Submission } from "./types";

/** How often runs that have not ended are checked while the view is visible. */
const REFRESH_INTERVAL_MS = 5000;

export class JobsDataProvider implements TreeDataProvider<JobNode>, Disposable {
  private readonly changed = new EventEmitter<JobNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: TreeView<JobNode>;
  private runs: JobNode[] = [];
  private hasMore = false;
  private loaded = false;
  private loadError: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly model: JobsModel,
    private readonly log: (message: string) => void,
  ) {
    this.treeView = window.createTreeView(JOBS_VIEW_ID, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.treeView,
      this.treeView.onDidChangeVisibility(() => this.updateTimer()),
    );
  }

  /** Reload the list from the server. */
  refresh(): void {
    this.loaded = false;
    this.runs = [];
    this.changed.fire(undefined);
  }

  /** Put a run that just started or ended at the top, or update it in place. */
  upsert(submission: Submission): void {
    const index = this.runs.findIndex(
      (node) => node.kind === "run" && node.submission.id === submission.id,
    );
    const node: JobNode = { kind: "run", submission };
    if (index >= 0) {
      this.runs[index] = node;
    } else if (this.loaded) {
      this.runs.unshift(node);
    }
    this.changed.fire(undefined);
    this.updateTimer();
  }

  async reveal(submission: Submission): Promise<void> {
    const node = this.runs.find(
      (n) => n.kind === "run" && n.submission.id === submission.id,
    );
    if (node) {
      await this.treeView.reveal(node, { select: true, focus: true });
    }
  }

  getParent(): undefined {
    // Only runs are revealed, and they are at the top level.
    return undefined;
  }

  async getChildren(node?: JobNode): Promise<JobNode[]> {
    if (!node) {
      return this.getRuns();
    }
    if (node.kind === "group") {
      return node.children;
    }
    if (node.kind === "run") {
      return this.getManifestNodes(node.submission);
    }
    return [];
  }

  getTreeItem(node: JobNode): TreeItem {
    switch (node.kind) {
      case "run":
        return this.runItem(node.submission);
      case "more": {
        const item = new TreeItem(JobMessages.LoadMore);
        item.command = {
          command: "SAS.clinical.jobs.loadMore",
          title: JobMessages.LoadMore,
        };
        return item;
      }
      case "message": {
        const item = new TreeItem(node.text);
        item.iconPath = node.icon ? new ThemeIcon(node.icon) : undefined;
        item.tooltip = node.text;
        return item;
      }
      case "group": {
        const item = new TreeItem(
          node.label,
          TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new ThemeIcon(node.icon);
        item.description = String(node.children.length);
        item.contextValue = ";jobGroup;";
        return item;
      }
      case "file":
        return this.fileItem(node.file, node.detail);
      case "program": {
        const item = this.fileItem(node.program);
        const time =
          node.program.executionTime !== undefined
            ? l10n.t(JobMessages.Seconds, {
                seconds: (node.program.executionTime / 1000).toFixed(1),
              })
            : "";
        item.description = [humanizeState(node.program.executionState), time]
          .filter(Boolean)
          .join(" · ");
        item.iconPath = new ThemeIcon(
          executionIcon(node.program.executionState),
        );
        if (node.program.executionInfo) {
          item.tooltip = `${node.program.resource.path}\n${node.program.executionInfo}`;
        }
        return item;
      }
      case "parameter": {
        const item = new TreeItem(node.value.label || node.value.name);
        item.description = describeValue(node.value);
        item.iconPath = new ThemeIcon("symbol-variable");
        item.tooltip = `${node.value.name} (${node.value.type}) = ${describeValue(node.value)}`;
        return item;
      }
      case "external": {
        const item = new TreeItem(node.reference.name);
        item.description = `${node.reference.location} · ${JobMessages.ExternalReference}`;
        item.iconPath = new ThemeIcon("link-external");
        item.tooltip = node.reference.referencingProgram;
        return item;
      }
      case "failure": {
        const item = new TreeItem(
          node.failure.itemName ?? node.failure.itemIdentifier ?? "",
        );
        item.description = node.failure.message;
        item.tooltip = node.failure.message;
        item.iconPath = new ThemeIcon(
          "error",
          new ThemeColor("errorForeground"),
        );
        return item;
      }
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.changed.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  /** The next page of runs. */
  async loadMore(): Promise<void> {
    const runs = this.runs.filter((n) => n.kind === "run");
    try {
      const page = await this.model.listSubmissions(runs.length);
      const known = new Set(
        runs.map((n) => (n.kind === "run" ? n.submission.id : "")),
      );
      this.runs = [
        ...runs,
        ...page.items
          .filter((s) => !known.has(s.id))
          .map((submission): JobNode => ({ kind: "run", submission })),
      ];
      this.hasMore = page.hasMore;
    } catch (error) {
      window.showErrorMessage(
        l10n.t(JobMessages.ListError, { message: jobErrorMessage(error) }),
      );
    }
    this.changed.fire(undefined);
  }

  private async getRuns(): Promise<JobNode[]> {
    if (!this.loaded) {
      try {
        const page = await this.model.listSubmissions();
        this.runs = page.items.map((submission) => ({
          kind: "run",
          submission,
        }));
        this.hasMore = page.hasMore;
        this.loadError = undefined;
      } catch (error) {
        this.runs = [];
        this.hasMore = false;
        this.loadError = jobErrorMessage(error);
        this.log(`Could not list clinical job runs: ${this.loadError}`);
      }
      this.loaded = true;
      this.updateTimer();
    }
    if (this.loadError) {
      return [
        {
          kind: "message",
          text: l10n.t(JobMessages.ListError, { message: this.loadError }),
          icon: "error",
        },
      ];
    }
    if (!this.runs.length) {
      return [{ kind: "message", text: JobMessages.NoRuns }];
    }
    return this.hasMore ? [...this.runs, { kind: "more" }] : this.runs;
  }

  private async getManifestNodes(submission: Submission): Promise<JobNode[]> {
    if (!isTerminal(submission.state)) {
      return [
        {
          kind: "message",
          text: JobMessages.StillRunning,
          icon: "loading~spin",
        },
      ];
    }
    let manifest: Manifest;
    try {
      manifest = await this.model.getSubmissionManifest(submission.id);
    } catch (error) {
      const message = jobErrorMessage(error);
      this.log(
        `Manifest of run ${submission.id} (${submission.job.path}, ${submission.state}): ${errorStatus(error)} ${message}`,
      );
      return [
        {
          kind: "message",
          text: l10n.t(JobMessages.ManifestError, { message }),
          icon: "warning",
        },
      ];
    }
    return manifestNodes(manifest, submission.checkinFailures ?? [], {
      programs: JobMessages.GroupPrograms,
      parameters: JobMessages.GroupParameters,
      inputs: JobMessages.GroupInputs,
      outputs: JobMessages.GroupOutputs,
      logs: JobMessages.GroupLogs,
      results: JobMessages.GroupResults,
      checkinFailures: JobMessages.GroupCheckinFailures,
    });
  }

  private runItem(submission: Submission): TreeItem {
    const item = new TreeItem(
      submission.name,
      TreeItemCollapsibleState.Collapsed,
    );
    item.id = `run:${submission.id}`;
    const when = formatTime(submission.submittedTimeStamp);
    item.description = [humanizeState(submission.state), when]
      .filter(Boolean)
      .join(" · ");
    const outcome = outcomeOf(submission.state);
    item.iconPath = new ThemeIcon(
      stateIcon(submission.state),
      outcome === "error"
        ? new ThemeColor("errorForeground")
        : outcome === "warning"
          ? new ThemeColor("editorWarning.foreground")
          : outcome === "success"
            ? new ThemeColor("testing.iconPassed")
            : undefined,
    );
    item.tooltip = new MarkdownString(
      [
        `**${submission.job.path}** (${submission.job.resourceLocation.toLowerCase()})`,
        humanizeState(submission.state),
        submission.info ?? "",
        `${submission.submittedByDisplayName ?? submission.submittedBy ?? ""} · ${when}`,
        submission.runAsUser && submission.runAsUser !== submission.submittedBy
          ? `Run as ${submission.runAsUserDisplayName ?? submission.runAsUser}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    item.contextValue = `;run;${outcome};${isTerminal(submission.state) ? "done" : "active"};${submission.job.resourceLocation.toLowerCase()};`;
    return item;
  }

  private fileItem(file: ManifestFile, detail?: string): TreeItem {
    const item = new TreeItem(file.resource.name);
    const uri = uriForResource(file.resource);
    item.resourceUri = uri;
    item.description = [
      file.resource.location,
      file.resource.fileVersion && file.resource.fileVersion !== "-"
        ? `v${file.resource.fileVersion}`
        : "",
      detail ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    item.tooltip = [
      file.resource.path,
      file.resource.fileVersion && file.resource.fileVersion !== "-"
        ? `Version ${file.resource.fileVersion}`
        : "",
      file.digest ? `MD5 ${file.digest}` : "",
      file.size !== undefined ? `${file.size} bytes` : "",
      file.lastModifiedTimeStamp
        ? `Modified ${formatTime(file.lastModifiedTimeStamp)}`
        : "",
      file.referencingProgram ? `Used by ${file.referencingProgram}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (uri) {
      item.command = {
        command: "vscode.open",
        title: file.resource.name,
        arguments: [uri],
      };
    }
    item.contextValue = ";jobFile;";
    return item;
  }

  /** Poll the runs that have not ended, while the view is visible. */
  private updateTimer(): void {
    const active = this.runs.some(
      (n) => n.kind === "run" && !isTerminal(n.submission.state),
    );
    const want = active && this.treeView.visible;
    if (want && !this.timer) {
      this.timer = setInterval(() => this.pollActive(), REFRESH_INTERVAL_MS);
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async pollActive(): Promise<void> {
    for (const node of this.runs) {
      if (node.kind !== "run" || isTerminal(node.submission.state)) {
        continue;
      }
      try {
        const state = await this.model.getState(node.submission.id);
        if (state !== node.submission.state) {
          const submission = isTerminal(state)
            ? await this.model.getSubmission(node.submission.id)
            : { ...node.submission, state };
          this.upsert(submission);
        }
      } catch (error) {
        this.log(`Could not check run ${node.submission.id}: ${error}`);
      }
    }
    this.updateTimer();
  }
}

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}
