// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The nodes of the Jobs view, and how a run's manifest becomes groups of them.
// No vscode import, so it is unit-tested directly.
import type {
  CheckinFailure,
  Manifest,
  ManifestExternalReference,
  ManifestFile,
  ManifestProgram,
  ParameterValue,
  Submission,
} from "./types";

export type JobNode =
  | { kind: "run"; submission: Submission }
  | { kind: "more" }
  | { kind: "message"; text: string; icon?: string }
  | { kind: "group"; label: string; icon: string; children: JobNode[] }
  | { kind: "file"; file: ManifestFile; detail?: string }
  | { kind: "program"; program: ManifestProgram }
  | { kind: "parameter"; value: ParameterValue }
  | { kind: "external"; reference: ManifestExternalReference }
  | { kind: "failure"; failure: CheckinFailure };

export interface GroupLabels {
  programs: string;
  parameters: string;
  inputs: string;
  outputs: string;
  logs: string;
  results: string;
  checkinFailures: string;
}

/** The groups a run's manifest shows, leaving out empty ones. */
export function manifestNodes(
  manifest: Manifest,
  checkinFailures: CheckinFailure[],
  labels: GroupLabels,
): JobNode[] {
  const files = (list: ManifestFile[] | undefined): JobNode[] =>
    (list ?? []).map((file) => ({ kind: "file", file }));
  const external = (list: ManifestExternalReference[] | undefined): JobNode[] =>
    (list ?? []).map((reference) => ({ kind: "external", reference }));
  // Logs and listings are outputs too; the Outputs group shows the rest.
  const system = new Set(
    [...(manifest.logs ?? []), ...(manifest.results ?? [])].map(
      (f) => f.resource.path,
    ),
  );
  const outputs = (manifest.outputs ?? []).filter(
    (f) => !system.has(f.resource.path),
  );
  const groups: [string, string, JobNode[]][] = [
    [
      labels.programs,
      "symbol-method",
      (manifest.programs ?? []).map((program) => ({
        kind: "program",
        program,
      })),
    ],
    [
      labels.parameters,
      "symbol-parameter",
      (manifest.parameters ?? []).map((value) => ({
        kind: "parameter",
        value,
      })),
    ],
    [
      labels.inputs,
      "arrow-right",
      [...files(manifest.inputs), ...external(manifest.externalInputs)],
    ],
    [
      labels.outputs,
      "arrow-left",
      [...files(outputs), ...external(manifest.externalOutputs)],
    ],
    [labels.logs, "output", files(manifest.logs)],
    [labels.results, "file-text", files(manifest.results)],
    [
      labels.checkinFailures,
      "error",
      checkinFailures.map((failure) => ({ kind: "failure", failure })),
    ],
  ];
  return groups
    .filter(([, , children]) => children.length)
    .map(([label, icon, children]) => ({
      kind: "group",
      label,
      icon,
      children,
    }));
}

/** A parameter value as text; masked values stay hidden. */
export function describeValue(value: ParameterValue): string {
  const v = value.value;
  if (typeof v === "string") {
    return value.type === "CHARACTER_MASKED" ? "*****" : v;
  }
  if (v && typeof v === "object") {
    return "includeSubfolders" in v && v.includeSubfolders
      ? `${v.path} (+ subfolders)`
      : v.path;
  }
  return "";
}
