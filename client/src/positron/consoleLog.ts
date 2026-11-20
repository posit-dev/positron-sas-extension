// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Code the console wraps around user code, and the filter that hides the log
 * lines this wrapper produces so the console shows only the user's log.
 * Kept free of `vscode` imports so it can be unit tested.
 */

/** Option set before console code so its source and notes are logged. */
export const CONSOLE_OPTIONS = "options source notes;";

/**
 * Open ODS HTML5 to `<bodyId>.htm`, with graphs drawn as PNG so they can go
 * to the Plots pane and Posit Assistant (#74). Each line must be under 80
 * chars to avoid SSH pty line-wrapping.
 */
export function odsOpenCode(bodyId: string): string {
  return [
    `ods graphics / outputfmt=png; ods html5(id=vscode) style=HTMLBlue`,
    `  options(bitmap_mode='inline' svg_mode='inline')`,
    `  body="${bodyId}.htm";`,
  ].join("\n");
}

/** Close any open statement or comment, then close ODS. */
export const CONSOLE_POSTAMBLE = `;*';*";*/;run;quit;ods html5(id=vscode) close;`;

// Matches the comment built by buildSubmissionComment().
const SUBMISSION_TAG = /\/\* positron: user=\S* session=\S* exec=\S* \*\/ ?/;

/** Remove the submission comment (#58) from a log line, if present. */
export function stripSubmissionTag(text: string): string {
  return text.replace(SUBMISSION_TAG, "");
}

const WRAPPER_SOURCE: RegExp[] = [
  /^options source notes;$/i,
  /^ods graphics \/ outputfmt=png; ods html5\(id=vscode\) style=HTMLBlue$/i,
  /^options\(bitmap_mode='inline' svg_mode='inline'\)$/i,
  /^body="[0-9a-f-]+\.htm";$/i,
  /^;\*';\*";\*\/;run;quit;ods html5\(id=vscode\) close;$/i,
  /^\/\*\* LOG_START_INDICATOR \*\*\/$/,
  /^%let _SASPROGRAMFILE\b/i,
  // The end-of-run marker the SSH and stdio connections append.
  /^%put --vscode-sas-extension-submit-end--;$/,
];

const WRAPPER_MESSAGES: RegExp[] = [
  /^NOTE: Writing HTML5\(VSCODE\) Body file:/i,
  /^--vscode-sas-extension/,
];

/**
 * True for log lines produced by the console's wrapper code rather than by
 * the user's code: source echoes of the preamble and postamble, the ODS body
 * file note, and the ITC submission markers.
 */
export function isWrapperLogLine(text: string): boolean {
  const trimmed = text.trim();
  if (WRAPPER_MESSAGES.some((re) => re.test(trimmed))) {
    return true;
  }
  // Source echoes start with the SAS line number.
  const source = /^\d+\s+(.*)$/.exec(trimmed);
  if (!source) {
    return false;
  }
  const hadTag = SUBMISSION_TAG.test(source[1]);
  const code = stripSubmissionTag(source[1]).trim();
  if (code === "") {
    return hadTag;
  }
  return WRAPPER_SOURCE.some((re) => re.test(code));
}

/** Log categories the console can show or hide (`SAS.console.logOutput`). */
export const LOG_CATEGORIES = [
  "source",
  "notes",
  "warnings",
  "errors",
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

/**
 * Classify a SAS log line by its text, for sessions that don't type their
 * lines (SSH and stdio send every line as "normal"). Returns "error",
 * "warning", "note", "source", or "normal".
 */
export function classifyLogLine(text: string): string {
  const trimmed = text.trimStart();
  if (/^ERROR\b/i.test(trimmed)) {
    return "error";
  }
  if (/^WARNING\b/i.test(trimmed)) {
    return "warning";
  }
  if (/^NOTE\b/i.test(trimmed)) {
    return "note";
  }
  // Source echo: line number followed by spaces and code
  if (/^\d+\s/.test(trimmed)) {
    return "source";
  }
  return "normal";
}

/** The console category of an effective log line type. */
export function logCategory(effectiveType: string): LogCategory {
  switch (effectiveType) {
    case "error":
      return "errors";
    case "warning":
      return "warnings";
    case "source":
      return "source";
    default:
      return "notes";
  }
}

export interface ClassifiedLogLine {
  /** "error", "warning", "note", "source", or another log line type. */
  effective: string;
  category: LogCategory;
  /** An indented line that continues the ERROR or WARNING before it. */
  continuation: boolean;
}

/**
 * Classifier for one run's log lines. Untyped lines are classified by their
 * text, and an indented untyped line right after an ERROR or WARNING belongs
 * to that message, so hiding notes never cuts a multi-line error in half.
 */
export function createLogLineClassifier(): (
  text: string,
  type: string,
) => ClassifiedLogLine {
  let previous: "error" | "warning" | undefined;
  return (text, type) => {
    let effective = (type ?? "").toLowerCase();
    const untyped =
      effective === "normal" || effective === "" || effective === "message";
    if (untyped) {
      effective = classifyLogLine(text);
    }
    if (
      untyped &&
      effective === "normal" &&
      previous &&
      /^\s/.test(text) &&
      text.trim() !== ""
    ) {
      return {
        effective: previous,
        category: logCategory(previous),
        continuation: true,
      };
    }
    previous =
      effective === "error" || effective === "warning" ? effective : undefined;
    return { effective, category: logCategory(effective), continuation: false };
  };
}

/**
 * The categories in a `SAS.console.logOutput` value. Unknown entries are
 * ignored; a value that is not an array means all categories.
 */
export function parseLogOutputSetting(value: unknown): Set<LogCategory> {
  if (!Array.isArray(value)) {
    return new Set(LOG_CATEGORIES);
  }
  return new Set(LOG_CATEGORIES.filter((category) => value.includes(category)));
}
