// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
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
