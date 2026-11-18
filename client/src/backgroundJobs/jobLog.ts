// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Read-only documents for background job logs and listings, on the
// `sasJobLog:` scheme. A log is coloured like the session log, from the line
// types SAS itself recorded in the job's JSON log, so nothing is guessed from
// the text.
//
// Job logs get their own language, `sas-joblog`. The session log's token
// provider (`sas-log`) reads a module-level array filled by the live session
// and indexed by line number, so pointing a job log at it would colour it from
// the interactive session's lines instead.
import {
  Disposable,
  DocumentSemanticTokensProvider,
  EventEmitter,
  SemanticTokensBuilder,
  TextDocument,
  TextDocumentContentProvider,
  Uri,
  languages,
  window,
  workspace,
} from "vscode";

import { legend } from "../components/logViewer";
import type { ComputeLogLine } from "./types";

export const JOB_LOG_SCHEME = "sasJobLog";
export const JOB_LOG_LANGUAGE = "sas-joblog";

interface Content {
  text: string;
  /** The SAS line type of each line, for colouring; absent for listings. */
  types?: string[];
}

export class JobLogDocuments
  implements
    TextDocumentContentProvider,
    DocumentSemanticTokensProvider,
    Disposable
{
  private readonly contents = new Map<string, Content>();
  private readonly changed = new EventEmitter<Uri>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: Disposable[];

  constructor() {
    this.disposables = [
      workspace.registerTextDocumentContentProvider(JOB_LOG_SCHEME, this),
      languages.registerDocumentSemanticTokensProvider(
        { language: JOB_LOG_LANGUAGE },
        this,
        legend,
      ),
      // Free the text once nobody has the document open.
      workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === JOB_LOG_SCHEME) {
          this.contents.delete(document.uri.toString());
        }
      }),
      this.changed,
    ];
  }

  provideTextDocumentContent(uri: Uri): string {
    return this.contents.get(uri.toString())?.text ?? "";
  }

  provideDocumentSemanticTokens(document: TextDocument) {
    const builder = new SemanticTokensBuilder(legend);
    const types = this.contents.get(document.uri.toString())?.types ?? [];
    const lines = Math.min(types.length, document.lineCount);
    for (let i = 0; i < lines; i++) {
      if (legend.tokenTypes.includes(types[i])) {
        builder.push(document.lineAt(i).range, types[i]);
      }
    }
    return builder.build();
  }

  /** Open a job's log from its structured lines, coloured by line type. */
  async showLog(jobId: string, title: string, lines: ComputeLogLine[]) {
    await this.show(
      jobId,
      `${title}.log`,
      {
        text: lines.map((l) => l.line).join("\n"),
        types: lines.map((l) => l.type),
      },
      JOB_LOG_LANGUAGE,
    );
  }

  /** Open plain text, such as the SAS listing, read-only. */
  async showText(
    jobId: string,
    fileName: string,
    text: string,
    language = "plaintext",
  ) {
    await this.show(jobId, fileName, { text }, language);
  }

  private async show(
    jobId: string,
    fileName: string,
    content: Content,
    language: string,
  ) {
    const uri = Uri.from({
      scheme: JOB_LOG_SCHEME,
      path: `/${jobId}/${safeFileName(fileName)}`,
    });
    const key = uri.toString();
    const reopened = this.contents.has(key);
    this.contents.set(key, content);
    if (reopened) {
      // Already open: tell the editor the text changed.
      this.changed.fire(uri);
    }
    let document = await workspace.openTextDocument(uri);
    if (document.languageId !== language) {
      document = await languages.setTextDocumentLanguage(document, language);
    }
    await window.showTextDocument(document, { preview: false });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.contents.clear();
  }
}

/** A file name that is safe in a URI path segment. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 120) || "job";
}
