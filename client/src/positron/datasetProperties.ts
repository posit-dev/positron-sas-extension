// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The properties of a dataset, as SAS Studio's table properties show them:
// the dataset's attributes from dictionary.tables and its columns. Shown in
// the details editor of the Data Connections pane and in the Viewer.
import { escape, renderPage } from "./htmlPage";
import type { ColumnInfo, DatasetProperties } from "./sasClient";

// No VS Code imports: this module is unit-tested without VS Code.

/** A byte count for people: `512 bytes`, `128 KB`, `1.5 MB`. */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

const count = (n: number) => n.toLocaleString("en-US");

/** An ISO 8601 time from SAS, with a space for the T. */
const time = (value: string) => value.replace("T", " ");

/** The properties of a dataset as name/value pairs; unknown ones are left out. */
export function propertyList(
  props: DatasetProperties,
): Array<{ name: string; value: string }> {
  const isView = props.memtype === "VIEW";
  const rows: Array<[string, string | undefined]> = [
    ["Name", `${props.lib}.${props.mem}`],
    ["Type", isView ? "View" : "Dataset"],
    ["Label", props.label],
    ["Rows", props.rows === undefined || props.rows < 0 ? undefined : count(props.rows)],
    [
      "Deleted rows",
      props.deletedRows ? count(props.deletedRows) : undefined,
    ],
    ["Columns", props.columns === undefined ? undefined : count(props.columns)],
    ["Row length", props.rowLength ? `${count(props.rowLength)} bytes` : undefined],
    ["File size", props.fileSize ? formatBytes(props.fileSize) : undefined],
    ["Created", props.created ? time(props.created) : undefined],
    ["Modified", props.modified ? time(props.modified) : undefined],
    ["Sorted by", props.sortedBy.length > 0 ? props.sortedBy.join(" ") : undefined],
    [
      "Compression",
      props.compression && props.compression.toUpperCase() !== "NO"
        ? props.compression
        : isView
          ? undefined
          : "None",
    ],
    ["Encoding", props.encoding],
    ["Data representation", props.dataRepresentation],
  ];
  return rows
    .filter((row): row is [string, string] => !!row[1])
    .map(([name, value]) => ({ name, value }));
}

export const COLUMN_HEADINGS = [
  "#",
  "Name",
  "Type",
  "Length",
  "Format",
  "Informat",
  "Label",
];

/** One row per column, for COLUMN_HEADINGS. */
export function columnRows(columns: ColumnInfo[]): string[][] {
  return columns.map((c, i) => [
    String(i + 1),
    c.name,
    c.type === "num" ? "Numeric" : "Character",
    c.length === undefined ? "" : String(c.length),
    c.format ?? "",
    c.informat ?? "",
    c.label ?? "",
  ]);
}

/** The columns as a fixed-width text table, for a details code section. */
export function columnsAsText(columns: ColumnInfo[]): string {
  const rows = [COLUMN_HEADINGS, ...columnRows(columns)];
  const widths = COLUMN_HEADINGS.map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  return rows
    .map((r) =>
      r
        .map((cell, i) =>
          i === 0 ? cell.padStart(widths[i]) : cell.padEnd(widths[i]),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/**
 * Whether the Data Connections details editor shows table sections: since
 * Positron 2026.11. Before, only properties and code sections.
 */
export function supportsTableSections(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) {
    return false;
  }
  const [year, month] = [Number(match[1]), Number(match[2])];
  return year > 2026 || (year === 2026 && month >= 11);
}

/** The properties and columns of a dataset, as an HTML page for the Viewer. */
export function buildPropertiesHtml(
  props: DatasetProperties,
  columns: ColumnInfo[],
  title = `${props.lib}.${props.mem}`,
): string {
  const properties = propertyList(props)
    .map(
      ({ name, value }) =>
        `<tr><th scope="row">${escape(name)}</th><td>${escape(value)}</td></tr>`,
    )
    .join("");
  const rows = columnRows(columns)
    .map(
      (row) =>
        `<tr>${row.map((cell, i) => `<td${i === 0 ? ' class="num"' : ""}>${escape(cell)}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return renderPage(
    `Properties: ${title}`,
    `<table class="props"><tbody>${properties}</tbody></table>
<h2>Columns</h2>
<div class="scroll"><table class="columns">
<thead><tr>${COLUMN_HEADINGS.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`,
    STYLE,
  );
}

const STYLE = `
table.props th, table.props td { border: 0; padding: 2px 16px 2px 0; }
table.props th { color: var(--muted); font-weight: 600; white-space: nowrap; }
table.columns td { border-bottom: 1px solid var(--line); }
td.num { text-align: right; color: var(--muted); }
`;
