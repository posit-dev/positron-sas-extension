// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The highlighted differences of a compare: the observations of
// WORK._COMPARE (BASE, COMPARE and DIF rows) as an HTML page for the Viewer,
// base and compare values paired, the values that differ in color: red for
// the base, blue for the compare (not green, which red-green color vision
// can't tell from red).
import { type CompareOptions } from "./datasetCompare";
import { escape, plural, renderPage } from "./htmlPage";

// No VS Code imports: this module is unit-tested without VS Code.

/** Rows of WORK._COMPARE read for the page: 500 observations of 3 rows. */
export const HIGHLIGHT_MAX_ROWS = 1500;

export interface CompareColumn {
  name: string;
  /** "num" or "char". */
  type: string;
}

/** One observation: its base and compare values, and their differences. */
export interface DiffGroup {
  /** The ID values, or the observation number without ID variables. */
  key: string[];
  base?: string[];
  compare?: string[];
  dif?: string[];
}

/**
 * Split a row as SasClient.getDatasetRows returns it (`|a|b|c`, formatted
 * values). Undefined when the number of values is wrong, as when a value
 * contains `|`.
 */
export function splitRow(row: string, columns: number): string[] | undefined {
  const cells = row.split("|").slice(1);
  return cells.length === columns ? cells.map((c) => c.trimEnd()) : undefined;
}

function indexOf(columns: CompareColumn[], name: string): number {
  return columns.findIndex((c) => c.name.toUpperCase() === name.toUpperCase());
}

/** The columns of WORK._COMPARE that hold the key of an observation. */
function keyColumns(columns: CompareColumn[], idVars: string[]): number[] {
  const names = idVars.length > 0 ? idVars : ["_OBS_"];
  return names.map((n) => indexOf(columns, n)).filter((i) => i >= 0);
}

/**
 * Pair the rows of WORK._COMPARE by observation. PROC COMPARE writes the
 * BASE, COMPARE and DIF rows of an observation one after the other, and
 * only a BASE or a COMPARE row for an observation that one dataset has.
 */
export function pairCompareRows(
  columns: CompareColumn[],
  rows: string[][],
  idVars: string[],
): DiffGroup[] {
  const typeIndex = indexOf(columns, "_TYPE_");
  const keys = keyColumns(columns, idVars);
  const groups: DiffGroup[] = [];
  for (const cells of rows) {
    const type = (cells[typeIndex] ?? "").trim().toUpperCase();
    const key = keys.map((i) => cells[i].trim());
    const last = groups[groups.length - 1];
    const sameKey =
      last !== undefined && last.key.join("\u0000") === key.join("\u0000");
    if (type === "BASE") {
      groups.push({ key, base: cells });
    } else if (type === "COMPARE") {
      if (sameKey && last.base && !last.compare) {
        last.compare = cells;
      } else {
        groups.push({ key, compare: cells });
      }
    } else if (type === "DIF" && sameKey) {
      last.dif = cells;
    }
  }
  return groups;
}

/**
 * Whether a value differs, as PROC COMPARE judges it. A numeric DIF is the
 * difference, so within the tolerance the values are equal. A character DIF
 * marks each differing character with an X. Formatted DIF values that are no
 * number, such as dates, fall back to comparing the values themselves.
 */
export function valueDiffers(
  type: string,
  base: string,
  compare: string,
  dif: string | undefined,
  tolerance = 0,
): boolean {
  const difText = (dif ?? "").trim();
  if (type === "num") {
    const difference = Number(difText.replace(/,/g, ""));
    if (difText !== "" && Number.isFinite(difference)) {
      return Math.abs(difference) > tolerance;
    }
    return base.trim() !== compare.trim();
  }
  return difText.includes("X") || base.trimEnd() !== compare.trimEnd();
}

/** The value columns that differ in an observation. */
export function differingColumns(
  group: DiffGroup,
  columns: CompareColumn[],
  valueColumns: number[],
  tolerance?: number,
): Set<number> {
  const result = new Set<number>();
  const { base, compare, dif } = group;
  if (!base || !compare) {
    return result;
  }
  for (const i of valueColumns) {
    if (valueDiffers(columns[i].type, base[i], compare[i], dif?.[i], tolerance)) {
      result.add(i);
    }
  }
  return result;
}

export interface HighlightInput {
  options: CompareOptions;
  /** The columns of WORK._COMPARE. */
  columns: CompareColumn[];
  /** Rows as SasClient.getDatasetRows returns them. */
  rows: string[];
  /** All rows of WORK._COMPARE, of which `rows` are the first. */
  totalRows: number;
}

/** The highlighted differences of a compare, as a complete HTML page. */
export function buildHighlightHtml({
  options,
  columns,
  rows,
  totalRows,
}: HighlightInput): string {
  const { base, compare, idVars, tolerance } = options;
  const parsed = rows.map((r) => splitRow(r, columns.length));
  const unreadable = parsed.filter((r) => r === undefined).length;
  let groups = pairCompareRows(
    columns,
    parsed.filter((r): r is string[] => r !== undefined),
    idVars,
  );
  const truncated = rows.length < totalRows;
  const last = groups[groups.length - 1];
  if (truncated && last?.base && !last.dif) {
    // The last observation may be cut off before its COMPARE or DIF row.
    groups = groups.slice(0, -1);
  }

  const keys = keyColumns(columns, idVars);
  const hidden = new Set([indexOf(columns, "_TYPE_"), indexOf(columns, "_OBS_"), ...keys]);
  const valueColumns = columns.map((_, i) => i).filter((i) => !hidden.has(i));
  const differing = groups.map((g) =>
    differingColumns(g, columns, valueColumns, tolerance),
  );
  // Per variable, the observations in which it differs.
  const counts = new Map<number, number>();
  differing.forEach((set) =>
    set.forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1)),
  );
  const shown = valueColumns.filter((i) => counts.has(i));
  const paired = groups.filter((g) => g.base && g.compare).length;
  const onlyBase = groups.filter((g) => g.base && !g.compare).length;
  const onlyCompare = groups.filter((g) => !g.base && g.compare).length;

  const title = `Differences: ${base.label} vs ${compare.label}`;
  const keyHeaders =
    idVars.length > 0 ? keys.map((i) => columns[i].name) : ["Obs"];

  const summary = [
    paired > 0 ? `${plural(paired, "observation")} with unequal values` : "",
    onlyBase > 0 ? `${plural(onlyBase, "observation")} only in ${base.label}` : "",
    onlyCompare > 0
      ? `${plural(onlyCompare, "observation")} only in ${compare.label}`
      : "",
  ].filter(Boolean);
  const variables = shown
    .map(
      (i) =>
        `<li><code>${escape(columns[i].name)}</code>: ${plural(counts.get(i) ?? 0, "observation")}</li>`,
    )
    .join("");

  const notes: string[] = [];
  notes.push(
    idVars.length > 0
      ? `Observations are matched by ${idVars.map((v) => `<code>${escape(v)}</code>`).join(", ")}.`
      : "Observations are matched by position.",
  );
  if (tolerance !== undefined && tolerance > 0) {
    notes.push(
      `Numeric values that differ by at most ${escape(String(tolerance))} count as equal.`,
    );
  }
  notes.push("Only the variables that differ are shown; values are formatted.");
  if (truncated) {
    notes.push(
      `This page shows the first ${plural(rows.length, "row")} of the ${plural(totalRows, "row")} of <code>WORK._COMPARE</code>. Open Differences to see all of them.`,
    );
  }
  if (unreadable > 0) {
    notes.push(
      `${plural(unreadable, "row")} of <code>WORK._COMPARE</code> could not be read, because a value contains <code>|</code>. Open Differences to see them.`,
    );
  }

  const cell = (value: string, cls = "") =>
    `<td${cls ? ` class="${cls}"` : ""}>${escape(value)}</td>`;
  const body = groups
    .map((group, g) => {
      const keyCells = (span: number) =>
        group.key
          .map((k) => `<th scope="rowgroup"${span > 1 ? ` rowspan="${span}"` : ""}>${escape(k)}</th>`)
          .join("");
      if (group.base && group.compare) {
        const set = differing[g];
        const row = (values: string[], side: "base" | "compare", label: string) =>
          `<td class="side">${escape(label)}</td>${shown
            .map((i) => cell(values[i], set.has(i) ? `changed ${side}` : ""))
            .join("")}`;
        return `<tbody><tr>${keyCells(2)}${row(group.base, "base", base.label)}</tr><tr>${row(group.compare, "compare", compare.label)}</tr></tbody>`;
      }
      const values = group.base ?? group.compare ?? [];
      const side = group.base ? "base" : "compare";
      const label = group.base ? base.label : compare.label;
      return `<tbody><tr class="only ${side}">${keyCells(1)}<td class="side">Only in ${escape(label)}</td>${shown
        .map((i) => cell(values[i]))
        .join("")}</tr></tbody>`;
    })
    .join("\n");

  const table =
    groups.length === 0
      ? `<p class="muted">No differing observations.</p>`
      : `<div class="scroll"><table>
<thead><tr>${keyHeaders.map((h) => `<th>${escape(h)}</th>`).join("")}<th>Dataset</th>${shown
          .map((i) => `<th>${escape(columns[i].name)}</th>`)
          .join("")}</tr></thead>
${body}
</table></div>`;

  return renderPage(
    title,
    `<p class="legend"><span class="swatch base"></span>${escape(base.label)} (base) <span class="swatch compare"></span>${escape(compare.label)} (compare)</p>
${summary.length > 0 ? `<p>${summary.join("; ")}.</p>` : ""}
${variables ? `<ul class="vars">${variables}</ul>` : ""}
<p class="muted">${notes.join(" ")}</p>
${table}`,
    STYLE,
  );
}

const STYLE = `
:root {
  --base-bg: #ffcecb; --base-fg: #82071e; --compare-bg: #b6e3ff; --compare-fg: #0a3069;
}
@media (prefers-color-scheme: dark) {
  :root { --base-bg: #8e1519; --base-fg: #ffebe9; --compare-bg: #0c4a8f; --compare-fg: #ddf4ff; }
}
.legend { margin: 0 0 8px; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -1px; margin: 0 4px 0 12px; }
.swatch:first-child { margin-left: 0; }
.swatch.base { background: var(--base-bg); border: 1px solid var(--base-fg); }
.swatch.compare { background: var(--compare-bg); border: 1px solid var(--compare-fg); }
.vars { margin: 0 0 8px; padding-left: 20px; columns: 3 14em; }
th, td { white-space: pre; }
tbody { border-bottom: 1px solid var(--line); }
tbody th { font-weight: 600; vertical-align: top; }
td.side { color: var(--muted); }
td.changed { font-weight: 600; }
td.changed.base { background: var(--base-bg); color: var(--base-fg); }
td.changed.compare { background: var(--compare-bg); color: var(--compare-fg); }
tr.only.base td { background: var(--base-bg); color: var(--base-fg); }
tr.only.compare td { background: var(--compare-bg); color: var(--compare-fg); }
`;
