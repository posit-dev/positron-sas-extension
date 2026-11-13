// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Building blocks of the Clinical Acceleration HTML reports (job manifests,
// signature history): self-contained pages with inline CSS and no scripts,
// for the Viewer, exports and printing. No vscode import, so the reports are
// unit-tested directly.
import { formatDate } from "../properties";

export const escape = (text: unknown): string =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const code = (text: string | undefined): string =>
  text ? `<code>${escape(text)}</code>` : "";

/** A table of already escaped cells; `empty` when there are no rows. */
export function table(
  headers: string[],
  rows: unknown[][],
  empty: string,
): string {
  if (!rows.length) {
    return `<p class="empty">${escape(empty)}</p>`;
  }
  return `<table><thead><tr>${headers
    .map((h) => `<th>${escape(h)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell, i) => `<td${i === 0 ? ' class="key"' : ""}>${cell}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}

/** Label/value rows (values already escaped); rows without text are left out. */
export function summaryTable(rows: [string, string][]): string {
  return `<table class="summary"><tbody>${rows
    .filter(([, value]) => value.replace(/<[^>]*>/g, "").trim())
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escape(key)}</th><td>${value}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

export interface DocumentOptions {
  title: string;
  /** "Generated", followed by the date. */
  generatedLabel: string;
  generatedAt: Date;
  locale?: string;
  /** The sections, already rendered. */
  body: string;
}

/** A complete HTML document around report sections. */
export function renderDocument({
  title,
  generatedLabel,
  generatedAt,
  locale,
  body,
}: DocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Positron SAS extension">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escape(title)}</h1>
<p class="muted">${escape(generatedLabel)} ${escape(formatDate(generatedAt.toISOString(), locale))}</p>
</header>
${body}
</body>
</html>
`;
}

/** One CSV field, quoted when needed (RFC 4180). */
export function csvField(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text with a header row, CRLF line ends as spreadsheets expect. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return `${[headers, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export const STYLE = `
:root {
  color-scheme: light dark;
  --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --line: #d1d9e0;
  --head: #f6f8fa; --ok: #1a7f37; --warn: #9a6700; --err: #cf222e; --cancel: #59636e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --line: #3d444d;
    --head: #151b23; --ok: #3fb950; --warn: #d29922; --err: #f85149; --cancel: #9198a1;
  }
}
body { font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 16px 24px 32px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
h3 { font-size: 14px; margin: 16px 0 6px; }
.muted, .empty { color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--line); }
thead th { background: var(--head); font-weight: 600; }
table.summary th { width: 12em; font-weight: 600; color: var(--muted); }
a { color: inherit; text-decoration: underline dotted; text-underline-offset: 2px; }
a:hover { text-decoration-style: solid; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
.badge { display: inline-block; padding: 0 8px; border-radius: 10px; border: 1px solid currentColor; font-size: 12px; white-space: nowrap; }
.badge.success { color: var(--ok); } .badge.warning { color: var(--warn); }
.badge.error { color: var(--err); } .badge.canceled, .badge.running { color: var(--cancel); }
@media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
`;
