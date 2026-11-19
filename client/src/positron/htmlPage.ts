// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Self-contained HTML pages for the Viewer (highlighted differences, dataset
// properties): inline CSS that follows the light or dark theme, no scripts.

// No VS Code imports: the pages are unit-tested without VS Code.

export const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A count with its noun, e.g. `1 observation`, `1,500 rows`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const BASE_STYLE = `
:root {
  color-scheme: light dark;
  --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --line: #d1d9e0; --head: #f6f8fa;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --line: #3d444d; --head: #151b23; }
}
body { font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 16px 24px 32px; }
h1 { font-size: 18px; margin: 0 0 8px; }
h2 { font-size: 15px; margin: 24px 0 8px; }
.muted { color: var(--muted); }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 3px 8px; border-right: 1px solid var(--line); }
thead th { background: var(--head); font-weight: 600; position: sticky; top: 0; border-bottom: 1px solid var(--line); }
`;

/** A complete HTML page; `body` is already escaped, `style` adds to the base. */
export function renderPage(title: string, body: string, style = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Positron SAS extension">
<title>${escape(title)}</title>
<style>${BASE_STYLE}${style}</style>
</head>
<body>
<h1>${escape(title)}</h1>
${body}
</body>
</html>
`;
}
