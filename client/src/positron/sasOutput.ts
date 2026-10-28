// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Helpers that turn SAS ODS HTML5 output into what Posit Assistant can read
 * (#74): PNG plots for the Plots pane, and a plain-text copy of the tables.
 * Kept free of `vscode` imports so they can be unit tested.
 */

const PNG_IMG =
  /<img\b[^>]*?\bsrc\s*=\s*["']data:image\/png;base64,([A-Za-z0-9+/=\s]+)["']/gi;

/** Base64 data of the inline PNG images in `html`, in document order. */
export function extractPngImages(html: string): string[] {
  return Array.from(html.matchAll(PNG_IMG), (m) => m[1].replace(/\s+/g, ""));
}

/** Pixel size of a base64 PNG, read from its IHDR chunk. */
export function pngSize(
  base64: string,
): { width: number; height: number } | undefined {
  const bytes = Buffer.from(base64.slice(0, 64), "base64");
  // Signature (8 bytes), IHDR length and type (8 bytes), width, height.
  if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") {
    return undefined;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] === "#") {
      const code =
        name[1].toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Text of HTML outside <pre>, where source whitespace means nothing. */
function flowToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\s+/g, " ")
      .replace(/<\/t[dh]\s*>/gi, "\t")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/?(tr|p|div|h[1-6]|table|caption|li|ul|ol|section|article)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((cell) => cell.trim())
        .join("\t")
        .replace(/\t+$/, ""),
    )
    .join("\n");
}

/** Text of a <pre> block, keeping its layout. */
function preToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/**
 * Plain text of SAS HTML output: titles and paragraphs on their own lines,
 * table rows as tab-separated cells, <pre> blocks (listing output) as is.
 * Images, SVG, styles and scripts are dropped. Text longer than `maxChars`
 * is cut off with a note.
 */
export function htmlToText(html: string, maxChars = 20000): string {
  const result = html
    .replace(/<(head|style|script|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .split(/(<pre\b[\s\S]*?<\/pre\s*>)/i)
    .map((part, i) =>
      i % 2 === 1 ? `\n${preToText(part)}\n` : flowToText(part),
    )
    .join("")
    .replace(/\n[ \t]*(?=\n)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n|\s+$/g, "");
  return result.length > maxChars
    ? `${result.slice(0, maxChars)}\n… (output truncated)`
    : result;
}
