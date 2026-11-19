// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  CodeLens,
  CodeLensProvider,
  Disposable,
  Range,
  TextDocument,
  TextEditor,
  Uri,
  commands,
  l10n,
  languages,
  window,
  workspace,
} from "vscode";

import { profileConfig } from "../commands/profile";
import { editorCodeToRun } from "./consoleDiagnostics";
import { getPositronApi } from "./index";
import {
  SasChunk,
  chunkIndexAtLine,
  chunksAbove,
  chunksBelow,
  findSasChunks,
} from "./quartoSasChunks";

/**
 * Run `{sas}` chunks of a Quarto document in the SAS console.
 *
 * The Quarto extension only runs cells for languages it knows (R, Python,
 * Julia, C#), so `{sas}` chunks get no Run Cell lens and its shortcuts do
 * nothing on them. Until Quarto runs any language that has a Positron
 * runtime, these lenses and commands fill the gap, with the labels Quarto
 * uses. Quarto's shortcuts outrank ours (Positron weighs an extension's
 * keybindings by their index in its list), so the docs give a keybindings.json
 * snippet that uses the SAS.inQuartoSasCell context key instead.
 *
 * TODO: when a Quarto release runs `{sas}` cells itself, skip the lenses for
 * that version, so the chunks don't show two Run Cell lenses.
 */

const IN_SAS_CELL = "SAS.inQuartoSasCell";

const cache = new WeakMap<
  TextDocument,
  { version: number; chunks: SasChunk[] }
>();

function chunksOf(document: TextDocument): SasChunk[] {
  const cached = cache.get(document);
  if (cached && cached.version === document.version) {
    return cached.chunks;
  }
  const chunks = findSasChunks(document.getText());
  cache.set(document, { version: document.version, chunks });
  return chunks;
}

function quartoEditor(uri?: Uri): TextEditor | undefined {
  const editor = uri
    ? window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === uri.toString(),
      )
    : window.activeTextEditor;
  return editor?.document.languageId === "quarto" ? editor : undefined;
}

async function runInSasConsole(
  document: TextDocument,
  codes: string[],
): Promise<void> {
  const api = getPositronApi();
  if (!api) {
    return;
  }
  if (profileConfig.getActiveProfile() === "") {
    // Lets the user pick a profile, or add one when there is none.
    await commands.executeCommand("SAS.switchProfile");
    if (profileConfig.getActiveProfile() === "") {
      return;
    }
  }
  for (const code of codes) {
    if (code.trim() === "") {
      continue;
    }
    await api.runtime.executeCode(
      "sas",
      code,
      true,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      document.uri,
    );
  }
}

type Target = (chunks: SasChunk[], line: number) => SasChunk[];

function runChunks(target: Target) {
  return async (uri?: Uri, line?: number) => {
    const editor = quartoEditor(uri);
    if (!editor) {
      return;
    }
    const chunks = chunksOf(editor.document);
    const at = line ?? editor.selection.active.line;
    await runInSasConsole(
      editor.document,
      target(chunks, at).map((chunk) => chunk.code),
    );
  };
}

const currentChunk: Target = (chunks, line) => {
  const index = chunkIndexAtLine(chunks, line);
  return index === -1 ? [] : [chunks[index]];
};

const nextChunk: Target = (chunks, line) =>
  chunksBelow(chunks, line).slice(0, 1);

/** Cmd+Enter: the selection when there is one, otherwise the whole chunk. */
async function runCurrent(): Promise<void> {
  const editor = quartoEditor();
  if (!editor) {
    return;
  }
  const document = editor.document;
  const selected = editor.selections.map((s) => document.getText(s));
  const chunk = currentChunk(chunksOf(document), editor.selection.active.line);
  if (chunk.length === 0) {
    return;
  }
  await runInSasConsole(document, [editorCodeToRun(chunk[0].code, selected)]);
}

class SasChunkCodeLensProvider implements CodeLensProvider {
  provideCodeLenses(document: TextDocument): CodeLens[] {
    const chunks = chunksOf(document);
    const lenses: CodeLens[] = [];
    chunks.forEach((chunk, index) => {
      const range = new Range(chunk.fenceLine, 0, chunk.fenceLine, 0);
      const args = [document.uri, chunk.fenceLine];
      lenses.push(
        new CodeLens(range, {
          title: l10n.t("Run Cell"),
          tooltip: l10n.t("Run this SAS cell in the SAS console"),
          command: "SAS.quarto.runCell",
          arguments: args,
        }),
      );
      if (index < chunks.length - 1) {
        lenses.push(
          new CodeLens(range, {
            title: l10n.t("Run Next Cell"),
            tooltip: l10n.t("Run the next SAS cell in the SAS console"),
            command: "SAS.quarto.runNextCell",
            arguments: [document.uri, chunk.endLine],
          }),
        );
      }
      if (index > 0) {
        lenses.push(
          new CodeLens(range, {
            title: l10n.t("Run Above"),
            tooltip: l10n.t(
              "Run the SAS cells above this one in the SAS console",
            ),
            command: "SAS.quarto.runCellsAbove",
            arguments: args,
          }),
        );
      }
    });
    return lenses;
  }
}

function updateContextKey(editor: TextEditor | undefined): void {
  const inCell =
    editor?.document.languageId === "quarto" &&
    chunkIndexAtLine(
      chunksOf(editor.document),
      editor.selection.active.line,
    ) !== -1;
  void commands.executeCommand("setContext", IN_SAS_CELL, inCell);
}

export function registerQuartoSasCells(): Disposable {
  updateContextKey(window.activeTextEditor);
  return Disposable.from(
    languages.registerCodeLensProvider(
      { language: "quarto" },
      new SasChunkCodeLensProvider(),
    ),
    commands.registerCommand("SAS.quarto.runCell", runChunks(currentChunk)),
    commands.registerCommand("SAS.quarto.runNextCell", runChunks(nextChunk)),
    commands.registerCommand(
      "SAS.quarto.runCellsAbove",
      runChunks(chunksAbove),
    ),
    commands.registerCommand(
      "SAS.quarto.runCellsBelow",
      runChunks(chunksBelow),
    ),
    commands.registerCommand("SAS.quarto.runCurrent", runCurrent),
    window.onDidChangeActiveTextEditor(updateContextKey),
    window.onDidChangeTextEditorSelection((e) =>
      updateContextKey(e.textEditor),
    ),
    workspace.onDidChangeTextDocument((e) => {
      if (e.document === window.activeTextEditor?.document) {
        updateContextKey(window.activeTextEditor);
      }
    }),
  );
}
