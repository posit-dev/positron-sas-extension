// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The signature history of a Clinical Acceleration file as a self-contained
// HTML page or CSV, like the Signature History window of SAS Clinical
// Acceleration Repository. No vscode import, so it is unit-tested directly.
import { formatDate, isSigningStatus } from "./properties";
import {
  code,
  escape,
  renderDocument,
  summaryTable,
  table,
  toCsv,
} from "./report/html";
import type { Signature, SigningStatus } from "./types";
import { sortSignatures } from "./utils";

export interface SignatureReportLabels {
  title: string;
  file: string;
  location: string;
  version: string;
  status: string;
  signatures: string;
  date: string;
  signedBy: string;
  userId: string;
  role: string;
  reason: string;
  comment: string;
  none: string;
  /** Shown for the history of a versioned file, as SAS's window says. */
  latestOnly: string;
  generated: string;
  statuses: Record<SigningStatus, string>;
}

/** The file (or version of a file) whose signatures are shown. */
export interface SignatureSubject {
  name: string;
  path: string;
  versioned?: boolean;
  signingStatus?: string;
  /** Set for the history of one version. */
  version?: string;
}

export interface SignatureReportOptions {
  /** For the footer; tests pass a fixed date. */
  generatedAt?: Date;
  locale?: string;
  /** The href that opens the file or version; plain text without it. */
  link?: string;
}

/** A real version number: unversioned files report none or "-". */
const versionOf = (signature: Signature): string =>
  signature.fileVersion && signature.fileVersion !== "-"
    ? signature.fileVersion
    : "";

const signer = (signature: Signature): string =>
  signature.userDisplayName || signature.userId || "";

/** Title of the report and of its Viewer tab. */
export function signatureReportTitle(
  subject: SignatureSubject,
  labels: Pick<SignatureReportLabels, "title">,
): string {
  return `${labels.title}: ${subject.name}${subject.version ? ` v${subject.version}` : ""}`;
}

/** Render a signature history as a complete HTML document. */
export function renderSignatureReport(
  subject: SignatureSubject,
  signatures: Signature[],
  labels: SignatureReportLabels,
  { generatedAt = new Date(), locale, link }: SignatureReportOptions = {},
): string {
  const sorted = sortSignatures(signatures);
  const withVersion = sorted.some((s) => versionOf(s));
  const withComment = sorted.some((s) => s.comment);
  const status = subject.signingStatus;

  const file = link
    ? `<a href="${escape(link)}">${code(subject.name)}</a>`
    : code(subject.name);
  const summary: [string, string][] = [
    [labels.file, file],
    [labels.location, code(subject.path)],
    [labels.version, escape(subject.version)],
    [
      labels.status,
      // Only for the whole file: a version's own status isn't reported.
      subject.version
        ? ""
        : escape(isSigningStatus(status) ? labels.statuses[status] : status),
    ],
  ];

  const headers = [
    labels.date,
    labels.signedBy,
    labels.role,
    labels.reason,
    ...(withVersion ? [labels.version] : []),
    ...(withComment ? [labels.comment] : []),
  ];
  const rows = sorted.map((s) => [
    escape(formatDate(s.creationTimeStamp, locale)),
    `${escape(signer(s))}${s.userDisplayName && s.userId ? ` <span class="muted">${code(s.userId)}</span>` : ""}`,
    escape(s.role),
    escape(s.reason),
    ...(withVersion ? [escape(versionOf(s))] : []),
    ...(withComment ? [escape(s.comment)] : []),
  ]);

  // SAS lists the latest version's signatures for a versioned file; say so,
  // unless the list itself spans several versions.
  const versions = new Set(sorted.map(versionOf).filter(Boolean));
  const note =
    subject.versioned && !subject.version && versions.size <= 1
      ? `<p class="muted">${escape(labels.latestOnly)}</p>`
      : "";
  return renderDocument({
    title: signatureReportTitle(subject, labels),
    generatedLabel: labels.generated,
    generatedAt,
    locale,
    body: [
      summaryTable(summary),
      `<h2>${escape(labels.signatures)}</h2>${note}${table(headers, rows, labels.none)}`,
    ].join("\n"),
  });
}

/** The signatures as CSV, newest first, with ISO 8601 dates. */
export function signaturesCsv(
  signatures: Signature[],
  labels: SignatureReportLabels,
): string {
  return toCsv(
    [
      labels.date,
      labels.signedBy,
      labels.userId,
      labels.role,
      labels.reason,
      labels.version,
      labels.comment,
    ],
    sortSignatures(signatures).map((s) => [
      s.creationTimeStamp,
      signer(s),
      s.userId,
      s.role,
      s.reason,
      versionOf(s),
      s.comment,
    ]),
  );
}
