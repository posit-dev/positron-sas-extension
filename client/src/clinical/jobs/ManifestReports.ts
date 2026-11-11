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
  commands,
  l10n,
  window,
  workspace,
} from "vscode";

import { OutputFiles } from "../../positron/outputFiles";
import { showHtmlInViewer, showUrlInViewer } from "../../positron/viewer";
import { ViewerServer } from "../../positron/viewerServer";
import { CLINICAL_SCHEME, VERSION_SCHEME, WORKSPACE_SCHEME } from "../const";
import type { JobsModel } from "./JobsModel";
import { renderManifestReport } from "./manifestReport";
import { JobMessages, ReportLabelText, jobErrorMessage } from "./messages";
import { uriForResource } from "./resources";
import type { CheckinFailure, JobResource, Manifest } from "./types";
import { baseName } from "./utils";

/** A manifest and what the report needs besides it. */
export interface LoadedManifest {
  manifest: Manifest;
  checkinFailures: CheckinFailure[];
  /** For titles and file names. */
  jobName: string;
}

/** The file systems a report link may open: the Clinical Acceleration ones. */
const LINK_SCHEMES = new Set([
  CLINICAL_SCHEME,
  WORKSPACE_SCHEME,
  VERSION_SCHEME,
]);

export class ManifestReports implements Disposable {
  // Reports are URL or file previews, which Posit Assistant can read in the
  // Viewer. The server's pages have links that open the run's files; the
  // file fallback has none.
  private readonly server = new ViewerServer((target) => this.open(target));
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

  /** The report; with links to the run's files, for the server's pages. */
  render({ manifest, checkinFailures }: LoadedManifest, links = false): string {
    return renderManifestReport(manifest, ReportLabelText, {
      checkinFailures,
      linkFor: links
        ? (resource) => {
            const uri = uriForResource(resource);
            return uri && ViewerServer.linkTo(uri.toString());
          }
        : undefined,
    });
  }

  async show(loaded: LoadedManifest): Promise<void> {
    try {
      const url = await this.server.publish(
        this.render(loaded, true),
        `manifest-${stem(loaded.jobName)}`,
      );
      if (await showUrlInViewer(url)) {
        return;
      }
    } catch (error) {
      this.output.warn(`Manifest report server: ${error}`);
    }
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

  /** Open a file a report links to, if it is a Clinical Acceleration file. */
  private async open(target: string): Promise<boolean> {
    let uri: Uri;
    try {
      uri = Uri.parse(target, true);
    } catch {
      return false;
    }
    if (!LINK_SCHEMES.has(uri.scheme)) {
      this.output.warn(`Manifest report: refused to open ${target}.`);
      return false;
    }
    await commands.executeCommand("vscode.open", uri, { preview: false });
    return true;
  }

  dispose(): void {
    this.server.dispose();
    void this.files.dispose();
  }
}

/** "probe.cjob" → "probe". */
function stem(name: string): string {
  return name.replace(/\.[^.]*$/, "") || "job";
}
