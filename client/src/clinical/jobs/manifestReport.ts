// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The manifest of a clinical job run as a self-contained HTML page: the audit
// record of the run, to read in the Viewer, export, or hand to QC. No vscode
// import, so it is unit-tested directly.
import { formatBytes, formatDate } from "../properties";
import { describeValue } from "./manifestTree";
import { humanizeState, outcomeOf } from "./state";
import type {
  CheckinFailure,
  JobResource,
  Manifest,
  ManifestExternalReference,
  ManifestFile,
  TransferMetric,
} from "./types";

export interface ReportLabels {
  title: string;
  summary: string;
  job: string;
  description: string;
  state: string;
  info: string;
  runId: string;
  runContext: string;
  submitted: string;
  completed: string;
  runAs: string;
  owner: string;
  totalTime: string;
  manifestFile: string;
  parameters: string;
  programs: string;
  inputs: string;
  externalInputs: string;
  outputs: string;
  externalOutputs: string;
  logs: string;
  results: string;
  checkin: string;
  checkinFailures: string;
  metrics: string;
  name: string;
  label: string;
  type: string;
  value: string;
  path: string;
  version: string;
  size: string;
  modified: string;
  md5: string;
  usedBy: string;
  location: string;
  executionState: string;
  executionTime: string;
  item: string;
  message: string;
  versioning: string;
  versionNewFiles: string;
  checkinLocations: string;
  files: string;
  time: string;
  yes: string;
  no: string;
  none: string;
  generated: string;
}

export interface ReportOptions {
  /** From the submission: the manifest does not list them. */
  checkinFailures?: CheckinFailure[];
  /** For the footer; tests pass a fixed date. */
  generatedAt?: Date;
  locale?: string;
  /**
   * The href that opens a file of the run, if any. Without it (exports) the
   * paths are plain text.
   */
  linkFor?: (resource: JobResource) => string | undefined;
}

const escape = (text: unknown): string =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const version = (file: ManifestFile): string =>
  file.resource.fileVersion && file.resource.fileVersion !== "-"
    ? file.resource.fileVersion
    : "";

const seconds = (ms: number | undefined): string =>
  ms === undefined ? "" : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;

function table(headers: string[], rows: unknown[][], empty: string): string {
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

const code = (text: string | undefined): string =>
  text ? `<code>${escape(text)}</code>` : "";

/** Render a manifest as a complete HTML document. */
export function renderManifestReport(
  manifest: Manifest,
  labels: ReportLabels,
  {
    checkinFailures = [],
    generatedAt = new Date(),
    locale,
    linkFor,
  }: ReportOptions = {},
): string {
  // A file path, as a link that opens the file when the report has links.
  const file = (resource: JobResource | undefined): string => {
    const href = resource && linkFor?.(resource);
    return href
      ? `<a href="${escape(href)}">${code(resource.path)}</a>`
      : code(resource?.path);
  };
  const run = manifest.jobSubmission ?? {};
  const job = manifest.job;
  const jobName = job?.resource.name ?? "";
  const state = run.state ?? "";
  const outcome = outcomeOf(state);
  const date = (value: string | undefined) => escape(formatDate(value, locale));
  const who = (name?: string, display?: string) =>
    escape(display || name || "");

  const fileRows = (files: ManifestFile[] | undefined, withUser: boolean) =>
    (files ?? []).map((f) => [
      file(f.resource),
      escape(version(f)),
      escape(f.size !== undefined ? formatBytes(f.size, 1) : ""),
      date(f.lastModifiedTimeStamp),
      code(f.digest),
      ...(withUser ? [code(f.referencingProgram)] : []),
    ]);
  const fileHeaders = (withUser: boolean) => [
    labels.path,
    labels.version,
    labels.size,
    labels.modified,
    labels.md5,
    ...(withUser ? [labels.usedBy] : []),
  ];
  const externalRows = (refs: ManifestExternalReference[] | undefined) =>
    (refs ?? []).map((r) => [
      escape(r.name),
      code(r.location),
      code(r.referencingProgram),
    ]);
  const externalHeaders = [labels.name, labels.location, labels.usedBy];

  // Logs and listings are outputs too; list them once, in their own sections.
  const system = new Set(
    [...(manifest.logs ?? []), ...(manifest.results ?? [])].map(
      (f) => f.resource.path,
    ),
  );
  const outputs = (manifest.outputs ?? []).filter(
    (f) => !system.has(f.resource.path),
  );

  const summary: [string, string][] = [
    [
      labels.job,
      `${file(job?.resource)} <span class="muted">${escape(
        (job?.resource.resourceLocation ?? manifest.type ?? "").toLowerCase(),
      )}${job && version(job) ? ` · v${escape(version(job))}` : ""}</span>`,
    ],
    [labels.description, escape(job?.description)],
    [
      labels.state,
      `<span class="badge ${outcome}">${escape(humanizeState(state))}</span>`,
    ],
    [labels.info, escape(run.info)],
    [labels.runId, code(run.id)],
    [labels.runContext, escape(humanizeState(run.jobRunContext))],
    [
      labels.submitted,
      `${date(run.submittedTimeStamp)} · ${who(run.submittedBy, run.submittedByDisplayName)}`,
    ],
    [labels.completed, date(run.completedTimeStamp)],
    [labels.runAs, who(run.runAsUser, run.runAsUserDisplayName)],
    [
      labels.owner,
      `${who(job?.owner, job?.ownerDisplayName)}${job?.runAsOwner ? ` (${escape(labels.runAs)})` : ""}`,
    ],
    [labels.totalTime, escape(seconds(manifest.totalExecutionTime))],
    [
      labels.manifestFile,
      manifest.manifest
        ? `${file(manifest.manifest.resource)}${version(manifest.manifest) ? ` v${escape(version(manifest.manifest))}` : ""}`
        : "",
    ],
  ];

  const spec = manifest.checkinSpecification;
  const sections: string[] = [
    `<h2>${escape(labels.summary)}</h2><table class="summary"><tbody>${summary
      .filter(([, value]) => value.replace(/<[^>]*>/g, "").trim())
      .map(
        ([key, value]) =>
          `<tr><th scope="row">${escape(key)}</th><td>${value}</td></tr>`,
      )
      .join("")}</tbody></table>`,
    `<h2>${escape(labels.parameters)}</h2>${table(
      [labels.name, labels.label, labels.type, labels.value],
      (manifest.parameters ?? []).map((p) => [
        code(p.name),
        escape(p.label),
        escape(p.type),
        escape(describeValue(p)),
      ]),
      labels.none,
    )}`,
    `<h2>${escape(labels.programs)}</h2>${table(
      [
        labels.path,
        labels.version,
        labels.executionState,
        labels.executionTime,
        labels.md5,
        labels.info,
      ],
      (manifest.programs ?? []).map((p) => [
        file(p.resource),
        escape(version(p)),
        `<span class="badge ${programOutcome(p.executionState)}">${escape(humanizeState(p.executionState))}</span>`,
        escape(seconds(p.executionTime)),
        code(p.digest),
        escape(p.executionInfo),
      ]),
      labels.none,
    )}`,
    `<h2>${escape(labels.inputs)}</h2>${table(
      fileHeaders(true),
      fileRows(manifest.inputs, true),
      labels.none,
    )}`,
  ];
  if (manifest.externalInputs?.length) {
    sections.push(
      `<h3>${escape(labels.externalInputs)}</h3>${table(externalHeaders, externalRows(manifest.externalInputs), labels.none)}`,
    );
  }
  sections.push(
    `<h2>${escape(labels.outputs)}</h2>${table(fileHeaders(true), fileRows(outputs, true), labels.none)}`,
  );
  if (manifest.externalOutputs?.length) {
    sections.push(
      `<h3>${escape(labels.externalOutputs)}</h3>${table(externalHeaders, externalRows(manifest.externalOutputs), labels.none)}`,
    );
  }
  sections.push(
    `<h2>${escape(labels.logs)}</h2>${table(fileHeaders(false), fileRows(manifest.logs, false), labels.none)}`,
    `<h2>${escape(labels.results)}</h2>${table(fileHeaders(false), fileRows(manifest.results, false), labels.none)}`,
  );
  if (manifest.type === "REPOSITORY" || checkinFailures.length) {
    const rows: [string, string][] = spec
      ? [
          [labels.versioning, escape(spec.fileVersion || labels.none)],
          [
            labels.versionNewFiles,
            escape(spec.enableVersioningOnNewFiles ? labels.yes : labels.no),
          ],
          [
            labels.checkinLocations,
            spec.locations.length
              ? spec.locations
                  .map(
                    (l) => `${code(l.path)}${l.includeSubfolders ? " +" : ""}`,
                  )
                  .join("<br>")
              : escape(labels.none),
          ],
        ]
      : [];
    sections.push(
      `<h2>${escape(labels.checkin)}</h2>${
        rows.length
          ? `<table class="summary"><tbody>${rows
              .map(
                ([k, v]) =>
                  `<tr><th scope="row">${escape(k)}</th><td>${v}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : ""
      }<h3>${escape(labels.checkinFailures)}</h3>${table(
        [labels.item, labels.message],
        checkinFailures.map((f) => [
          code([f.itemIdentifier, f.itemName].filter(Boolean).join("/")),
          escape(f.message),
        ]),
        labels.none,
      )}`,
    );
  }
  const metrics = Object.entries(manifest.metrics ?? {}).filter(
    (entry): entry is [string, TransferMetric] => !!entry[1],
  );
  if (metrics.length) {
    sections.push(
      `<h2>${escape(labels.metrics)}</h2>${table(
        [labels.name, labels.files, labels.size, labels.time],
        metrics.map(([name, m]) => [
          escape(name.replace(/Metrics$/, "")),
          escape(m.total ?? ""),
          escape(m.size !== undefined ? formatBytes(m.size, 1) : ""),
          escape(seconds(m.time)),
        ]),
        labels.none,
      )}`,
    );
  }

  const title = `${labels.title}: ${jobName}`;
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
<p class="muted">${escape(labels.generated)} ${escape(formatDate(generatedAt.toISOString(), locale))}</p>
</header>
${sections.join("\n")}
</body>
</html>
`;
}

function programOutcome(state: string | undefined): string {
  switch (state) {
    case "SUCCESSFUL":
      return "success";
    case "WARNINGS":
      return "warning";
    case "CANCELED":
    case "UNEXECUTED":
      return "canceled";
    default:
      return "error";
  }
}

const STYLE = `
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
