// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Opening what a finished background job left in the Files service. A job
// gives its log and the SAS listing; the Compute provider does not upload ODS
// HTML (checked against a live server), so "results" means the listing unless
// a deployment ever does produce HTML.
import { QuickPickItem, l10n, window } from "vscode";

import { showResult } from "../components/ResultPanel/ResultPanel";
import type { JobsModel } from "./JobsModel";
import type { JobLogDocuments } from "./jobLog";
import { BackgroundJobMessages, backgroundJobErrorMessage } from "./messages";
import type { ExecutionJob, JobFile } from "./types";
import { jobFiles, logFileOf, logJsonFileOf, resultFileOf } from "./utils";

const jobTitle = (job: ExecutionJob) =>
  job.jobRequest?.name || job.jobRequest?.jobDefinition?.name || job.id;

export class JobResults {
  constructor(
    private readonly model: JobsModel,
    private readonly documents: JobLogDocuments,
    private readonly log: (message: string) => void,
  ) {}

  /** The log, coloured from the line types SAS recorded. */
  async openLog(job: ExecutionJob): Promise<void> {
    const name = jobTitle(job);
    const structured = logJsonFileOf(job);
    try {
      if (structured) {
        const lines = await this.model.getLogLines(structured.id);
        if (lines.length) {
          await this.documents.showLog(job.id, name, lines);
          return;
        }
      }
      // No structured log: show the text one, uncoloured.
      const text = logFileOf(job);
      if (text && text.kind === "log") {
        await this.documents.showText(
          job.id,
          `${name}.log`,
          await this.model.getFileText(text.id),
        );
        return;
      }
      window.showInformationMessage(BackgroundJobMessages.NoLog);
    } catch (error) {
      this.report(name, error);
    }
  }

  /** The listing, or an HTML result if there is one. */
  async openResults(job: ExecutionJob): Promise<void> {
    const file = resultFileOf(job);
    if (!file) {
      window.showInformationMessage(BackgroundJobMessages.NoResults);
      return;
    }
    await this.openFile(job, file);
  }

  /** Any file the job produced, picked from a list. */
  async pickFile(job: ExecutionJob): Promise<void> {
    const files = jobFiles(job);
    if (!files.length) {
      window.showInformationMessage(BackgroundJobMessages.NoResults);
      return;
    }
    const choice = await window.showQuickPick(
      files.map((file): QuickPickItem & { file: JobFile } => ({
        file,
        label: file.key,
        description: file.kind,
      })),
      {
        placeHolder: l10n.t(BackgroundJobMessages.PickResult, {
          name: jobTitle(job),
        }),
      },
    );
    if (choice) {
      await this.openFile(job, choice.file);
    }
  }

  async openFile(job: ExecutionJob, file: JobFile): Promise<void> {
    const name = jobTitle(job);
    try {
      if (file.kind === "logJson") {
        await this.openLog(job);
        return;
      }
      const text = await this.model.getFileText(file.id);
      if (/\.html?$/i.test(file.key) || /^\s*<(!doctype|html)/i.test(text)) {
        showResult(
          text,
          undefined,
          l10n.t(BackgroundJobMessages.ResultsTitle, { name }),
        );
        return;
      }
      const fileName =
        file.kind === "listing" || file.kind === "listingJson"
          ? `${name}.lst`
          : file.key;
      await this.documents.showText(job.id, fileName, text);
    } catch (error) {
      this.report(file.key, error);
    }
  }

  private report(name: string, error: unknown): void {
    const message = backgroundJobErrorMessage(error);
    this.log(`Could not read ${name}: ${message}`);
    window.showErrorMessage(
      l10n.t(BackgroundJobMessages.FileError, { name, message }),
    );
  }
}

export { jobTitle };
