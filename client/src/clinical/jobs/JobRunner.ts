// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Runs clinical jobs: asks for parameter values, submits the job, follows the
// run in a progress notification (whose Cancel cancels the run), and reports
// the outcome with the run's log and results at hand.
import {
  LogOutputChannel,
  ProgressLocation,
  commands,
  l10n,
  window,
} from "vscode";

import type { ItemPicker } from "./ItemPicker";
import type { JobsModel } from "./JobsModel";
import { JobMessages, OutcomeMessages, jobErrorMessage } from "./messages";
import { promptParameterValues } from "./parameters";
import { uriForResource } from "./resources";
import { humanizeState, isTerminal, outcomeOf } from "./state";
import type {
  ClinicalJob,
  JobResource,
  Manifest,
  ParameterValue,
  RunKind,
  Submission,
} from "./types";
import { publishCounts, toRunInfo } from "./utils";

export class JobRunner {
  constructor(
    private readonly model: JobsModel,
    private readonly picker: ItemPicker,
    private readonly output: LogOutputChannel,
    /** Called when a run starts or ends, to refresh the views. */
    private readonly onChanged: (submission: Submission) => void,
    /** Called when the service may have rewritten a workspace job file. */
    private readonly onJobFileChanged: (resource: JobResource) => void = () =>
      undefined,
  ) {}

  /** The job definition, from the repository or the workspace file. */
  async loadJob(resource: JobResource): Promise<ClinicalJob> {
    if (resource.resourceLocation === "REPOSITORY") {
      if (!resource.id) {
        throw new Error(`${resource.path} has no repository id.`);
      }
      return this.model.getRepositoryJob(resource.id, resource.fileVersion);
    }
    return this.model.readWorkspaceJob(resource);
  }

  /** Ask for parameter values, run the job and follow the run. */
  async run(resource: JobResource): Promise<void> {
    let job: ClinicalJob;
    try {
      job = await this.loadJob(resource);
    } catch (error) {
      this.fail(JobMessages.LoadJobError, resource.name, error);
      return;
    }
    const values = await promptParameterValues(job, resource, this.picker);
    if (values === undefined) {
      return;
    }
    await this.submit(resource, values);
  }

  /**
   * Run and populate a workspace job: ask for relative or absolute paths and
   * the parameter values, run the job, and say what its Publish Setup lists
   * afterwards. The service changes the job only when the run succeeds.
   */
  async runAndPopulate(resource: JobResource): Promise<void> {
    let job: ClinicalJob;
    try {
      job = await this.loadJob(resource);
    } catch (error) {
      this.fail(JobMessages.LoadJobError, resource.name, error);
      return;
    }
    const counts = publishCounts(job);
    const setup = counts.files + counts.folders;
    const choice = await window.showQuickPick(
      [
        {
          label: JobMessages.PopulateRelative,
          detail: JobMessages.PopulateRelativeDetail,
          paths: "relative" as const,
        },
        {
          label: JobMessages.PopulateAbsolute,
          detail: JobMessages.PopulateAbsoluteDetail,
          paths: "absolute" as const,
        },
      ],
      {
        title: l10n.t(JobMessages.PopulateTitle, { name: resource.name }),
        placeHolder:
          setup || counts.locations
            ? l10n.t(JobMessages.PopulateReplaces, {
                setup,
                locations: counts.locations,
              })
            : JobMessages.PopulatePlaceholder,
        ignoreFocusOut: true,
      },
    );
    if (!choice) {
      return;
    }
    const values = await promptParameterValues(job, resource, this.picker);
    if (values === undefined) {
      return;
    }
    await this.submit(resource, values, choice.paths);
  }

  /**
   * Test a workspace job: it runs as if from the repository, reading its
   * programs and inputs there, and writes only its log, listing and manifest
   * to the workspace, without checking anything in. File and folder
   * parameters therefore name repository paths.
   */
  async testJob(resource: JobResource): Promise<void> {
    let job: ClinicalJob;
    try {
      job = await this.loadJob(resource);
    } catch (error) {
      this.fail(JobMessages.LoadJobError, resource.name, error);
      return;
    }
    const values = await promptParameterValues(
      job,
      { ...resource, resourceLocation: "REPOSITORY" },
      this.picker,
    );
    if (values === undefined) {
      return;
    }
    await this.submit(resource, values, "test");
  }

  /** Run a job with the given values, without prompting. */
  async submit(
    resource: JobResource,
    values: ParameterValue[],
    kind?: RunKind,
  ): Promise<void> {
    let submission: Submission;
    try {
      submission = await window.withProgress(
        {
          location: ProgressLocation.Window,
          title: l10n.t(JobMessages.Starting, { name: resource.name }),
        },
        () => this.model.submit(toRunInfo(resource, values), kind),
      );
    } catch (error) {
      this.fail(JobMessages.RunError, resource.name, error);
      return;
    }
    this.output.info(
      `Started ${resource.path} (${resource.resourceLocation})${
        kind === "test"
          ? " as a test run"
          : kind
            ? ` to run and populate with ${kind} paths`
            : ""
      } as run ${submission.id}.`,
    );
    this.onChanged(submission);
    await this.follow(
      submission,
      kind === "test"
        ? (state) => this.afterTest(resource, state)
        : kind && ((state) => this.afterPopulate(resource, state)),
    );
  }

  /** Say what a passed test run does and does not show, without waiting. */
  private async afterTest(resource: JobResource, state: string): Promise<void> {
    const outcome = outcomeOf(state);
    if (outcome === "success" || outcome === "warning") {
      void window.showInformationMessage(
        l10n.t(JobMessages.TestPassed, { name: resource.name }),
      );
    }
  }

  /** Report what Run and populate left in the job, without waiting. */
  private async afterPopulate(
    resource: JobResource,
    state: string,
  ): Promise<void> {
    const outcome = outcomeOf(state);
    if (outcome !== "success" && outcome !== "warning") {
      void window.showWarningMessage(
        l10n.t(JobMessages.PopulateUnchanged, { name: resource.name }),
      );
      return;
    }
    // Open editors of the job show the populated version.
    this.onJobFileChanged(resource);
    let counts;
    try {
      counts = publishCounts(await this.model.readWorkspaceJob(resource));
    } catch (error) {
      this.output.warn(
        `Could not read ${resource.path} after Run and populate: ${jobErrorMessage(error)}`,
      );
      return;
    }
    this.output.info(
      `Populated ${resource.path}: ${counts.files} file(s), ${counts.folders} folder(s) in Publish Setup; ${counts.locations} check-in location(s).`,
    );
    void window
      .showInformationMessage(
        l10n.t(JobMessages.Populated, {
          name: resource.name,
          files: counts.files,
          folders: counts.folders,
        }),
        JobMessages.OpenJob,
      )
      .then((answer) => {
        const uri = answer && uriForResource(resource);
        if (uri) {
          void commands.executeCommand("vscode.open", uri, { preview: false });
        }
      });
  }

  /**
   * Show a run's progress until it ends, then report how it ended. The
   * notification's Cancel cancels the run.
   */
  async follow(
    submission: Submission,
    /** Called once the run has ended, before the outcome is reported. */
    onEnded?: (state: string) => Promise<void>,
  ): Promise<void> {
    const name = submission.name;
    let state = submission.state;
    try {
      state = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: l10n.t(JobMessages.RunTitle, { name }),
          cancellable: true,
        },
        async (progress, token) => {
          let canceling = false;
          token.onCancellationRequested(() => {
            canceling = true;
            progress.report({
              message: l10n.t(JobMessages.Canceling, { name }),
            });
            this.cancel(submission).catch(() => undefined);
          });
          return this.model.waitForCompletion(submission.id, {
            onUpdate: (current) => {
              if (!canceling) {
                progress.report({ message: humanizeState(current) });
              }
            },
          });
        },
      );
    } catch (error) {
      this.fail(JobMessages.RunError, name, error);
      return;
    }
    await onEnded?.(state);
    await this.report({ ...submission, state });
  }

  /** Ask the service to cancel a run that has not ended yet. */
  async cancel(submission: Submission): Promise<void> {
    try {
      await this.model.cancel(submission.id);
      this.output.info(
        `Asked to cancel run ${submission.id} of ${submission.name}.`,
      );
    } catch (error) {
      this.fail(JobMessages.CancelError, submission.name, error);
      throw error;
    }
  }

  /** The toast for a finished run, with its log and results one click away. */
  private async report(finished: Submission): Promise<void> {
    let submission = finished;
    try {
      submission = await this.model.getSubmission(finished.id);
    } catch {
      // The final state is known; the details are a bonus.
    }
    this.onChanged(submission);
    const outcome = outcomeOf(submission.state);
    if (outcome === "running" || !isTerminal(submission.state)) {
      return;
    }
    const failures = submission.checkinFailures ?? [];
    for (const failure of failures) {
      this.output.warn(
        `Not checked in: ${failure.itemIdentifier ?? ""}/${failure.itemName ?? ""} - ${failure.message}`,
      );
    }
    this.output.info(
      `Run ${submission.id} of ${submission.job.path}: ${submission.state}. ${submission.info ?? ""}`,
    );

    const message = l10n.t(OutcomeMessages[outcome], {
      name: submission.name,
      info: submission.info ?? humanizeState(submission.state),
    });
    const actions = [
      JobMessages.OpenLog,
      JobMessages.OpenResults,
      JobMessages.ShowManifest,
    ];
    const show =
      outcome === "success" || outcome === "canceled"
        ? window.showInformationMessage
        : outcome === "warning"
          ? window.showWarningMessage
          : window.showErrorMessage;
    if (failures.length) {
      window.showWarningMessage(
        l10n.t(JobMessages.CheckinFailures, {
          count: failures.length,
          name: submission.name,
        }),
      );
    }
    const choice = await show(message, ...actions);
    if (choice === JobMessages.OpenLog) {
      await this.openFiles(submission, "logs");
    } else if (choice === JobMessages.OpenResults) {
      await this.openFiles(submission, "results");
    } else if (choice === JobMessages.ShowManifest) {
      await commands.executeCommand("SAS.clinical.job.showManifest", {
        kind: "run",
        submission,
      });
    }
  }

  /** Open a run's log or results, as its manifest lists them. */
  async openFiles(
    submission: Submission,
    kind: "logs" | "results",
  ): Promise<void> {
    let manifest: Manifest;
    try {
      manifest = await this.model.getSubmissionManifest(submission.id);
    } catch (error) {
      window.showErrorMessage(
        l10n.t(JobMessages.ManifestError, { message: jobErrorMessage(error) }),
      );
      return;
    }
    const files = manifest[kind] ?? [];
    if (!files.length) {
      window.showInformationMessage(
        kind === "logs" ? JobMessages.NoLog : JobMessages.NoResults,
      );
      return;
    }
    for (const file of files) {
      const uri = uriForResource(file.resource);
      if (uri) {
        await commands.executeCommand("vscode.open", uri, { preview: false });
      } else {
        window.showWarningMessage(JobMessages.CannotOpen);
      }
    }
  }

  private fail(template: string, name: string, error: unknown): void {
    const message = jobErrorMessage(error);
    this.output.error(`${name}: ${message}`);
    window.showErrorMessage(l10n.t(template, { name, message }));
  }
}
