// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF Jobs view: the runs started from this extension (the API can't
// list submissions), polled until they finish, with their manifest, log and
// listing underneath.
import {
  Disposable,
  EventEmitter,
  LogOutputChannel,
  Memento,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  l10n,
  window,
} from "vscode";

import { JobsModel, RunOutcome, runOutcome } from "./JobsModel";
import { describeError, isNotFound } from "./LsafClient";
import { LsafSession } from "./auth";
import { JOBS_VIEW_ID } from "./const";
import { fileIcon } from "./items";
import { JobOutputs, OutputFile } from "./jobOutputs";
import { Messages } from "./messages";
import { baseName } from "./paths";
import { RunStore, TrackedRun, runStoreKey } from "./runStore";
import { areaUri, iconPath } from "./uris";

export type JobNode =
  | { kind: "run"; run: TrackedRun }
  | { kind: "file"; run: TrackedRun; file: OutputFile };

const FIRST_POLL_MS = 3000;
const MAX_POLL_MS = 15_000;

const OUTCOME_ICONS: Record<RunOutcome, [string, string | undefined]> = {
  running: ["sync~spin", undefined],
  succeeded: ["pass", "testing.iconPassed"],
  warnings: ["warning", "list.warningForeground"],
  failed: ["error", "testing.iconFailed"],
  canceled: ["circle-slash", undefined],
  finished: ["circle-outline", undefined],
};

export function outcomeLabel(outcome: RunOutcome): string {
  return {
    running: Messages.Running,
    succeeded: Messages.Succeeded,
    warnings: Messages.CompletedWithWarnings,
    failed: Messages.Failed,
    canceled: Messages.Canceled,
    finished: Messages.Finished,
  }[outcome];
}

const formatTime = (value: string | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

export class JobsDataProvider implements TreeDataProvider<JobNode>, Disposable {
  private readonly _onDidChangeTreeData = new EventEmitter<
    JobNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly treeView: TreeView<JobNode>;
  private readonly outputsCache = new Map<string, Promise<OutputFile[]>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delay = FIRST_POLL_MS;
  private polling = false;

  constructor(
    private readonly session: LsafSession,
    private readonly jobs: JobsModel,
    private readonly outputs: JobOutputs,
    private readonly memento: Memento,
    private readonly output: LogOutputChannel,
    private readonly extensionUri: Uri,
    private readonly onFinished: (run: TrackedRun) => void,
  ) {
    this.treeView = window.createTreeView(JOBS_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
  }

  /** The runs of the signed-in user on the current server. */
  store(): RunStore | undefined {
    const { apiUrl, userId } = this.session;
    return apiUrl && userId
      ? new RunStore(this.memento, runStoreKey(apiUrl, userId))
      : undefined;
  }

  refresh(): void {
    this.outputsCache.clear();
    this._onDidChangeTreeData.fire(undefined);
    this.schedulePoll(true);
  }

  async track(run: TrackedRun): Promise<void> {
    await this.store()?.add(run);
    this._onDidChangeTreeData.fire(undefined);
    this.schedulePoll(true);
  }

  /** The outputs of a finished run, looked up once per refresh. */
  outputsOf(run: TrackedRun): Promise<OutputFile[]> {
    let found = this.outputsCache.get(run.id);
    if (!found) {
      found = this.outputs.find(run);
      found.catch(() => this.outputsCache.delete(run.id));
      this.outputsCache.set(run.id, found);
    }
    return found;
  }

  /** The runs a command acts on: the clicked one plus the selection. */
  selectedRuns(node: JobNode | undefined): TrackedRun[] {
    const nodes = node
      ? this.treeView.selection.some((s) => s.run.id === node.run.id)
        ? this.treeView.selection
        : [node]
      : this.treeView.selection;
    return [...new Map(nodes.map((n) => [n.run.id, n.run])).values()];
  }

  async getChildren(node?: JobNode): Promise<JobNode[]> {
    if (!this.session.signedIn) {
      return [];
    }
    if (!node) {
      return (this.store()?.list() ?? []).map((run) => ({ kind: "run", run }));
    }
    if (node.kind !== "run" || node.run.outcome === "running") {
      return [];
    }
    try {
      const files = await this.outputsOf(node.run);
      return files.map((file) => ({ kind: "file", run: node.run, file }));
    } catch (error) {
      this.output.warn(
        `Outputs of the run ${node.run.id}: ${describeError(error)}`,
      );
      return [];
    }
  }

  getTreeItem(node: JobNode): TreeItem {
    if (node.kind === "file") {
      const uri = areaUri(node.file.area, node.file.path);
      return {
        id: `${node.run.id}:${node.file.area}:${node.file.path}`,
        label: baseName(node.file.path),
        description: {
          manifest: Messages.Manifest,
          log: Messages.Log,
          listing: Messages.Listing,
        }[node.file.kind],
        tooltip: `${node.file.path} (${node.file.area})`,
        resourceUri: uri,
        iconPath: iconPath(this.extensionUri, fileIcon(node.file.path)),
        contextValue: `;runFile;${node.file.kind};`,
        command: {
          command: "vscode.open",
          title: Messages.Open,
          arguments: [uri, { preview: false }],
        },
      };
    }
    const { run } = node;
    const [icon, color] = OUTCOME_ICONS[run.outcome];
    const tooltip = [
      `${run.jobPath} (${run.area})`,
      l10n.t(Messages.SubmittedAt, { time: formatTime(run.submittedAt) }),
      run.completedAt
        ? l10n.t(Messages.CompletedAt, { time: formatTime(run.completedAt) })
        : undefined,
      run.state
        ? l10n.t(Messages.ServerState, { state: run.state })
        : undefined,
      run.message,
      run.parameters && Object.keys(run.parameters).length
        ? Object.entries(run.parameters)
            .map(([name, value]) => `${name}=${value}`)
            .join(", ")
        : undefined,
      l10n.t(Messages.SubmissionId, { id: run.id }),
    ].filter(Boolean);
    return {
      id: run.id,
      label: baseName(run.jobPath),
      description: `${outcomeLabel(run.outcome)} · ${formatTime(run.submittedAt)}`,
      tooltip: tooltip.join("\n"),
      iconPath: new ThemeIcon(icon, color ? new ThemeColor(color) : undefined),
      contextValue: `;run;${run.outcome === "running" ? "running" : "finished"};`,
      collapsibleState:
        run.outcome === "running"
          ? TreeItemCollapsibleState.None
          : TreeItemCollapsibleState.Collapsed,
    };
  }

  // --- polling ---

  schedulePoll(reset = false): void {
    if (reset) {
      this.delay = FIRST_POLL_MS;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    const running = this.store()
      ?.list()
      .some((run) => run.outcome === "running");
    if (!running || !this.session.signedIn) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((error) =>
        this.output.warn(`Polling LSAF jobs: ${describeError(error)}`),
      );
    }, this.delay);
  }

  private async poll(): Promise<void> {
    const store = this.store();
    if (this.polling || !store) {
      return;
    }
    this.polling = true;
    try {
      for (const run of store.list().filter((r) => r.outcome === "running")) {
        let patch: Partial<TrackedRun>;
        try {
          const submission = await this.jobs.getSubmission(run.id);
          patch = {
            state: submission.state,
            message: submission.message,
            completedAt: submission.completedTimestamp,
            outcome: runOutcome(submission),
          };
          if (submission.state !== run.state) {
            this.output.info(
              `LSAF run ${run.id} (${run.jobPath}): ${submission.state} ${submission.message ?? ""}`,
            );
          }
        } catch (error) {
          if (!isNotFound(error)) {
            throw error;
          }
          patch = { outcome: "finished", message: Messages.SubmissionGone };
        }
        await store.update(run.id, patch);
        if (patch.outcome !== "running") {
          this.onFinished({ ...run, ...patch });
        }
      }
    } finally {
      this.polling = false;
      this._onDidChangeTreeData.fire(undefined);
      this.delay = Math.min(this.delay * 1.5, MAX_POLL_MS);
      this.schedulePoll();
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.treeView.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
