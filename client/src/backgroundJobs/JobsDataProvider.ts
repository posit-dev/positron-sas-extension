// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The Background Jobs view: this client's jobs on the active SAS Viya server,
// newest first. Jobs that have not ended are re-checked while the view is
// visible. Nothing is kept locally: the list comes from the server, so jobs
// submitted before a restart, or from another window, show up too.
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

import { JobNotFoundError, JobsModel } from "./JobsModel";
import { JOBS_PAGE_LIMIT, JOBS_VIEW_ID, REFRESH_INTERVAL_MS } from "./const";
import {
  BackgroundJobMessages,
  backgroundJobErrorMessage,
  jobErrorText,
} from "./messages";
import { jobTitle } from "./results";
import {
  asJobState,
  formatElapsed,
  humanizeState,
  isTerminal,
  outcomeOf,
  stateIcon,
} from "./state";
import type { ExecutionJob, JobFile } from "./types";
import { jobDetails, jobFiles, resultFileOf } from "./utils";

export type JobNode =
  | { kind: "job"; job: ExecutionJob }
  | { kind: "file"; job: ExecutionJob; file: JobFile; label: string }
  | { kind: "message"; text: string; icon?: string }
  | { kind: "more" };

const OUTCOME_COLOR: Record<string, string | undefined> = {
  success: "testing.iconPassed",
  error: "testing.iconFailed",
  warning: "list.warningForeground",
};

export class JobsDataProvider implements TreeDataProvider<JobNode>, Disposable {
  private readonly changed = new EventEmitter<JobNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly treeView: TreeView<JobNode>;
  private jobs: ExecutionJob[] = [];
  private hasMore = false;
  private loaded = false;
  private loadError: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly model: JobsModel,
    private readonly log: (message: string) => void,
    /** Called when a job this view was watching reaches an end state. */
    private readonly onFinished: (job: ExecutionJob) => void = () => {},
  ) {
    this.treeView = window.createTreeView(JOBS_VIEW_ID, {
      treeDataProvider: this,
      showCollapseAll: true,
      canSelectMany: true,
    });
    this.disposables.push(
      this.treeView,
      this.changed,
      this.treeView.onDidChangeVisibility(() => this.updateTimer()),
    );
  }

  /** Reload the list from the server. */
  refresh(): void {
    this.loaded = false;
    this.jobs = [];
    this.hasMore = false;
    this.changed.fire(undefined);
  }

  /** Put a job that just started at the top, or update it in place. */
  upsert(job: ExecutionJob): void {
    const index = this.jobs.findIndex((j) => j.id === job.id);
    if (index >= 0) {
      this.jobs[index] = job;
    } else if (this.loaded) {
      this.jobs.unshift(job);
    }
    this.changed.fire(undefined);
    this.updateTimer();
  }

  remove(ids: string[]): void {
    const gone = new Set(ids);
    this.jobs = this.jobs.filter((j) => !gone.has(j.id));
    this.changed.fire(undefined);
    this.updateTimer();
  }

  find(id: string): ExecutionJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  async reveal(id: string): Promise<void> {
    const job = this.find(id);
    if (job) {
      await this.treeView.reveal(
        { kind: "job", job },
        { select: true, focus: true },
      );
    }
  }

  getParent(): undefined {
    return undefined;
  }

  async getChildren(node?: JobNode): Promise<JobNode[]> {
    if (!node) {
      return this.getJobs();
    }
    if (node.kind === "job") {
      return fileNodes(node.job);
    }
    return [];
  }

  getTreeItem(node: JobNode): TreeItem {
    switch (node.kind) {
      case "job":
        return this.jobItem(node.job);
      case "file": {
        const item = new TreeItem(node.label);
        item.iconPath = new ThemeIcon(
          node.file.kind === "log" || node.file.kind === "logJson"
            ? "output"
            : "file-text",
        );
        item.contextValue = ";bgjobfile;";
        item.command = {
          command: "SAS.backgroundJob.openFile",
          title: node.label,
          arguments: [node],
        };
        return item;
      }
      case "more": {
        const item = new TreeItem(BackgroundJobMessages.LoadMore);
        item.command = {
          command: "SAS.backgroundJobs.loadMore",
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

  async loadMore(): Promise<void> {
    try {
      const page = await this.model.listJobs(this.jobs.length, JOBS_PAGE_LIMIT);
      const known = new Set(this.jobs.map((j) => j.id));
      this.jobs = [...this.jobs, ...page.items.filter((j) => !known.has(j.id))];
      this.hasMore = page.hasMore;
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.ListError, {
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
    this.changed.fire(undefined);
    this.updateTimer();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
  }

  private async getJobs(): Promise<JobNode[]> {
    if (!this.loaded) {
      try {
        const page = await this.model.listJobs(0, JOBS_PAGE_LIMIT);
        this.jobs = page.items;
        this.hasMore = page.hasMore;
        this.loadError = undefined;
      } catch (error) {
        this.jobs = [];
        this.hasMore = false;
        this.loadError = backgroundJobErrorMessage(error);
        this.log(`Could not list background jobs: ${this.loadError}`);
      }
      this.loaded = true;
      this.updateTimer();
    }
    if (this.loadError) {
      return [
        {
          kind: "message",
          text: l10n.t(BackgroundJobMessages.ListError, {
            message: this.loadError,
          }),
          icon: "error",
        },
      ];
    }
    if (!this.jobs.length) {
      return [{ kind: "message", text: BackgroundJobMessages.NoJobs }];
    }
    const nodes: JobNode[] = this.jobs.map((job) => ({ kind: "job", job }));
    return this.hasMore ? [...nodes, { kind: "more" }] : nodes;
  }

  private jobItem(job: ExecutionJob): TreeItem {
    const done = isTerminal(job.state);
    const files = done ? fileNodes(job) : [];
    const item = new TreeItem(
      jobTitle(job),
      files.length
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
    );
    // A stable id keeps expansion and selection across refreshes.
    item.id = job.id;
    const warned = !!job.error;
    const outcome = outcomeOf(job.state, warned);
    const color = OUTCOME_COLOR[outcome];
    item.iconPath = new ThemeIcon(
      stateIcon(job.state, warned),
      color ? new ThemeColor(color) : undefined,
    );
    const elapsed = done ? formatElapsed(job.elapsedTime) : "";
    item.description = [humanizeState(job.state, warned), elapsed, when(job)]
      .filter(Boolean)
      .join(" · ");
    item.tooltip = tooltip(job);
    // Matched by regex in package.json, e.g. viewItem =~ /;active;/.
    const tokens = [
      "bgjob",
      outcome,
      done ? "done" : "active",
      files.some((f) => f.kind === "file" && isLog(f.file)) ? "hasLog" : "",
      resultFileOf(job) ? "hasResults" : "",
      job.jobRequest?.jobDefinition?.code ? "hasCode" : "",
    ].filter(Boolean);
    item.contextValue = `;${tokens.join(";")};`;
    return item;
  }

  /** Poll the jobs that have not ended, while the view is visible. */
  private updateTimer(): void {
    const active = this.jobs.some((j) => !isTerminal(j.state));
    const want = active && this.treeView.visible;
    if (want && !this.timer) {
      this.timer = setInterval(
        () => void this.pollActive(),
        REFRESH_INTERVAL_MS,
      );
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async pollActive(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      for (const job of [...this.jobs]) {
        if (isTerminal(job.state)) {
          continue;
        }
        try {
          const state = await this.model.getState(job.id);
          if (state !== job.state) {
            const updated = isTerminal(state)
              ? await this.model.getJob(job.id)
              : { ...job, state: asJobState(state) };
            this.upsert(updated);
            if (isTerminal(updated.state)) {
              this.onFinished(updated);
            }
          }
        } catch (error) {
          if (error instanceof JobNotFoundError) {
            this.log(`Background job ${job.id} is no longer on the server.`);
            this.remove([job.id]);
          } else {
            this.log(`Could not check background job ${job.id}: ${error}`);
          }
        }
      }
    } finally {
      this.polling = false;
      this.updateTimer();
    }
  }
}

const isLog = (file: JobFile) => file.kind === "log" || file.kind === "logJson";

/**
 * The files to show under a finished job: one Log and one Listing, not the
 * JSON and text copies of each, plus anything else the job produced.
 */
export function fileNodes(job: ExecutionJob): JobNode[] {
  const files = jobFiles(job);
  const nodes: JobNode[] = [];
  const log =
    files.find((f) => f.kind === "logJson") ??
    files.find((f) => f.kind === "log");
  if (log) {
    nodes.push({ kind: "file", job, file: log, label: l10n.t("Log") });
  }
  const listing =
    files.find((f) => f.kind === "listing") ??
    files.find((f) => f.kind === "listingJson");
  if (listing) {
    nodes.push({ kind: "file", job, file: listing, label: l10n.t("Listing") });
  }
  for (const file of files.filter((f) => f.kind === "other")) {
    nodes.push({ kind: "file", job, file, label: file.key });
  }
  return nodes;
}

function when(job: ExecutionJob): string {
  const stamp = job.creationTimeStamp;
  if (!stamp) {
    return "";
  }
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function tooltip(job: ExecutionJob): MarkdownString {
  const rows: [string, string][] = [
    [BackgroundJobMessages.State, humanizeState(job.state, !!job.error)],
    [BackgroundJobMessages.SubmittedAt, when(job)],
  ];
  if (isTerminal(job.state)) {
    rows.push([
      BackgroundJobMessages.Ended,
      job.endTimeStamp ? new Date(job.endTimeStamp).toLocaleString() : "",
    ]);
    rows.push([BackgroundJobMessages.Elapsed, formatElapsed(job.elapsedTime)]);
  }
  const context = jobDetails(job).find(([k]) => k === "COMPUTE_CONTEXT")?.[1];
  rows.push([
    BackgroundJobMessages.Context,
    context ?? job.jobRequest?.arguments?._contextName ?? "",
  ]);
  rows.push([BackgroundJobMessages.JobId, job.id]);
  const error = jobErrorText(job.error);
  if (error) {
    rows.push([BackgroundJobMessages.Error, error]);
  }
  const markdown = new MarkdownString();
  markdown.appendMarkdown(`**${escapeMarkdown(jobTitle(job))}**\n\n`);
  for (const [label, value] of rows) {
    if (value) {
      markdown.appendMarkdown(`${label}: ${escapeMarkdown(value)}  \n`);
    }
  }
  return markdown;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
