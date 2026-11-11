// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Show a run's manifest as a report in the Viewer (or a webview outside
// Positron), and export it as HTML or JSON.
import {
  Disposable,
  LogOutputChannel,
  Uri,
  ViewColumn,
  l10n,
  window,
  workspace,
} from "vscode";

import { OutputFiles } from "../../positron/outputFiles";
import { showHtmlInViewer } from "../../positron/viewer";
import type { JobsModel } from "./JobsModel";
import { renderManifestReport } from "./manifestReport";
import { JobMessages, ReportLabelText, jobErrorMessage } from "./messages";
import type { CheckinFailure, JobResource, Manifest } from "./types";
import { baseName } from "./utils";

/** A manifest and what the report needs besides it. */
export interface LoadedManifest {
  manifest: Manifest;
  checkinFailures: CheckinFailure[];
  /** For titles and file names. */
  jobName: string;
}

export class ManifestReports implements Disposable {
  // Reports are files so that Posit Assistant can read them in the Viewer.
  private readonly files = new OutputFiles(10);

  constructor(
    private readonly model: JobsModel,
    private readonly output: LogOutputChannel,
  ) {}

  /** The manifest of a run, with its check-in failures. */
  async forRun(submissionId: string): Promise<LoadedManifest> {
    const [manifest, submission] = await Promise.all([
      this.model.getSubmissionManifest(submissionId),
      this.model.getSubmission(submissionId).catch(() => undefined),
    ]);
    return {
      manifest,
      checkinFailures: submission?.checkinFailures ?? [],
      jobName: manifest.job?.resource.name ?? submission?.name ?? "",
    };
  }

  /** The manifest a .cmnf file in the workspace or repository records. */
  async forFile(file: JobResource): Promise<LoadedManifest> {
    const manifest =
      file.resourceLocation === "WORKSPACE"
        ? await this.model.readWorkspaceManifest(file.path)
        : await this.model.getRepositoryManifest(
            file.id ?? "",
            file.fileVersion,
          );
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

  render({ manifest, checkinFailures }: LoadedManifest): string {
    return renderManifestReport(manifest, ReportLabelText, { checkinFailures });
  }

  async show(loaded: LoadedManifest): Promise<void> {
    const html = this.render(loaded);
    const title = l10n.t(JobMessages.ManifestTitle, { name: loaded.jobName });
    const shown = await showHtmlInViewer(html, this.files, {
      viewType: "sas.clinicalManifest",
      title,
      preserveFocus: false,
      fileName: `manifest-${stem(loaded.jobName)}`,
    });
    if (!shown) {
      const panel = window.createWebviewPanel(
        "sas.clinicalManifest",
        title,
        ViewColumn.Beside,
        { enableScripts: false },
      );
      panel.webview.html = html;
    }
  }

  /** Save the report (.html) or the manifest itself (.json). */
  async export(loaded: LoadedManifest): Promise<void> {
    const runId = loaded.manifest.jobSubmission?.id?.slice(0, 8);
    const name = `${stem(loaded.jobName)}-manifest${runId ? `-${runId}` : ""}`;
    const folder = workspace.workspaceFolders?.[0]?.uri;
    const target = await window.showSaveDialog({
      title: JobMessages.ExportTitle,
      defaultUri: folder ? Uri.joinPath(folder, `${name}.html`) : undefined,
      filters: { HTML: ["html"], JSON: ["json"] },
    });
    if (!target) {
      return;
    }
    const json = target.path.toLowerCase().endsWith(".json");
    const text = json
      ? `${JSON.stringify(loaded.manifest, null, 2)}\n`
      : this.render(loaded);
    try {
      await workspace.fs.writeFile(target, new TextEncoder().encode(text));
    } catch (error) {
      const message = jobErrorMessage(error);
      this.output.error(`Manifest export to ${target.fsPath}: ${message}`);
      window.showErrorMessage(l10n.t(JobMessages.ExportError, { message }));
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
    void this.files.dispose();
  }
}

/** "probe.cjob" → "probe". */
function stem(name: string): string {
  return name.replace(/\.[^.]*$/, "") || "job";
}
