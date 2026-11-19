// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// What a background job or a saved SAS job runs, taken from the editor.
import { Selection, TextDocument, Uri, window, workspace } from "vscode";

import { SASCodeDocument } from "../components/utils/SASCodeDocument";
import { getCodeDocumentConstructionParameters } from "../components/utils/SASCodeDocumentHelper";
import { isDuration } from "./utils";

const LOG_START_INDICATOR = /^\/\*\* LOG_START_INDICATOR \*\*\/\r?\n/;
const DEFAULT_KEEP_RESULTS_FOR = "P7D";

/** The document a command acts on: the one it was invoked on, or the active one. */
export async function documentFor(
  uri?: Uri,
): Promise<TextDocument | undefined> {
  if (uri instanceof Uri) {
    return (
      workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      ) ?? workspace.openTextDocument(uri)
    );
  }
  return window.activeTextEditor?.document;
}

/** The non-empty selections of the document's editor, if it is visible. */
export function selectionsOf(document: TextDocument): Selection[] {
  const editor = window.visibleTextEditors.find((e) => e.document === document);
  return (editor?.selections ?? []).filter((s) => !s.isEmpty);
}

/**
 * The code to run: the program or the selection, with the same language
 * wrapping and _SASPROGRAMFILE as an interactive run, but without the ODS
 * HTML wrapper. Its `ods _all_ close;` leaves a job with no results at all,
 * and the Compute provider does not upload ODS HTML from a job anyway.
 */
export function codeFor(
  document: TextDocument,
  selections: readonly Selection[],
): string {
  const parameters = getCodeDocumentConstructionParameters(document, {
    selections,
  });
  const wrapped = new SASCodeDocument({
    ...parameters,
    outputHtml: false,
    uuid: undefined,
  }).getWrappedCode();
  return wrapped.replace(LOG_START_INDICATOR, "");
}

/** How long the server keeps a finished job (SAS.backgroundJobs.keepResultsFor). */
export function keepResultsFor(): string {
  const value = workspace
    .getConfiguration("SAS.backgroundJobs")
    .get<string>("keepResultsFor", DEFAULT_KEEP_RESULTS_FOR)
    .trim();
  return isDuration(value) ? value : DEFAULT_KEEP_RESULTS_FOR;
}
