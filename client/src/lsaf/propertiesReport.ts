// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The Properties report of an LSAF repository item: its properties, version
// history and signatures, as a self-contained HTML page for the Positron
// Viewer. Nothing here imports `vscode`.
import { formatBytes, formatDate } from "../clinical/properties";
import {
  code,
  escape,
  renderDocument,
  summaryTable,
  table,
} from "../clinical/report/html";
import { checkoutState, isContainer } from "./items";
import type { FileSignature, FileVersion, RepositoryItem } from "./types";

export interface PropertiesReportInput {
  item: RepositoryItem;
  versions?: FileVersion[];
  signatures?: FileSignature[];
  userId?: string;
  /** href that opens a version, when the page is served with links. */
  versionLink?: (version: string) => string | undefined;
  generatedAt?: Date;
  locale?: string;
}

const yesNo = (value: boolean | undefined) =>
  value === undefined ? "" : value ? "Yes" : "No";

export function renderPropertiesReport({
  item,
  versions = [],
  signatures = [],
  userId,
  versionLink,
  generatedAt = new Date(),
  locale,
}: PropertiesReportInput): string {
  const date = (value: string | undefined) => escape(formatDate(value, locale));
  const container = isContainer(item);
  const checkout = checkoutState(item, userId);
  const rows: [string, string][] = [
    ["Name", escape(item.name)],
    ["Path", code(item.path)],
    ["Type", escape(item.typeId ?? item.schemaType)],
    ["Description", escape(item.description)],
    ["Created", `${date(item.created)} ${escape(item.createdBy ?? "")}`],
    [
      "Modified",
      `${date(item.lastModified)} ${escape(item.lastModifiedBy ?? "")}`,
    ],
    ["State", escape(item.state)],
  ];
  if (!container) {
    rows.push(
      ["Size", escape(item.size === undefined ? "" : formatBytes(item.size))],
      ["Versioned", escape(yesNo(item.versioned))],
      ["Version", escape(item.versioned ? item.version : "")],
      [
        "Checked out",
        escape(
          checkout === "none"
            ? item.checkedOut === false
              ? "No"
              : ""
            : `${checkout === "self" ? "By you" : `By ${item.checkedOutBy ?? "?"}`}${item.checkedOutDate ? `, ${formatDate(item.checkedOutDate, locale)}` : ""}`,
        ),
      ],
      ["Locked", escape(yesNo(item.locked))],
      ["Signing status", escape(item.signingStatus)],
      ["MD5 digest", code(item.digest)],
    );
    if (item.typeId === "sas:job" || item.healthStatus || item.lastRunDate) {
      rows.push(
        ["Last run", date(item.lastRunDate)],
        ["Health", escape(item.healthStatus)],
        ["Runs as owner", escape(yesNo(item.runAsOwner))],
      );
    }
  } else if (item.sharedFolderPath) {
    rows.push(["Shared from", code(item.sharedFolderPath)]);
  }

  const sections = [
    `<section><h2>Properties</h2>${summaryTable(rows)}</section>`,
  ];
  if (!container) {
    const versionRows = [...versions].reverse().map((v) => {
      const href = versionLink?.(v.version);
      const label = escape(v.version) + (v.latest ? " (latest)" : "");
      return [
        href ? `<a href="${escape(href)}">${label}</a>` : label,
        date(v.created),
        escape(v.createdBy),
        escape(v.size === undefined ? "" : formatBytes(v.size)),
        escape(yesNo(v.signed)),
        escape(v.comment),
      ];
    });
    sections.push(
      `<section><h2>Versions</h2>${table(
        ["Version", "Created", "By", "Size", "Signed", "Comment"],
        versionRows,
        item.versioned ? "No versions." : "This file is not versioned.",
      )}</section>`,
    );
    sections.push(
      `<section><h2>Signatures</h2>${table(
        ["Version", "Signed", "User", "Role", "Reason", "Comment"],
        signatures.map((s) => [
          escape(s.fileVersion),
          date(s.created),
          escape(
            s.userDisplayName ? `${s.userDisplayName} (${s.userId})` : s.userId,
          ),
          escape(s.role),
          escape(s.reason),
          escape(s.comment),
        ]),
        "No signatures.",
      )}</section>`,
    );
  }
  return renderDocument({
    title: `${item.name ?? item.path}: LSAF properties`,
    generatedLabel: "Generated",
    generatedAt,
    locale,
    body: sections.join("\n"),
  });
}
