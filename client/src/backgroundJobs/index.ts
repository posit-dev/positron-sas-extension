// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
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
  Selection,
  TextDocument,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import { SASCodeDocument } from "../components/utils/SASCodeDocument";
import { getCodeDocumentConstructionParameters } from "../components/utils/SASCodeDocumentHelper";
import { ViyaConnection } from "../viya/connection";
import { getActiveViyaEndpoint } from "../viya/endpoint";
import { ServiceAvailability, probeService } from "../viya/probe";
import { DefinitionStore } from "./DefinitionStore";
import { JobNode, JobsDataProvider } from "./JobsDataProvider";
import { AlreadyFinishedError, JobNotFoundError, JobsModel } from "./JobsModel";
import { ComputeContextResolver } from "./computeContext";
import {
  API_MEDIA_TYPE,
  DEFINITIONS_AVAILABLE_CONTEXT_KEY,
  JOBS_AVAILABLE_CONTEXT_KEY,
  JOBS_VIEW_ID,
  JOB_DEFINITIONS_ROOT,
  JOB_EXECUTION_ROOT,
  REFRESH_INTERVAL_MS,
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
import { isDuration, jobNameFor, languageTag } from "./utils";

const LOG_START_INDICATOR = /^\/\*\* LOG_START_INDICATOR \*\*\/\r?\n/;
const DEFAULT_KEEP_RESULTS_FOR = "P7D";
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
    this.model = new JobsModel(
      {
        getConnection: () => this.viya.getConnection(),
        getCurrentUserId: () => this.viya.getCurrentUserId(),
      },
      languageTag(env.language),
    );
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

    const reset = (available: boolean) => {
      this.viya.reset();
      this.definitions.reset();
      this.contexts.reset();
      if (available) {
        this.provider.refresh();
      }
    };
    this.jobsAvailability = new ServiceAvailability(reset, log, {
      label: "SAS Job Execution",
      contextKey: JOBS_AVAILABLE_CONTEXT_KEY,
      probe: (endpoint, token) =>
        probeService(`${endpoint}${JOB_EXECUTION_ROOT}`, API_MEDIA_TYPE, token),
    });
    this.definitionsAvailability = new ServiceAvailability(() => {}, log, {
      label: "SAS Job Definitions",
      contextKey: DEFINITIONS_AVAILABLE_CONTEXT_KEY,
      probe: (endpoint, token) =>
        probeService(
          `${endpoint}${JOB_DEFINITIONS_ROOT}`,
          API_MEDIA_TYPE,
          token,
        ),
    });

    const onNode =
      (action: (job: ExecutionJob) => unknown) => (node?: JobNode) =>
        node?.kind === "job" ? action(node.job) : undefined;

    this.disposables.push(
      output,
      this.documents,
      this.provider,
      this.jobsAvailability,
      this.definitionsAvailability,
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

    const editor = window.visibleTextEditors.find(
      (e) => e.document === document,
    );
    const selections = (editor?.selections ?? []).filter((s) => !s.isEmpty);
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
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SubmitError, {
          name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  private async runAgain(job: ExecutionJob): Promise<void> {
    const endpoint = getActiveViyaEndpoint();
    const contextName = endpoint
      ? await this.contexts.resolve(endpoint)
      : undefined;
    if (!contextName) {
      return;
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
        expiresAfter: keepResultsFor(),
      });
      this.provider.upsert(again);
      this.watch(again);
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

async function documentFor(uri?: Uri): Promise<TextDocument | undefined> {
  if (uri instanceof Uri) {
    return (
      workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      ) ?? workspace.openTextDocument(uri)
    );
  }
  return window.activeTextEditor?.document;
}

/**
 * The code to submit: the program or the selection, with the same language
 * wrapping and _SASPROGRAMFILE as an interactive run, but without the ODS HTML
 * wrapper. Its `ods _all_ close;` leaves a job with no results at all, and the
 * Compute provider does not upload ODS HTML from a job anyway.
 */
function codeFor(
  document: TextDocument,
  selections: readonly Selection[],
): string {
  const parameters = getCodeDocumentConstructionParameters(document, {
    selections,
  });
  const wrapped = new SASCodeDocument({
    ...parameters,
    outputHtml: false,
    uuid: undefined,
  }).getWrappedCode();
  return wrapped.replace(LOG_START_INDICATOR, "");
}

function keepResultsFor(): string {
  const value = workspace
    .getConfiguration("SAS.backgroundJobs")
    .get<string>("keepResultsFor", DEFAULT_KEEP_RESULTS_FOR)
    .trim();
  return isDuration(value) ? value : DEFAULT_KEEP_RESULTS_FOR;
}
