// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Running LSAF jobs: Run Job on a .job file in either view or its editor,
// Run on LSAF for a .sas program in the workspace (which makes a job next to
// it), and the Jobs view's commands.
import {
  Disposable,
  LogOutputChannel,
  ProgressLocation,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import { JobNode, JobsDataProvider, outcomeLabel } from "./JobsDataProvider";
import { JobsModel, parseParameter } from "./JobsModel";
import { describeError } from "./LsafClient";
import { WorkspaceNode, isWorkspaceNode } from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { JOBS_VIEW_ID } from "./const";
import { JobOutputs } from "./jobOutputs";
import { Messages } from "./messages";
import {
  baseName,
  extension,
  jobPathForProgram,
  relativeProgramReference,
} from "./paths";
import type { TrackedRun } from "./runStore";
import type { Area, RepositoryItem } from "./types";
import { areaUri, lsafLocation } from "./uris";

type Target = RepositoryItem | WorkspaceNode | Uri | undefined;

export class JobCommands implements Disposable {
  private readonly disposables: Disposable[];

  constructor(
    private readonly view: JobsDataProvider,
    private readonly jobs: JobsModel,
    private readonly outputs: JobOutputs,
    private readonly workspaceModel: WorkspaceModel,
    private readonly output: LogOutputChannel,
    private readonly refreshFiles: () => void,
  ) {
    const register = <T>(id: string, action: (arg: T) => Promise<void>) =>
      commands.registerCommand(id, (arg: T) => this.run(() => action(arg)));
    this.disposables = [
      register<Target>("SAS.lsaf.runJob", (arg) => this.runJob(arg, false)),
      register<Target>("SAS.lsaf.runJobWithParameters", (arg) =>
        this.runJob(arg, true),
      ),
      register<Target>("SAS.lsaf.runProgram", (arg) => this.runProgram(arg)),
      register<JobNode>("SAS.lsaf.jobs.openLog", (node) => this.openLog(node)),
      register<JobNode>("SAS.lsaf.jobs.openManifest", (node) =>
        this.openManifest(node),
      ),
      register<JobNode>("SAS.lsaf.jobs.openJob", (node) =>
        this.open(node.run.area, node.run.jobPath),
      ),
      register<JobNode>("SAS.lsaf.jobs.runAgain", (node) =>
        this.runAgain(node),
      ),
      register<JobNode>("SAS.lsaf.jobs.copyId", async (node) => {
        await env.clipboard.writeText(
          this.view
            .selectedRuns(node)
            .map((run) => run.id)
            .join("\n"),
        );
      }),
      register<JobNode>("SAS.lsaf.jobs.remove", async (node) => {
        await this.view
          .store()
          ?.remove(this.view.selectedRuns(node).map((run) => run.id));
        this.view.refresh();
      }),
      register<void>("SAS.lsaf.jobs.clearFinished", async () => {
        await this.view.store()?.removeFinished();
        this.view.refresh();
      }),
      register<void>("SAS.lsaf.jobs.refresh", async () => this.view.refresh()),
    ];
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = describeError(error);
      this.output.error(message);
      window.showErrorMessage(message);
    }
  }

  /** The area and path a command acts on, or the active editor's file. */
  private locate(target: Target): { area: Area; path: string } | undefined {
    if (isWorkspaceNode(target)) {
      return { area: "workspace", path: target.path };
    }
    if (target instanceof Uri) {
      return lsafLocation(target);
    }
    if (target && "path" in target) {
      return { area: "repository", path: target.path };
    }
    return lsafLocation(window.activeTextEditor?.document.uri);
  }

  /** Save the file's editor, if it has unsaved changes. */
  private async saveEditor(area: Area, path: string): Promise<void> {
    const uri = areaUri(area, path).toString();
    const document = workspace.textDocuments.find(
      (d) => d.uri.toString() === uri,
    );
    if (document?.isDirty) {
      await document.save();
    }
  }

  async runJob(target: Target, askParameters: boolean): Promise<void> {
    const location = this.locate(target);
    if (!location || extension(location.path) !== "job") {
      window.showErrorMessage(Messages.NotAJob);
      return;
    }
    let parameters: Record<string, string> | undefined;
    if (askParameters) {
      parameters = await askParameterValues(location.path);
      if (!parameters) {
        return;
      }
    }
    await this.saveEditor(location.area, location.path);
    await this.submit(location.area, location.path, parameters);
  }

  /**
   * Run a workspace program: make `<program>.job` next to it, or reuse the
   * one there, and submit it.
   */
  async runProgram(target: Target): Promise<void> {
    const location = this.locate(target);
    if (location?.area !== "workspace" || extension(location.path) !== "sas") {
      window.showErrorMessage(Messages.NotAWorkspaceProgram);
      return;
    }
    await this.saveEditor(location.area, location.path);
    const jobPath = jobPathForProgram(location.path);
    if (await this.workspaceModel.fileExists(jobPath)) {
      this.output.info(`Running the existing job ${jobPath}.`);
    } else {
      await this.jobs.createJob("workspace", jobPath, [
        relativeProgramReference(location.path),
      ]);
      this.output.info(`Created the job ${jobPath} for ${location.path}.`);
      this.refreshFiles();
    }
    await this.submit("workspace", jobPath, undefined, location.path);
  }

  private async runAgain(node: JobNode): Promise<void> {
    const { run } = node;
    await this.submit(run.area, run.jobPath, run.parameters, run.programPath);
  }

  private async submit(
    area: Area,
    jobPath: string,
    parameters?: Record<string, string>,
    programPath?: string,
  ): Promise<void> {
    const id = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: l10n.t(Messages.Submitting, { name: baseName(jobPath) }),
      },
      () => this.jobs.submit(area, jobPath, parameters),
    );
    this.output.info(`Submitted ${jobPath} (${area}) as ${id}.`);
    await this.view.track({
      id,
      area,
      jobPath,
      programPath,
      parameters,
      submittedAt: new Date().toISOString(),
      outcome: "running",
    });
    window.setStatusBarMessage(
      l10n.t(Messages.Submitted, { name: baseName(jobPath) }),
      5000,
    );
    await commands.executeCommand(`${JOBS_VIEW_ID}.focus`);
  }

  /** Tell the user a run finished, with its log and manifest at hand. */
  notifyFinished(run: TrackedRun): void {
    const message = l10n.t(Messages.RunFinished, {
      name: baseName(run.jobPath),
      outcome: outcomeLabel(run.outcome).toLowerCase(),
    });
    const show =
      run.outcome === "failed"
        ? window.showErrorMessage
        : run.outcome === "warnings"
          ? window.showWarningMessage
          : window.showInformationMessage;
    show(message, Messages.OpenLog, Messages.ShowManifest).then((answer) => {
      const node: JobNode = { kind: "run", run };
      if (answer === Messages.OpenLog) {
        void this.run(() => this.openLog(node));
      } else if (answer === Messages.ShowManifest) {
        void this.run(() => this.openManifest(node));
      }
    });
  }

  private async open(area: Area, path: string): Promise<void> {
    await commands.executeCommand("vscode.open", areaUri(area, path), {
      preview: false,
    });
  }

  async openLog(node: JobNode): Promise<void> {
    if (node.kind === "file") {
      return this.open(node.file.area, node.file.path);
    }
    if (node.run.outcome === "running") {
      window.showInformationMessage(Messages.StillRunning);
      return;
    }
    const files = await this.view.outputsOf(node.run);
    const log = files.find((file) => file.kind === "log");
    if (log) {
      return this.open(log.area, log.path);
    }
    const manifest = files.find((file) => file.kind === "manifest");
    const answer = await window.showWarningMessage(
      manifest
        ? l10n.t(Messages.NoLogWithManifest, { path: manifest.path })
        : Messages.NoLog,
      ...(manifest ? [Messages.ShowManifest] : []),
    );
    if (answer && manifest) {
      await this.open(manifest.area, manifest.path);
    }
  }

  async openManifest(node: JobNode): Promise<void> {
    const manifest = await this.outputs.manifest(node.run);
    if (!manifest) {
      window.showWarningMessage(Messages.NoManifest);
      return;
    }
    await this.open(manifest.area, manifest.path);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/**
 * Ask for parameter values one `name=value` at a time; an empty entry ends.
 * The API offers no way to read a job's parameters, so they're typed.
 */
async function askParameterValues(
  jobPath: string,
): Promise<Record<string, string> | undefined> {
  const parameters: Record<string, string> = {};
  for (;;) {
    const count = Object.keys(parameters).length;
    const entry = await window.showInputBox({
      title: l10n.t(Messages.ParametersTitle, { name: baseName(jobPath) }),
      prompt: count
        ? l10n.t(Messages.ParameterPromptMore, {
            values: Object.entries(parameters)
              .map(([name, value]) => `${name}=${value}`)
              .join(", "),
          })
        : Messages.ParameterPrompt,
      placeHolder: "NAME=value",
      ignoreFocusOut: true,
      validateInput: (value) =>
        !value.trim() || parseParameter(value)
          ? undefined
          : Messages.ParameterFormat,
    });
    if (entry === undefined) {
      return undefined;
    }
    const parsed = parseParameter(entry);
    if (!parsed) {
      return parameters;
    }
    parameters[parsed[0]] = parsed[1];
  }
}
