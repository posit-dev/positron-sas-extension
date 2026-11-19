// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Finds the executable `{sas}` chunks in a Quarto document, so they can be
 * run one at a time in the SAS console. Kept free of `vscode` imports so it
 * can be unit tested.
 */

export interface SasChunk {
  /** Line of the opening fence (```{sas}). */
  fenceLine: number;
  /** Line of the closing fence, or the last line if the chunk is unclosed. */
  endLine: number;
  /** The SAS code, without leading `*|` chunk-option lines. */
  code: string;
}

const OPEN_FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
// {sas}, {sas, echo=FALSE}, {sas label}. Not {.sas} or a plain "sas" block,
// which Quarto only displays.
const SAS_ENGINE = /^\s*\{sas(?=[\s,}])[^}]*\}\s*$/;
// sasquatch/knitr chunk options, e.g. "*| label: setup;"
const CHUNK_OPTION = /^\s*\*\|/;

export function findSasChunks(text: string): SasChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: SasChunk[] = [];

  let line = 0;
  while (line < lines.length) {
    const open = OPEN_FENCE.exec(lines[line]);
    if (!open) {
      line++;
      continue;
    }

    const fence = open[1];
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    let end = line + 1;
    while (end < lines.length && !close.test(lines[end])) {
      end++;
    }
    const endLine = Math.min(end, lines.length - 1);

    if (fence[0] === "`" && SAS_ENGINE.test(open[2])) {
      const body = lines.slice(line + 1, end);
      let first = 0;
      while (first < body.length && CHUNK_OPTION.test(body[first])) {
        first++;
      }
      chunks.push({
        fenceLine: line,
        endLine,
        code: body.slice(first).join("\n"),
      });
    }
    line = end + 1;
  }

  return chunks;
}

/** Index of the chunk containing the line, fences included, or -1. */
export function chunkIndexAtLine(chunks: SasChunk[], line: number): number {
  return chunks.findIndex(
    (chunk) => chunk.fenceLine <= line && line <= chunk.endLine,
  );
}

/** Chunks that end before the line, as Quarto's Run Above does. */
export function chunksAbove(chunks: SasChunk[], line: number): SasChunk[] {
  return chunks.filter((chunk) => chunk.endLine < line);
}

/** Chunks that start after the line, as Quarto's Run Cells Below does. */
export function chunksBelow(chunks: SasChunk[], line: number): SasChunk[] {
  return chunks.filter((chunk) => chunk.fenceLine > line);
}
