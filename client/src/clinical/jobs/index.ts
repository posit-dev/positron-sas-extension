// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Clinical jobs (SAS Clinical Job Management): the Jobs view and the commands
// that run jobs and work with their runs. Shown when the server runs the
// service (context key SAS.clinical.jobsAvailable).
import {
  Disposable,
  ExtensionContext,
  LogOutputChannel,
  TabInputCustom,
  TabInputText,
  Uri,
  commands,
  env,
  l10n,
  window,
} from "vscode";

import type { RepositoryModel } from "../RepositoryModel";
import { getWorkspaceUri } from "../WorkspaceDataProvider";
import type { WorkspaceModel } from "../WorkspaceModel";
import { toInputValidator } from "../messages";
import type { RepositoryItem, WorkspaceItem } from "../types";
import { validateFileName } from "../utils";
import { ItemPicker } from "./ItemPicker";
import { JobEditorProvider } from "./JobEditorProvider";
import { JobRunner } from "./JobRunner";
import { JobsDataProvider } from "./JobsDataProvider";
import { JobsModel } from "./JobsModel";
import { type LoadedManifest, ManifestReports } from "./ManifestReports";
import type { JobNode } from "./manifestTree";
import { JobMessages, errorStatus, jobErrorMessage } from "./messages";
import { valuesForRerun } from "./parameterValues";
import { ProgramJobs } from "./programJobs";
import { resourceForItem, resourceForUri, uriForResource } from "./resources";
import { isTerminal } from "./state";
import type { JobResource, Submission } from "./types";
import { resourceFromPath } from "./utils";

export interface ClinicalJobs extends Disposable {
  /** Reload the Jobs view, after sign-in or a profile switch. */
  refresh(): void;
}

type RunTarget = RepositoryItem | WorkspaceItem | Uri | undefined;
type ManifestTarget =
  JobNode | RepositoryItem | WorkspaceItem | Uri | undefined;

export function registerClinicalJobs(
  context: ExtensionContext,
  repositoryModel: RepositoryModel,
  workspaceModel: WorkspaceModel,
  output: LogOutputChannel,
  /** Refresh the Repository and Workspace views: runs write outputs. */
  refreshTrees: () => void,
): ClinicalJobs {
  const log = (message: string) => output.info(message);
  const model = new JobsModel(repositoryModel, workspaceModel);
  const picker = new ItemPicker(repositoryModel, workspaceModel);
  const view = new JobsDataProvider(model, log);
  const reports = new ManifestReports(model, output);
  const runner = new JobRunner(model, picker, output, (submission) => {
    view.upsert(submission);
    if (isTerminal(submission.state)) {
      refreshTrees();
    }
  });

  const programs = new ProgramJobs(model, runner, output, refreshTrees);

  const runOf = (node: JobNode | undefined): Submission | undefined =>
    node?.kind === "run" ? node.submission : undefined;

  const disposables: Disposable[] = [
    view,
    commands.registerCommand("SAS.clinical.job.run", (target: RunTarget) => {
      const resource = jobResource(target);
      if (!resource) {
        window.showInformationMessage(JobMessages.NotAJob);
        return;
      }
      return runner.run(resource);
    }),
    commands.registerCommand(
      "SAS.clinical.job.runProgram",
      (target: RunTarget) => {
        const path = programPath(target);
        if (!path) {
          window.showInformationMessage(JobMessages.NotAProgram);
          return;
        }
        return programs.run(path);
      },
    ),
    JobEditorProvider.register(context, picker),
    commands.registerCommand(
      "SAS.clinical.job.new",
      async (folder: WorkspaceItem | undefined) => {
        const parent = folder?.path ?? "/";
        const input = await window.showInputBox({
          prompt: JobMessages.NewJobPrompt,
          value: "job.cjob",
          valueSelection: [0, 3],
          validateInput: toInputValidator(validateFileName),
        });
        if (!input) {
          return;
        }
        const name = input.toLowerCase().endsWith(".cjob")
          ? input
          : `${input}.cjob`;
        const resource = resourceFromPath(
          `${parent === "/" ? "" : parent}/${name}`,
          "WORKSPACE",
        );
        try {
          await model.createJob({ resource, programs: [], parameters: [] });
        } catch (error) {
          const message = jobErrorMessage(error);
          output.error(
            `New job ${resource.path}: ${errorStatus(error)} ${message}`,
          );
          window.showErrorMessage(
            l10n.t(JobMessages.NewJobError, { name, message }),
          );
          return;
        }
        output.info(`Created ${resource.path}.`);
        refreshTrees();
        await commands.executeCommand("vscode.open", getWorkspaceUri(resource));
      },
    ),
    commands.registerCommand("SAS.clinical.jobs.refresh", () => view.refresh()),
    commands.registerCommand("SAS.clinical.jobs.loadMore", () =>
      view.loadMore(),
    ),
    commands.registerCommand(
      "SAS.clinical.job.cancel",
      async (node: JobNode) => {
        const submission = runOf(node);
        if (submission && !isTerminal(submission.state)) {
          await runner.cancel(submission).catch(() => undefined);
          view.upsert({ ...submission, state: "CANCELING" });
        }
      },
    ),
    commands.registerCommand("SAS.clinical.job.openLog", (node: JobNode) => {
      const submission = runOf(node);
      return submission && runner.openFiles(submission, "logs");
    }),
    commands.registerCommand(
      "SAS.clinical.job.openResults",
      (node: JobNode) => {
        const submission = runOf(node);
        return submission && runner.openFiles(submission, "results");
      },
    ),
    commands.registerCommand("SAS.clinical.job.openJob", (node: JobNode) => {
      const submission = runOf(node);
      const uri = submission && uriForResource(submission.job);
      if (uri) {
        return commands.executeCommand("vscode.open", uri);
      }
      window.showWarningMessage(JobMessages.CannotOpen);
    }),
    commands.registerCommand(
      "SAS.clinical.job.runAgain",
      async (node: JobNode) => {
        const submission = runOf(node);
        if (!submission) {
          return;
        }
        // The values the run used, as its manifest recorded them.
        let values;
        try {
          values = valuesForRerun(
            (await model.getSubmissionManifest(submission.id)).parameters,
          );
        } catch (error) {
          window.showErrorMessage(
            l10n.t(JobMessages.ManifestError, {
              message: jobErrorMessage(error),
            }),
          );
          return;
        }
        await runner.submit(submission.job, values);
      },
    ),
    commands.registerCommand("SAS.clinical.job.copyId", (node: JobNode) => {
      const submission = runOf(node);
      return submission && env.clipboard.writeText(submission.id);
    }),
    reports,
    commands.registerCommand(
      "SAS.clinical.job.showManifest",
      async (target: ManifestTarget) => {
        const loaded = await loadManifest(target);
        return loaded && reports.show(loaded);
      },
    ),
    commands.registerCommand(
      "SAS.clinical.job.exportManifest",
      async (target: ManifestTarget) => {
        const loaded = await loadManifest(target);
        return loaded && reports.export(loaded);
      },
    ),
  ];

  /**
   * The manifest of a run in the Jobs view, of a .cmnf file in a tree or an
   * editor, or of the active editor's .cmnf file.
   */
  async function loadManifest(
    target: ManifestTarget,
  ): Promise<LoadedManifest | undefined> {
    try {
      if (target && "kind" in target) {
        const submission = runOf(target);
        return submission ? await reports.forRun(submission.id) : undefined;
      }
      let file: JobResource | undefined;
      if (target instanceof Uri) {
        file = resourceForUri(target);
      } else if (target && "path" in target) {
        file = resourceForItem(target);
      } else {
        const uri = activeUri();
        file = uri && resourceForUri(uri);
      }
      if (!file?.name.toLowerCase().endsWith(".cmnf")) {
        window.showInformationMessage(JobMessages.NotAManifest);
        return undefined;
      }
      return await reports.forFile(file);
    } catch (error) {
      const message = jobErrorMessage(error);
      output.error(`Manifest: ${errorStatus(error)} ${message}`);
      window.showErrorMessage(l10n.t(JobMessages.ManifestError, { message }));
      return undefined;
    }
  }

  return {
    refresh: () => view.refresh(),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/**
 * The job a command was invoked on: a tree item, an editor's URI, or else the
 * active editor's file.
 */
function jobResource(target: RunTarget): JobResource | undefined {
  let resource: JobResource | undefined;
  if (target instanceof Uri) {
    resource = resourceForUri(target);
  } else if (target && "path" in target) {
    resource = resourceForItem(target);
  } else {
    const uri = activeUri();
    resource = uri && resourceForUri(uri);
  }
  return resource?.name.toLowerCase().endsWith(".cjob") ? resource : undefined;
}

/**
 * The workspace SAS program a command was invoked on: a Workspace view item,
 * an editor's URI, or else the active editor's file.
 */
function programPath(target: RunTarget): string | undefined {
  let resource: JobResource | undefined;
  if (target instanceof Uri) {
    resource = resourceForUri(target);
  } else if (target && "path" in target) {
    resource = resourceForItem(target);
  } else {
    const uri = activeUri();
    resource = uri && resourceForUri(uri);
  }
  return resource?.resourceLocation === "WORKSPACE" &&
    resource.name.toLowerCase().endsWith(".sas")
    ? resource.path
    : undefined;
}

/**
 * The file of the active editor: a text editor, or a custom editor such as
 * the clinical job editor.
 */
function activeUri(): Uri | undefined {
  const input = window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof TabInputText || input instanceof TabInputCustom) {
    return input.uri;
  }
  return window.activeTextEditor?.document.uri;
}
