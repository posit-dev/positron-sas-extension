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

import {
  type RepositoryModel,
  getActiveViyaEndpoint,
} from "../RepositoryModel";
import { getWorkspaceUri } from "../WorkspaceDataProvider";
import type { WorkspaceModel } from "../WorkspaceModel";
import { toInputValidator } from "../messages";
import { formatDate } from "../properties";
import type { RepositoryItem, WorkspaceItem } from "../types";
import { validateFileName } from "../utils";
import { ItemPicker } from "./ItemPicker";
import { JobEditorProvider } from "./JobEditorProvider";
import { JobRunner } from "./JobRunner";
import { JobsDataProvider } from "./JobsDataProvider";
import { JobsModel } from "./JobsModel";
import { type LoadedManifest, ManifestReports } from "./ManifestReports";
import { promptSchedule } from "./ScheduleWizard";
import {
  SCHEDULES_VIEW_ID,
  type ScheduleNode,
  SchedulesDataProvider,
} from "./SchedulesDataProvider";
import { HiddenRuns } from "./hiddenRuns";
import type { JobNode } from "./manifestTree";
import { JobMessages, errorStatus, jobErrorMessage } from "./messages";
import { valuesForRerun } from "./parameterValues";
import { ProgramJobs } from "./programJobs";
import { resourceForItem, resourceForUri, uriForResource } from "./resources";
import { scheduleJob, scheduleValues } from "./schedules";
import { isTerminal } from "./state";
import type { ClinicalJob, JobResource, Schedule, Submission } from "./types";
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
  const currentUser = () => repositoryModel.getCurrentUserId();
  // Runs removed from the view, per server and user.
  const hidden = new HiddenRuns(
    context.globalState,
    async () =>
      `${getActiveViyaEndpoint() ?? ""}|${(await currentUser()) ?? ""}`,
  );
  const view = new JobsDataProvider(model, log, hidden);
  const reports = new ManifestReports(model, output);
  const runner = new JobRunner(model, picker, output, (submission) => {
    view.upsert(submission);
    if (isTerminal(submission.state)) {
      refreshTrees();
    }
  });

  const programs = new ProgramJobs(model, runner, output, refreshTrees);
  const schedules = new SchedulesDataProvider(model, log, currentUser);

  /** The runs a command acts on: the clicked one, or the whole selection. */
  const runsOf = (node: JobNode, selected?: JobNode[]): Submission[] =>
    (selected?.length ? selected : [node]).flatMap((n) =>
      n.kind === "run" ? [n.submission] : [],
    );

  const scheduleOf = (node: ScheduleNode | undefined): Schedule | undefined =>
    node?.kind === "schedule" ? node.schedule : undefined;

  /** Run a change to a schedule; report a failure and refresh the view. */
  const changeSchedule = async (
    schedule: Schedule,
    change: () => Promise<unknown>,
  ) => {
    try {
      await change();
    } catch (error) {
      const message = jobErrorMessage(error);
      output.error(
        `Schedule ${schedule.id} (${schedule.name}): ${errorStatus(error)} ${message}`,
      );
      window.showErrorMessage(
        l10n.t(JobMessages.ScheduleError, { name: schedule.name, message }),
      );
    }
    schedules.refresh();
  };

  /**
   * The job definition, for its parameters. For a schedule whose job cannot
   * be read (a repository job is addressed by id), the schedule's own values
   * stand in.
   */
  const definitionFor = async (
    job: JobResource,
    schedule?: Schedule,
  ): Promise<ClinicalJob> => {
    try {
      return await runner.loadJob(job);
    } catch (error) {
      if (!schedule) {
        throw error;
      }
      return {
        parameters: (schedule.jobInfo?.parameterValues ?? []).map((v) => ({
          name: v.name,
          label: v.label && v.label !== "null" ? v.label : undefined,
          type: v.type,
          defaultValue: v.value,
        })),
      };
    }
  };

  /** The next run of a saved schedule, for the confirmation. */
  const nextRun = async (id: string) => {
    try {
      const [next] = await model.getFutureRuns(id, 1);
      return next ? formatDate(next) : JobMessages.ScheduleNoNext;
    } catch {
      return JobMessages.ScheduleNoNext;
    }
  };

  /** A job to schedule when none was selected: pick one. */
  const pickJob = async (): Promise<JobResource | undefined> => {
    const where = await window.showQuickPick(
      [
        {
          label: "$(folder) Clinical Workspace",
          location: "WORKSPACE" as const,
        },
        {
          label: "$(database) Clinical Repository",
          location: "REPOSITORY" as const,
        },
      ],
      { placeHolder: JobMessages.PickJobLocation },
    );
    if (!where) {
      return undefined;
    }
    const path = await picker.pick({
      mode: "file",
      location: where.location,
      title: JobMessages.NotAScheduleJob,
    });
    if (!path?.toLowerCase().endsWith(".cjob")) {
      if (path) {
        window.showInformationMessage(JobMessages.NotAScheduleJob);
      }
      return undefined;
    }
    return resourceFromPath(path, where.location);
  };

  const runOf = (node: JobNode | undefined): Submission | undefined =>
    node?.kind === "run" ? node.submission : undefined;

  const disposables: Disposable[] = [
    view,
    schedules,
    commands.registerCommand("SAS.clinical.schedules.refresh", () =>
      schedules.refresh(),
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.new",
      async (target: RunTarget) => {
        // A job item or editor; else the active editor if it is a job; else
        // ask (the view's + button).
        const job =
          jobResource(target) ?? (target ? undefined : await pickJob());
        if (!job) {
          if (target) {
            window.showInformationMessage(JobMessages.NotAScheduleJob);
          }
          return;
        }
        let definition: ClinicalJob;
        try {
          definition = await definitionFor(job);
        } catch (error) {
          window.showErrorMessage(
            l10n.t(JobMessages.LoadJobError, {
              name: job.name,
              message: jobErrorMessage(error),
            }),
          );
          return;
        }
        const schedule = await promptSchedule(job, definition, picker);
        if (!schedule) {
          return;
        }
        let created: Schedule;
        try {
          created = await model.createSchedule(schedule);
        } catch (error) {
          const message = jobErrorMessage(error);
          output.error(
            `New schedule ${schedule.name}: ${errorStatus(error)} ${message}`,
          );
          window.showErrorMessage(
            l10n.t(JobMessages.ScheduleCreateError, {
              name: schedule.name,
              message,
            }),
          );
          return;
        }
        output.info(
          `Created schedule ${created.id} (${created.name}) for ${job.path}.`,
        );
        schedules.refresh();
        const choice = await window.showInformationMessage(
          l10n.t(JobMessages.ScheduleCreated, {
            name: created.name,
            next: await nextRun(created.id),
          }),
          JobMessages.ShowSchedules,
        );
        if (choice) {
          await commands.executeCommand(`${SCHEDULES_VIEW_ID}.focus`);
        }
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.edit",
      async (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        const job = schedule && scheduleJob(schedule);
        if (!schedule || !job) {
          return;
        }
        const definition = await definitionFor(job, schedule);
        const changed = await promptSchedule(job, definition, picker, schedule);
        if (!changed) {
          return;
        }
        await changeSchedule(schedule, async () => {
          await model.updateSchedule(schedule.id, changed);
          output.info(`Changed schedule ${schedule.id} (${changed.name}).`);
          window.showInformationMessage(
            l10n.t(JobMessages.ScheduleUpdated, {
              name: changed.name,
              next: await nextRun(schedule.id),
            }),
          );
        });
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.enable",
      (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        return (
          schedule &&
          changeSchedule(schedule, () =>
            model.setScheduleStatus(schedule.id, "ENABLED"),
          )
        );
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.disable",
      (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        return (
          schedule &&
          changeSchedule(schedule, () =>
            model.setScheduleStatus(schedule.id, "DISABLED"),
          )
        );
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.delete",
      async (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        if (!schedule) {
          return;
        }
        const answer = await window.showWarningMessage(
          l10n.t(JobMessages.DeleteSchedulePrompt, { name: schedule.name }),
          { modal: true },
          JobMessages.DeleteSchedule,
        );
        if (answer === JobMessages.DeleteSchedule) {
          await changeSchedule(schedule, async () => {
            await model.deleteSchedule(schedule.id);
            output.info(`Deleted schedule ${schedule.id} (${schedule.name}).`);
          });
        }
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.runNow",
      (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        const job = schedule && scheduleJob(schedule);
        return job && runner.submit(job, scheduleValues(schedule));
      },
    ),
    commands.registerCommand(
      "SAS.clinical.schedule.copyId",
      (node: ScheduleNode) => {
        const schedule = scheduleOf(node);
        return schedule && env.clipboard.writeText(schedule.id);
      },
    ),
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
    commands.registerCommand(
      "SAS.clinical.job.hide",
      async (node: JobNode, selected?: JobNode[]) => {
        await hidden.hide(runsOf(node, selected));
        view.redraw();
      },
    ),
    commands.registerCommand(
      "SAS.clinical.job.restore",
      async (node: JobNode, selected?: JobNode[]) => {
        await hidden.restore(runsOf(node, selected));
        view.redraw();
      },
    ),
    commands.registerCommand("SAS.clinical.jobs.clearFinished", async () => {
      const before = hidden.snapshot();
      await hidden.clearFinished();
      view.redraw();
      const choice = await window.showInformationMessage(
        JobMessages.ClearedRuns,
        JobMessages.Undo,
      );
      if (choice === JobMessages.Undo) {
        await hidden.set(before);
        view.redraw();
      }
    }),
    commands.registerCommand("SAS.clinical.jobs.restoreAll", async () => {
      await hidden.restoreAll();
      view.redraw();
    }),
    commands.registerCommand("SAS.clinical.jobs.showHidden", () =>
      view.setShowHidden(true),
    ),
    commands.registerCommand("SAS.clinical.jobs.hideHidden", () =>
      view.setShowHidden(false),
    ),
    commands.registerCommand("SAS.clinical.schedules.showAll", () =>
      schedules.setShowAll(true),
    ),
    commands.registerCommand("SAS.clinical.schedules.showMine", () =>
      schedules.setShowAll(false),
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
    refresh: () => {
      view.refresh();
      schedules.refresh();
    },
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
