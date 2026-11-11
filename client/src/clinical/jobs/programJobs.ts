// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Run as Clinical Job: run one SAS program of the workspace as a clinical job,
// so the run gets a manifest. The job file (<program>.cjob) is created next to
// the program on first use and reused afterwards.
import { LogOutputChannel, l10n, window, workspace } from "vscode";

import { isAxiosError } from "axios";

import { getWorkspaceUri } from "../WorkspaceDataProvider";
import type { JobRunner } from "./JobRunner";
import type { JobsModel } from "./JobsModel";
import { JobMessages, jobErrorMessage } from "./messages";
import type { ClinicalJob, JobResource } from "./types";
import {
  baseName,
  jobPathForProgram,
  programJob,
  resourceFromPath,
  runsOnlyProgram,
} from "./utils";

/** How many "-n" names to try before giving up. */
const MAX_NAMES = 50;

export class ProgramJobs {
  constructor(
    private readonly model: JobsModel,
    private readonly runner: JobRunner,
    private readonly output: LogOutputChannel,
    /** Show the new job file in the Workspace view. */
    private readonly refreshWorkspace: () => void,
  ) {}

  /** Run the workspace program at `programPath` as a clinical job. */
  async run(programPath: string): Promise<void> {
    const program = baseName(programPath);
    // The job runs the saved file on the server, not the editor's contents.
    const uri = getWorkspaceUri({ path: programPath });
    const document = workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString(),
    );
    if (document?.isDirty && !(await document.save())) {
      return;
    }

    let job: JobResource | undefined;
    try {
      job = await this.findOrCreateJob(programPath);
    } catch (error) {
      const message = jobErrorMessage(error);
      this.output.error(`Run as Clinical Job ${programPath}: ${message}`);
      window.showErrorMessage(
        l10n.t(JobMessages.ProgramJobError, { name: program, message }),
      );
      return;
    }
    if (job) {
      await this.runner.run(job);
    }
  }

  /**
   * The job that runs only this program: <name>.cjob if it does, else a new
   * job under the first free name, or <name>.cjob replaced if the user wants.
   * Undefined when the user cancels.
   */
  private async findOrCreateJob(
    programPath: string,
  ): Promise<JobResource | undefined> {
    for (let n = 1; n <= MAX_NAMES; n++) {
      const resource = resourceFromPath(
        jobPathForProgram(programPath, n),
        "WORKSPACE",
      );
      const existing = await this.readJob(resource);
      if (existing === undefined) {
        await this.model.createJob(programJob(programPath, resource.path));
        this.output.info(`Created ${resource.path} to run ${programPath}.`);
        this.refreshWorkspace();
        return resource;
      }
      if (existing && runsOnlyProgram(existing, programPath)) {
        return resource;
      }
      if (n === 1) {
        const choice = await window.showWarningMessage(
          l10n.t(JobMessages.JobExists, {
            job: resource.name,
            program: baseName(programPath),
          }),
          { modal: true },
          JobMessages.CreateNewJob,
          JobMessages.ReplaceJob,
        );
        if (!choice) {
          return undefined;
        }
        if (choice === JobMessages.ReplaceJob) {
          await this.model.patchJob({
            ...(existing ?? {}),
            ...programJob(programPath, resource.path),
            parameters: [],
          });
          this.output.info(`Replaced ${resource.path} to run ${programPath}.`);
          return resource;
        }
      }
    }
    throw new Error(
      l10n.t(JobMessages.NoFreeJobName, { program: baseName(programPath) }),
    );
  }

  /**
   * The job at `resource`: undefined if there is no such file, null if the
   * file is not a job this extension can read.
   */
  private async readJob(
    resource: JobResource,
  ): Promise<ClinicalJob | null | undefined> {
    try {
      return await this.model.readWorkspaceJob(resource);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return undefined;
      }
      if (!isAxiosError(error)) {
        // Not JSON: a file of that name that is not a job.
        return null;
      }
      throw error;
    }
  }
}
