// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Submit SAS programs as SAS Viya background jobs (#150), the way SAS Studio's
// Background Submit does: the job runs in its own compute server through the
// Job Execution service, keeps running when Positron closes, and leaves its
// log and listing on the server.
import {
  Disposable,
  ExtensionContext,
  LogOutputChannel,
  ProgressLocation,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import { ViyaConnection } from "../viya/connection";
import { getActiveViyaEndpoint } from "../viya/endpoint";
import { ServiceAvailability, probeService } from "../viya/probe";
import { DefinitionStore } from "./DefinitionStore";
import { JobNode, JobsDataProvider } from "./JobsDataProvider";
import { AlreadyFinishedError, JobNotFoundError, JobsModel } from "./JobsModel";
import { SasJobs } from "./SasJobs";
import { ScheduleCommands } from "./ScheduleCommands";
import { SchedulesModel } from "./SchedulesModel";
import { codeFor, documentFor, keepResultsFor, selectionsOf } from "./code";
import { ComputeContextResolver } from "./computeContext";
import {
  API_MEDIA_TYPE,
  DEFINITIONS_AVAILABLE_CONTEXT_KEY,
  JOBS_AVAILABLE_CONTEXT_KEY,
  JOBS_VIEW_ID,
  JOB_DEFINITIONS_ROOT,
  JOB_EXECUTION_ROOT,
  REFRESH_INTERVAL_MS,
  SCHEDULER_ROOT,
  SCHEDULING_AVAILABLE_CONTEXT_KEY,
} from "./const";
import { JobLogDocuments } from "./jobLog";
import {
  BackgroundJobMessages,
  backgroundJobErrorMessage,
  jobErrorText,
} from "./messages";
import { JobResults, jobTitle } from "./results";
import { isTerminal, outcomeOf } from "./state";
import type { ExecutionJob, JobDefinition } from "./types";
import { jobNameFor, languageTag } from "./utils";

/** How often jobs submitted in this window are checked while the view is hidden. */
const WATCH_INTERVAL_MS = 10_000;

export class BackgroundJobs implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly viya: ViyaConnection;
  private readonly model: JobsModel;
  private readonly definitions: DefinitionStore;
  private readonly contexts: ComputeContextResolver;
  private readonly documents: JobLogDocuments;
  private readonly results: JobResults;
  private readonly provider: JobsDataProvider;
  private readonly sasJobs: SasJobs;
  private readonly scheduleCommands: ScheduleCommands;
  private readonly schedulingAvailability: ServiceAvailability;
  private readonly jobsAvailability: ServiceAvailability;
  private readonly definitionsAvailability: ServiceAvailability;
  /** Jobs submitted in this window, to notify about when they end. */
  private readonly watched = new Map<string, string>();
  private watchTimer: ReturnType<typeof setInterval> | undefined;

  static register(context: ExtensionContext): BackgroundJobs {
    const jobs = new BackgroundJobs(context);
    context.subscriptions.push(jobs);
    return jobs;
  }

  private constructor(context: ExtensionContext) {
    const output: LogOutputChannel = window.createOutputChannel(
      "SAS Background Jobs",
      { log: true },
    );
    const log = (message: string) => output.info(message);
    this.viya = new ViyaConnection(log);
    const backend = {
      getConnection: () => this.viya.getConnection(),
      getCurrentUserId: () => this.viya.getCurrentUserId(),
    };
    const language = languageTag(env.language);
    this.model = new JobsModel(backend, language);
    const schedulesModel = new SchedulesModel(backend, language);
    this.definitions = new DefinitionStore(
      this.model,
      context.globalState,
      log,
    );
    this.contexts = new ComputeContextResolver(this.model, log);
    this.documents = new JobLogDocuments();
    this.results = new JobResults(this.model, this.documents, log);
    this.provider = new JobsDataProvider(this.model, log, (job) =>
      this.finished(job),
    );
    this.sasJobs = new SasJobs({
      model: this.model,
      contexts: this.contexts,
      documents: this.documents,
      log,
      definitionsAvailable: () => this.definitionsAvailability.isAvailable,
      track: (job) => this.track(job),
    });
    this.scheduleCommands = new ScheduleCommands({
      jobs: this.model,
      schedules: schedulesModel,
      contexts: this.contexts,
      language,
      log,
      track: (job) => this.track(job),
    });

    const reset = (available: boolean) => {
      this.viya.reset();
      this.definitions.reset();
      this.contexts.reset();
      if (available) {
        this.provider.refresh();
        this.sasJobs.refresh();
        this.scheduleCommands.refresh();
      }
    };
    this.jobsAvailability = new ServiceAvailability(reset, log, {
      label: "SAS Job Execution",
      contextKey: JOBS_AVAILABLE_CONTEXT_KEY,
      probe: (endpoint, token) =>
        probeService(`${endpoint}${JOB_EXECUTION_ROOT}`, API_MEDIA_TYPE, token),
    });
    this.definitionsAvailability = new ServiceAvailability(
      (available) => available && this.sasJobs.refresh(),
      log,
      {
        label: "SAS Job Definitions",
        contextKey: DEFINITIONS_AVAILABLE_CONTEXT_KEY,
        probe: (endpoint, token) =>
          probeService(
            `${endpoint}${JOB_DEFINITIONS_ROOT}`,
            API_MEDIA_TYPE,
            token,
          ),
      },
    );
    this.schedulingAvailability = new ServiceAvailability(
      (available) => available && this.scheduleCommands.refresh(),
      log,
      {
        label: "SAS Scheduler",
        contextKey: SCHEDULING_AVAILABLE_CONTEXT_KEY,
        probe: (endpoint, token) =>
          probeService(`${endpoint}${SCHEDULER_ROOT}`, API_MEDIA_TYPE, token),
      },
    );

    const onNode =
      (action: (job: ExecutionJob) => unknown) => (node?: JobNode) =>
        node?.kind === "job" ? action(node.job) : undefined;

    this.disposables.push(
      output,
      this.documents,
      this.provider,
      this.sasJobs,
      this.scheduleCommands,
      this.jobsAvailability,
      this.definitionsAvailability,
      this.schedulingAvailability,
      commands.registerCommand("SAS.backgroundJob.submit", (uri?: Uri) =>
        this.submit(uri),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.cancel",
        (node?: JobNode, nodes?: JobNode[]) =>
          this.cancel(selected(node, nodes)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.delete",
        (node?: JobNode, nodes?: JobNode[]) =>
          this.delete(selected(node, nodes)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.openLog",
        onNode((job) => this.results.openLog(job)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.openResults",
        onNode((job) => this.results.openResults(job)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.openAllResults",
        onNode((job) => this.results.pickFile(job)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.openFile",
        (node?: JobNode) =>
          node?.kind === "file"
            ? this.results.openFile(node.job, node.file)
            : undefined,
      ),
      commands.registerCommand(
        "SAS.backgroundJob.showCode",
        onNode((job) => this.showCode(job)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.runAgain",
        onNode((job) => this.runAgain(job)),
      ),
      commands.registerCommand(
        "SAS.backgroundJob.copyId",
        onNode((job) => env.clipboard.writeText(job.id)),
      ),
      commands.registerCommand("SAS.backgroundJobs.refresh", () =>
        this.provider.refresh(),
      ),
      commands.registerCommand("SAS.backgroundJobs.loadMore", () =>
        this.provider.loadMore(),
      ),
      commands.registerCommand("SAS.backgroundJobs.chooseComputeContext", () =>
        this.contexts.choose(),
      ),
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("SAS.backgroundJobs")) {
          this.contexts.reset();
        }
      }),
    );
  }

  // ---------------------------------------------------------------- submit

  private async submit(uri?: Uri): Promise<void> {
    const document = await documentFor(uri);
    if (!document) {
      return;
    }
    const endpoint = getActiveViyaEndpoint();
    if (!endpoint) {
      window.showWarningMessage(BackgroundJobMessages.NotViya);
      return;
    }
    if (!this.jobsAvailability.isAvailable) {
      window.showWarningMessage(BackgroundJobMessages.NotAvailable);
      return;
    }

    const selections = selectionsOf(document);
    const code = codeFor(document, selections);
    if (!code.trim()) {
      window.showInformationMessage(BackgroundJobMessages.NothingToSubmit);
      return;
    }
    const name = jobNameFor({
      fileName: document.fileName,
      untitled: document.isUntitled,
      selection: selections.length > 0,
    });
    const contextName = await this.contexts.resolve(endpoint);
    if (!contextName) {
      return;
    }
    const description = l10n.t("Submitted from Positron: {path}", {
      path: document.isUntitled ? name : document.uri.fsPath,
    });

    try {
      const job = await window.withProgress(
        {
          location: ProgressLocation.Window,
          title: l10n.t(BackgroundJobMessages.Submitting, { name }),
        },
        async () => {
          const inline: JobDefinition = { name, type: "Compute", code };
          let definitionUri: string | undefined;
          // A whole program becomes a SAS job in SAS Content, reused and
          // updated on each submit. A selection runs once, without one.
          if (
            selections.length === 0 &&
            !document.isUntitled &&
            this.definitionsAvailability.isAvailable
          ) {
            try {
              const ensured = await this.definitions.ensure({
                endpoint,
                documentUri: document.uri.toString(),
                name,
                code,
                description,
              });
              definitionUri = ensured.uri;
            } catch (error) {
              const message = backgroundJobErrorMessage(error);
              window.showWarningMessage(
                l10n.t(BackgroundJobMessages.NotSaved, { name, message }),
              );
            }
          }
          return this.model.submit({
            name,
            description,
            definitionUri,
            definition: definitionUri ? undefined : inline,
            contextName,
            expiresAfter: keepResultsFor(),
          });
        },
      );
      await this.track(job);
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SubmitError, {
          name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  /**
   * Show a run that just started in the Background Jobs view, follow it so
   * its end is announced, and say that it started.
   */
  async track(job: ExecutionJob): Promise<void> {
    const name = jobTitle(job);
    this.provider.upsert(job);
    this.watch(job);
    const choice = await window.showInformationMessage(
      l10n.t(BackgroundJobMessages.Submitted, { name }),
      BackgroundJobMessages.ShowJobs,
    );
    if (choice) {
      await commands.executeCommand(`${JOBS_VIEW_ID}.focus`);
      await this.provider.reveal(job.id);
    }
  }

  /**
   * Submit the same job again, with the same arguments: the parameter values
   * and the compute context of that run, which the server records on it.
   */
  private async runAgain(job: ExecutionJob): Promise<void> {
    const previous = { ...(job.jobRequest?.arguments ?? {}) };
    let contextName: string | undefined = previous._contextName;
    delete previous._contextName;
    if (!contextName) {
      const endpoint = getActiveViyaEndpoint();
      contextName = endpoint
        ? await this.contexts.resolve(endpoint)
        : undefined;
      if (!contextName) {
        return;
      }
    }
    const name = jobTitle(job);
    try {
      const definitionUri = job.jobRequest?.jobDefinitionUri;
      const again = await this.model.submit({
        name,
        description: job.jobRequest?.description,
        definitionUri,
        definition: definitionUri ? undefined : job.jobRequest?.jobDefinition,
        contextName,
        extraArguments: previous,
        expiresAfter: keepResultsFor(),
      });
      await this.track(again);
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SubmitError, {
          name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  private async showCode(job: ExecutionJob): Promise<void> {
    const code = job.jobRequest?.jobDefinition?.code;
    if (code) {
      const document = await workspace.openTextDocument({
        language: "sas",
        content: code,
      });
      await window.showTextDocument(document, { preview: true });
    }
  }

  // ---------------------------------------------------------------- cancel, delete

  private async cancel(jobs: ExecutionJob[]): Promise<void> {
    for (const job of jobs.filter((j) => !isTerminal(j.state))) {
      const name = jobTitle(job);
      try {
        await window.withProgress(
          {
            location: ProgressLocation.Window,
            title: l10n.t(BackgroundJobMessages.Canceling, { name }),
          },
          () => this.model.cancel(job.id),
        );
      } catch (error) {
        if (error instanceof AlreadyFinishedError) {
          window.showInformationMessage(
            l10n.t(BackgroundJobMessages.AlreadyFinished, { name }),
          );
        } else if (!(error instanceof JobNotFoundError)) {
          window.showErrorMessage(
            l10n.t(BackgroundJobMessages.CancelError, {
              name,
              message: backgroundJobErrorMessage(error),
            }),
          );
          continue;
        }
      }
      await this.reload(job);
    }
  }

  private async delete(jobs: ExecutionJob[]): Promise<void> {
    if (!jobs.length) {
      return;
    }
    const prompt =
      jobs.length === 1
        ? l10n.t(BackgroundJobMessages.DeleteConfirm, {
            name: jobTitle(jobs[0]),
          })
        : l10n.t(BackgroundJobMessages.DeleteManyConfirm, {
            count: jobs.length,
          });
    const ok = await window.showWarningMessage(
      prompt,
      { modal: true },
      BackgroundJobMessages.Delete,
    );
    if (ok !== BackgroundJobMessages.Delete) {
      return;
    }
    const deleted: string[] = [];
    for (const job of jobs) {
      try {
        await this.model.deleteJob(job.id);
        deleted.push(job.id);
        this.watched.delete(job.id);
      } catch (error) {
        window.showErrorMessage(
          l10n.t(BackgroundJobMessages.DeleteError, {
            name: jobTitle(job),
            message: backgroundJobErrorMessage(error),
          }),
        );
      }
    }
    this.provider.remove(deleted);
  }

  private async reload(job: ExecutionJob): Promise<void> {
    try {
      const fresh = await this.model.getJob(job.id);
      this.provider.upsert(fresh);
      if (isTerminal(fresh.state)) {
        this.finished(fresh);
      }
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        this.provider.remove([job.id]);
      }
    }
  }

  // ---------------------------------------------------------------- watching

  /**
   * Follow a job submitted in this window, even while the view is hidden, so
   * its end can be announced.
   */
  private watch(job: ExecutionJob): void {
    if (isTerminal(job.state)) {
      return;
    }
    this.watched.set(job.id, jobTitle(job));
    if (!this.watchTimer) {
      this.watchTimer = setInterval(
        () => void this.pollWatched(),
        Math.max(WATCH_INTERVAL_MS, REFRESH_INTERVAL_MS),
      );
    }
  }

  private async pollWatched(): Promise<void> {
    for (const id of [...this.watched.keys()]) {
      try {
        const state = await this.model.getState(id);
        if (isTerminal(state)) {
          const job = await this.model.getJob(id);
          this.provider.upsert(job);
          this.finished(job);
        }
      } catch (error) {
        if (error instanceof JobNotFoundError) {
          this.watched.delete(id);
        }
      }
    }
    if (!this.watched.size && this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = undefined;
    }
  }

  /** Announce the end of a job submitted in this window, once. */
  private finished(job: ExecutionJob): void {
    if (!this.watched.has(job.id)) {
      return;
    }
    this.watched.delete(job.id);
    const name = jobTitle(job);
    const actions = [
      BackgroundJobMessages.OpenLog,
      BackgroundJobMessages.OpenResults,
    ];
    let shown: Thenable<string | undefined>;
    switch (outcomeOf(job.state, !!job.error)) {
      case "success":
        shown = window.showInformationMessage(
          l10n.t(BackgroundJobMessages.Completed, { name }),
          ...actions,
        );
        break;
      case "warning":
        if (job.state === "completed") {
          // Completed, but SAS reported warnings, e.g. an unresolved macro
          // reference; the server records them as the job's error.
          shown = window.showWarningMessage(
            l10n.t(BackgroundJobMessages.CompletedWithWarnings, {
              name,
              message: jobErrorText(job.error),
            }),
            ...actions,
          );
          break;
        }
        shown = window.showWarningMessage(
          l10n.t(
            job.state === "timedOut"
              ? BackgroundJobMessages.TimedOut
              : BackgroundJobMessages.Canceled,
            { name },
          ),
          BackgroundJobMessages.OpenLog,
        );
        break;
      case "error":
        shown = window.showErrorMessage(
          l10n.t(BackgroundJobMessages.Failed, {
            name,
            message: jobErrorText(job.error),
          }),
          ...actions,
        );
        break;
      default:
        // A job that has not ended has nothing to announce.
        return;
    }
    void shown.then((choice) => {
      if (choice === BackgroundJobMessages.OpenLog) {
        void this.results.openLog(job);
      } else if (choice === BackgroundJobMessages.OpenResults) {
        void this.results.openResults(job);
      }
    });
  }

  dispose(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}

// ---------------------------------------------------------------- helpers

/** The commands' targets: the selection when the node is part of it. */
function selected(node?: JobNode, nodes?: JobNode[]): ExecutionJob[] {
  const all = nodes?.length ? nodes : node ? [node] : [];
  return all.flatMap((n) => (n.kind === "job" ? [n.job] : []));
}
