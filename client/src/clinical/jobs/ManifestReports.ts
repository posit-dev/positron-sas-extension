// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Show a run's manifest as a report in the Viewer (or a webview outside
// Positron), and export it as HTML or JSON.
import { Disposable, LogOutputChannel, l10n, window } from "vscode";

import { ReportPresenter, stem } from "../report/ReportPresenter";
import type { JobsModel } from "./JobsModel";
import { renderManifestReport } from "./manifestReport";
import { JobMessages, ReportLabelText, jobErrorMessage } from "./messages";
import { uriForResource } from "./resources";
import type { CheckinFailure, JobResource, Manifest } from "./types";
import { baseName, withFileCheckin } from "./utils";

/** A manifest and what the report needs besides it. */
export interface LoadedManifest {
  manifest: Manifest;
  checkinFailures: CheckinFailure[];
  /** For titles and file names. */
  jobName: string;
}

export class ManifestReports implements Disposable {
  private readonly presenter: ReportPresenter;

  constructor(
    private readonly model: JobsModel,
    private readonly output: LogOutputChannel,
  ) {
    this.presenter = new ReportPresenter(
      output,
      "sas.clinicalManifest",
      "Manifest",
    );
  }

  /** The manifest of a run, with its check-in failures. */
  async forRun(submissionId: string): Promise<LoadedManifest> {
    const [served, submission] = await Promise.all([
      this.model.getSubmissionManifest(submissionId),
      this.model.getSubmission(submissionId).catch(() => undefined),
    ]);
    const manifest = await this.completeCheckin(
      served,
      served.manifest?.resource,
    );
    return {
      manifest,
      checkinFailures: submission?.checkinFailures ?? [],
      jobName: manifest.job?.resource.name ?? submission?.name ?? "",
    };
  }

  /** The manifest a .cmnf file in the workspace or repository records. */
  async forFile(file: JobResource): Promise<LoadedManifest> {
    const served =
      file.resourceLocation === "WORKSPACE"
        ? await this.model.readWorkspaceManifest(file.path)
        : await this.model.getRepositoryManifest(
            file.id ?? "",
            file.fileVersion,
          );
    // The file itself, at the version opened.
    const manifest = await this.completeCheckin(served, file);
    const runId = manifest.jobSubmission?.id;
    const submission = runId
      ? await this.model.getSubmission(runId).catch(() => undefined)
      : undefined;
    return {
      manifest,
      checkinFailures: submission?.checkinFailures ?? [],
      jobName: manifest.job?.resource.name ?? baseName(file.path),
    };
  }

  /**
   * The service's manifest can lack the run's check-in locations, which the
   * .cmnf file keeps: take them from the file then.
   */
  private async completeCheckin(
    manifest: Manifest,
    file: Partial<JobResource> | undefined,
  ): Promise<Manifest> {
    if (manifest.checkinSpecification?.locations?.length) {
      return manifest;
    }
    try {
      const fromFile = await this.model.readManifestFileCheckin(file);
      const completed = withFileCheckin(manifest, fromFile);
      if (completed !== manifest) {
        this.output.info(
          `The service's manifest of run ${manifest.jobSubmission?.id ?? "?"} lists no check-in locations; showing the ${fromFile?.locations.length ?? 0} that ${file?.path ?? "its .cmnf file"} records.`,
        );
      }
      return completed;
    } catch (error) {
      this.output.warn(
        `Could not read the check-in locations from ${file?.path ?? "the .cmnf file"}: ${jobErrorMessage(error)}`,
      );
      return manifest;
    }
  }

  /** The report; with links to the run's files, for the server's pages. */
  render({ manifest, checkinFailures }: LoadedManifest, links = false): string {
    return renderManifestReport(manifest, ReportLabelText, {
      checkinFailures,
      linkFor: links
        ? (resource) => {
            const uri = uriForResource(resource);
            return uri && ReportPresenter.linkTo(uri);
          }
        : undefined,
    });
  }

  show(loaded: LoadedManifest): Promise<void> {
    return this.presenter.show({
      render: (links) => this.render(loaded, links),
      title: l10n.t(JobMessages.ManifestTitle, { name: loaded.jobName }),
      name: `manifest-${stem(loaded.jobName, "job")}`,
    });
  }

  /** Save the report (.html) or the manifest itself (.json). */
  async export(loaded: LoadedManifest): Promise<void> {
    const runId = loaded.manifest.jobSubmission?.id?.slice(0, 8);
    let target;
    try {
      target = await this.presenter.save({
        title: JobMessages.ExportTitle,
        defaultName: `${stem(loaded.jobName, "job")}-manifest${runId ? `-${runId}` : ""}`,
        filters: { HTML: ["html"], JSON: ["json"] },
        content: (extension) =>
          extension === "json"
            ? `${JSON.stringify(loaded.manifest, null, 2)}\n`
            : this.render(loaded),
      });
    } catch (error) {
      const message = jobErrorMessage(error);
      this.output.error(`Manifest export: ${message}`);
      window.showErrorMessage(l10n.t(JobMessages.ExportError, { message }));
      return;
    }
    if (!target) {
      return;
    }
    this.output.info(
      `Exported the manifest of ${loaded.jobName} to ${target.fsPath}.`,
    );
    window.showInformationMessage(
      l10n.t(JobMessages.Exported, { path: target.fsPath }),
    );
  }

  dispose(): void {
    this.presenter.dispose();
  }
}
