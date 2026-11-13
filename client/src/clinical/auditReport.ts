// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The audit history of SAS Clinical Acceleration Repository as a
// self-contained HTML page or CSV, like its Audit History page. No vscode
// import, so it is unit-tested directly.
import { formatDate } from "./properties";
import {
  code,
  escape,
  renderDocument,
  summaryTable,
  table,
  toCsv,
} from "./report/html";
import type { AuditDetail, AuditEntry } from "./types";

export interface AuditReportLabels {
  title: string;
  query: string;
  entries: string;
  date: string;
  user: string;
  action: string;
  object: string;
  name: string;
  location: string;
  mode: string;
  details: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  none: string;
  generated: string;
  /** "{shown} of {total} entries, newest first". */
  count: string;
  /** Shown when the list was cut at the maximum. */
  truncated: string;
  /** Only the first entries have their details read. */
  detailsLimited: string;
  /** Users see their own actions; administrators everyone's. */
  scope: string;
  modes: Record<string, string>;
  objectTypes: Record<string, string>;
}

/** The conditions the entries were searched with, already readable. */
export type QueryRows = [string, string][];

export interface AuditReportOptions {
  generatedAt?: Date;
  locale?: string;
  /** The total the server reported, when it is more than listed. */
  total?: number;
  /** How many entries had their details read (the first ones). */
  detailsRead?: number;
  /** The href that opens an entry's item, if it can be opened. */
  linkFor?: (entry: AuditEntry) => string | undefined;
}

const fill = (template: string, values: Record<string, unknown>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );

const who = (entry: AuditEntry): string =>
  entry.userDisplayName || entry.userId || "";

/** "Attribute: old → new", one line per changed attribute. */
export function describeDetail(detail: AuditDetail): string {
  const name = detail.attributeName || detail.attributeId || "";
  const change =
    detail.oldValue !== undefined && detail.oldValue !== ""
      ? `${detail.oldValue} → ${detail.newValue ?? ""}`
      : (detail.newValue ?? "");
  return name ? `${name}: ${change}` : change;
}

const modeText = (entry: AuditEntry, labels: AuditReportLabels): string =>
  (entry.mode && labels.modes[entry.mode]) || entry.mode || "";

const typeText = (entry: AuditEntry, labels: AuditReportLabels): string =>
  (entry.sourcePrimaryType && labels.objectTypes[entry.sourcePrimaryType]) ||
  entry.sourcePrimaryType ||
  "";

/** Title of the report and of its Viewer tab. */
export function auditReportTitle(
  labels: Pick<AuditReportLabels, "title">,
  subject?: string,
): string {
  return subject ? `${labels.title}: ${subject}` : labels.title;
}

/** Render audit entries, newest first as listed, as an HTML document. */
export function renderAuditReport(
  entries: AuditEntry[],
  query: QueryRows,
  labels: AuditReportLabels,
  {
    generatedAt = new Date(),
    locale,
    total,
    detailsRead,
    linkFor,
  }: AuditReportOptions = {},
  subject?: string,
): string {
  const name = (entry: AuditEntry) => {
    const href = linkFor?.(entry);
    const text = code(entry.sourceName);
    return href ? `<a href="${escape(href)}">${text}</a>` : text;
  };
  const details = (entry: AuditEntry) =>
    (entry.auditEntryDetails ?? [])
      .map((d) => escape(describeDetail(d)))
      .join("<br>");
  const withDetails = entries.some((e) => e.auditEntryDetails?.length);

  const headers = [
    labels.date,
    labels.user,
    labels.action,
    labels.object,
    labels.name,
    labels.location,
    labels.mode,
    ...(withDetails ? [labels.details] : []),
  ];
  const rows = entries.map((e) => [
    escape(formatDate(e.timestamp, locale)),
    escape(who(e)),
    escape(e.actionDisplayName || e.action),
    `${escape(typeText(e, labels))}${e.sourceTypeId ? ` <span class="muted">${escape(e.sourceTypeId)}</span>` : ""}`,
    name(e),
    code(e.sourceLocation),
    escape(modeText(e, labels)),
    ...(withDetails ? [details(e)] : []),
  ]);

  const notes = [
    escape(
      fill(labels.count, {
        shown: entries.length,
        total: Math.max(total ?? 0, entries.length),
      }),
    ),
    total !== undefined && total > entries.length
      ? escape(labels.truncated)
      : "",
    detailsRead !== undefined && detailsRead < entries.length
      ? escape(fill(labels.detailsLimited, { count: detailsRead }))
      : "",
    escape(labels.scope),
  ].filter(Boolean);

  return renderDocument({
    title: auditReportTitle(labels, subject),
    generatedLabel: labels.generated,
    generatedAt,
    locale,
    body: [
      query.length
        ? `<h2>${escape(labels.query)}</h2>${summaryTable(query)}`
        : "",
      `<h2>${escape(labels.entries)}</h2><p class="muted">${notes.join("<br>")}</p>${table(headers, rows, labels.none)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

/** The entries as CSV, with ISO 8601 dates and one row per entry. */
export function auditCsv(
  entries: AuditEntry[],
  labels: AuditReportLabels,
): string {
  return toCsv(
    [
      labels.date,
      labels.user,
      labels.action,
      labels.object,
      labels.name,
      labels.location,
      labels.mode,
      labels.details,
    ],
    entries.map((e) => [
      e.timestamp,
      e.userId,
      e.action,
      e.sourcePrimaryType,
      e.sourceName,
      e.sourceLocation,
      e.mode,
      (e.auditEntryDetails ?? []).map(describeDetail).join("; "),
    ]),
  );
}
