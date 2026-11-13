// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Show Clinical Acceleration reports in the Positron Viewer (a webview
// outside Positron) and save them to files. Reports are URL or file
// previews, which Posit Assistant can read in the Viewer. The report
// server's pages have links that open Clinical Acceleration files; the file
// fallback has none.
import {
  Disposable,
  LogOutputChannel,
  Uri,
  ViewColumn,
  commands,
  window,
  workspace,
} from "vscode";

import { OutputFiles } from "../../positron/outputFiles";
import { showHtmlInViewer, showUrlInViewer } from "../../positron/viewer";
import { ViewerServer } from "../../positron/viewerServer";
import { CLINICAL_SCHEME, VERSION_SCHEME, WORKSPACE_SCHEME } from "../const";

/** The file systems a report link may open: the Clinical Acceleration ones. */
const LINK_SCHEMES = new Set([
  CLINICAL_SCHEME,
  WORKSPACE_SCHEME,
  VERSION_SCHEME,
]);

export interface Report {
  /** The page; with links (see `ReportPresenter.linkTo`) when `links` is set. */
  render(links: boolean): string;
  /** Title of the Viewer or webview tab. */
  title: string;
  /** Base of file names and of the page's path on the report server. */
  name: string;
}

export interface SaveOptions {
  title: string;
  /** File name without extension; the first filter's extension is added. */
  defaultName: string;
  /** Save dialog filters, such as `{ HTML: ["html"], CSV: ["csv"] }`. */
  filters: Record<string, string[]>;
  /** The file's text for the extension the user chose (lower case). */
  content(extension: string): string;
}

export class ReportPresenter implements Disposable {
  private readonly server = new ViewerServer((target) => this.open(target));
  private readonly files = new OutputFiles(10);

  /** `viewType` identifies the fallback webviews; `kind` names logs. */
  constructor(
    private readonly output: LogOutputChannel,
    private readonly viewType: string,
    private readonly kind: string,
  ) {}

  /** The href of a link in a served report that opens `uri`. */
  static linkTo(uri: Uri): string {
    return ViewerServer.linkTo(uri.toString());
  }

  async show(report: Report): Promise<void> {
    try {
      const url = await this.server.publish(report.render(true), report.name);
      if (await showUrlInViewer(url)) {
        return;
      }
    } catch (error) {
      this.output.warn(`${this.kind} report server: ${error}`);
    }
    const html = report.render(false);
    const shown = await showHtmlInViewer(html, this.files, {
      viewType: this.viewType,
      title: report.title,
      preserveFocus: false,
      fileName: report.name,
    });
    if (!shown) {
      const panel = window.createWebviewPanel(
        this.viewType,
        report.title,
        ViewColumn.Beside,
        { enableScripts: false },
      );
      panel.webview.html = html;
    }
  }

  /**
   * Ask where to save and write the file. Resolves to the file written, or
   * undefined when cancelled; rejects when writing fails.
   */
  async save({
    title,
    defaultName,
    filters,
    content,
  }: SaveOptions): Promise<Uri | undefined> {
    const folder = workspace.workspaceFolders?.[0]?.uri;
    const first = Object.values(filters)[0]?.[0];
    const target = await window.showSaveDialog({
      title,
      defaultUri: folder
        ? Uri.joinPath(folder, first ? `${defaultName}.${first}` : defaultName)
        : undefined,
      filters,
    });
    if (!target) {
      return undefined;
    }
    const extension = target.path.split(".").pop()?.toLowerCase() ?? "";
    await workspace.fs.writeFile(
      target,
      new TextEncoder().encode(content(extension)),
    );
    return target;
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
      this.output.warn(`${this.kind} report: refused to open ${target}.`);
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

/** "probe.cjob" → "probe"; `fallback` for a name that is all extension. */
export function stem(name: string, fallback: string): string {
  return name.replace(/\.[^.]*$/, "") || fallback;
}
