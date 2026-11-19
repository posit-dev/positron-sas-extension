// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Scheduling SAS jobs (#150, phase 3). A schedule is a persisted job request,
// holding the parameter values and the compute context, plus a Scheduler job
// that runs it. Each run is an ordinary background job in Background Jobs.
import { Disposable, QuickPickItem, commands, env, l10n, window } from "vscode";

import { getActiveViyaEndpoint } from "../viya/endpoint";
import type { JobsModel } from "./JobsModel";
import { promptParameterValues } from "./SasJobs";
import type { SasJobNode } from "./SasJobsDataProvider";
import {
  ScheduleNode,
  SchedulesDataProvider,
  whenText,
} from "./SchedulesDataProvider";
import { NeverFiresError, SchedulesModel } from "./SchedulesModel";
import { keepResultsFor } from "./code";
import type { ComputeContextResolver } from "./computeContext";
import { DEFINITIONS, JOBS_PAGE_LIMIT } from "./const";
import { BackgroundJobMessages, backgroundJobErrorMessage } from "./messages";
import { argumentsFor, ownContext, promptableParameters } from "./parameters";
import { promptSchedule } from "./schedulePrompts";
import {
  SchedulerJob,
  buildSchedule,
  buildTrigger,
  fireTimesProblem,
  jobRequestIdOf,
} from "./schedules";
import type { ExecutionJob, JobDefinition } from "./types";

/** The Scheduler would not run a new schedule at the times asked for. */
class UnexpectedTimesError extends Error {}

export interface SchedulesHost {
  jobs: JobsModel;
  schedules: SchedulesModel;
  contexts: ComputeContextResolver;
  language: string;
  log: (message: string) => void;
  track(job: ExecutionJob): Promise<void>;
}

export class ScheduleCommands implements Disposable {
  readonly provider: SchedulesDataProvider;
  private readonly disposables: Disposable[];

  constructor(private readonly host: SchedulesHost) {
    this.provider = new SchedulesDataProvider(host.schedules, host.log);
    const onSchedule =
      (action: (schedule: SchedulerJob) => unknown) => (node?: ScheduleNode) =>
        node?.kind === "schedule" ? action(node.schedule) : undefined;
    this.disposables = [
      this.provider,
      commands.registerCommand("SAS.sasJob.schedule", (node?: SasJobNode) =>
        node?.kind === "definition"
          ? this.schedule(node.definition)
          : undefined,
      ),
      commands.registerCommand("SAS.sasJobSchedules.new", () =>
        this.pickAndSchedule(),
      ),
      commands.registerCommand(
        "SAS.sasJobSchedule.runNow",
        onSchedule((s) => this.runNow(s)),
      ),
      commands.registerCommand(
        "SAS.sasJobSchedule.enable",
        onSchedule((s) => this.setEnabled(s, true)),
      ),
      commands.registerCommand(
        "SAS.sasJobSchedule.disable",
        onSchedule((s) => this.setEnabled(s, false)),
      ),
      commands.registerCommand(
        "SAS.sasJobSchedule.copyId",
        onSchedule((s) => s.id && env.clipboard.writeText(s.id)),
      ),
      commands.registerCommand(
        "SAS.sasJobSchedule.delete",
        (node?: ScheduleNode, nodes?: ScheduleNode[]) =>
          this.delete(selected(node, nodes)),
      ),
      commands.registerCommand("SAS.sasJobSchedules.refresh", () =>
        this.provider.refresh(),
      ),
      commands.registerCommand("SAS.sasJobSchedules.loadMore", () =>
        this.provider.loadMore(),
      ),
    ];
  }

  refresh(): void {
    this.provider.refresh();
  }

  /** New schedule from the view title: choose the SAS job first. */
  private async pickAndSchedule(): Promise<void> {
    let definitions: JobDefinition[];
    try {
      definitions = (await this.host.jobs.listDefinitions(0, JOBS_PAGE_LIMIT))
        .items;
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SasJobsListError, {
          message: backgroundJobErrorMessage(error),
        }),
      );
      return;
    }
    if (!definitions.length) {
      window.showInformationMessage(BackgroundJobMessages.NoSasJobs);
      return;
    }
    const choice = await window.showQuickPick(
      definitions.map(
        (definition): QuickPickItem & { definition: JobDefinition } => ({
          definition,
          label: definition.name,
          description: promptableParameters(definition).length
            ? l10n.t("{count} parameter(s)", {
                count: promptableParameters(definition).length,
              })
            : undefined,
        }),
      ),
      {
        placeHolder: BackgroundJobMessages.PickJobToSchedule,
        ignoreFocusOut: true,
      },
    );
    if (choice) {
      await this.schedule(choice.definition);
    }
  }

  /** Ask for values and times, then store the job request and the schedule. */
  async schedule(definition: JobDefinition): Promise<void> {
    const endpoint = getActiveViyaEndpoint();
    if (!endpoint || !definition.id) {
      window.showWarningMessage(BackgroundJobMessages.NotViya);
      return;
    }
    const values = await promptParameterValues(definition, {
      useDefaults: false,
      title: l10n.t(BackgroundJobMessages.ScheduleTitle, {
        name: definition.name,
      }),
    });
    if (!values) {
      return;
    }
    const prompted = await promptSchedule(definition.name);
    if (!prompted) {
      return;
    }
    // A job with its own _contextName (as SAS Studio's have) keeps it.
    const own = ownContext(definition);
    const contextName = own
      ? undefined
      : await this.host.contexts.resolve(endpoint);
    if (!own && !contextName) {
      return;
    }

    const { name, answers } = prompted;
    let jobRequestId: string | undefined;
    try {
      jobRequestId = await this.host.schedules.createJobRequest({
        name: definition.name,
        description: definition.description,
        definitionUri: `${DEFINITIONS}/${definition.id}`,
        arguments: {
          ...(contextName ? { _contextName: contextName } : {}),
          ...argumentsFor(promptableParameters(definition), values),
        },
        expiresAfter: keepResultsFor(),
      });
      const created = await this.host.schedules.createSchedule(
        buildSchedule({
          name,
          jobRequestId,
          trigger: buildTrigger(answers, name),
          language: this.host.language,
        }),
      );
      // Check the times the Scheduler will actually use before leaving the
      // schedule in place: a bad trigger shape can start many runs at once.
      let times: string[] = [];
      try {
        times = created.id
          ? await this.host.schedules.fireTimes(created.id, 10)
          : [];
      } catch {
        times = [];
      }
      if (created.id && fireTimesProblem(times, answers)) {
        await this.host.schedules
          .deleteSchedule(created.id)
          .catch(() => undefined);
        throw new UnexpectedTimesError();
      }
      this.provider.upsert(created);
      const next = times[0];
      window.showInformationMessage(
        next
          ? l10n.t(BackgroundJobMessages.Scheduled, {
              name,
              when: whenText(created),
              next: new Date(next).toLocaleString(),
            })
          : l10n.t(BackgroundJobMessages.ScheduledNoNext, {
              name,
              when: whenText(created),
            }),
      );
    } catch (error) {
      // Leave nothing behind: the job request is only for this schedule.
      if (jobRequestId) {
        await this.host.schedules
          .deleteJobRequest(jobRequestId)
          .catch(() => undefined);
      }
      window.showErrorMessage(
        error instanceof NeverFiresError
          ? l10n.t(BackgroundJobMessages.NeverFires, { name })
          : error instanceof UnexpectedTimesError
            ? l10n.t(BackgroundJobMessages.UnexpectedFireTimes, { name })
            : l10n.t(BackgroundJobMessages.ScheduleError, {
                name,
                message: backgroundJobErrorMessage(error),
              }),
      );
    }
  }

  /** Run a schedule's job request now, with its values. */
  private async runNow(schedule: SchedulerJob): Promise<void> {
    const requestId = jobRequestIdOf(schedule);
    if (!requestId) {
      return;
    }
    try {
      await this.host.track(await this.host.schedules.runJobRequest(requestId));
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SubmitError, {
          name: schedule.name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  private async setEnabled(
    schedule: SchedulerJob,
    enabled: boolean,
  ): Promise<void> {
    if (!schedule.id) {
      return;
    }
    try {
      this.provider.upsert(
        await this.host.schedules.setEnabled(schedule.id, enabled),
      );
    } catch (error) {
      window.showErrorMessage(
        error instanceof NeverFiresError
          ? l10n.t(BackgroundJobMessages.EnableNeverFires, {
              name: schedule.name,
            })
          : l10n.t(BackgroundJobMessages.EnableError, {
              name: schedule.name,
              message: backgroundJobErrorMessage(error),
            }),
      );
    }
  }

  /** Delete schedules and the job requests they run. */
  private async delete(schedules: SchedulerJob[]): Promise<void> {
    const targets = schedules.filter((s) => s.id);
    if (!targets.length) {
      return;
    }
    const prompt =
      targets.length === 1
        ? l10n.t(BackgroundJobMessages.DeleteScheduleConfirm, {
            name: targets[0].name,
          })
        : l10n.t(BackgroundJobMessages.DeleteSchedulesConfirm, {
            count: targets.length,
          });
    const ok = await window.showWarningMessage(
      prompt,
      { modal: true },
      BackgroundJobMessages.Delete,
    );
    if (ok !== BackgroundJobMessages.Delete) {
      return;
    }
    for (const schedule of targets) {
      try {
        await this.host.schedules.deleteSchedule(schedule.id!);
        const requestId = jobRequestIdOf(schedule);
        if (requestId) {
          await this.host.schedules.deleteJobRequest(requestId);
        }
      } catch (error) {
        window.showErrorMessage(
          l10n.t(BackgroundJobMessages.DeleteError, {
            name: schedule.name,
            message: backgroundJobErrorMessage(error),
          }),
        );
      }
    }
    this.provider.refresh();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function selected(node?: ScheduleNode, nodes?: ScheduleNode[]): SchedulerJob[] {
  const all = nodes?.length ? nodes : node ? [node] : [];
  return all.flatMap((n) => (n.kind === "schedule" ? [n.schedule] : []));
}
