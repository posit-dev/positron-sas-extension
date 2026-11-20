// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ProgressLocation, env, window } from "vscode";

import { getActiveSession } from "./index";
import { checkMacroExpression } from "./sasClient";

/** The longest result shown in the notification; Copy gets all of it. */
const MAX_SHOWN = 500;

let lastExpression = "";

/**
 * Evaluate a macro expression in the active SAS console and show the result,
 * like SAS Enterprise Guide's macro expression quick view (#158).
 */
export async function evaluateMacroExpression(): Promise<void> {
  const session = getActiveSession();
  if (!session) {
    void window.showErrorMessage("Start a SAS console to evaluate a macro expression.");
    return;
  }
  const expression = await window.showInputBox({
    title: "Evaluate Macro Expression",
    prompt: "Anything that can follow %LET name=, e.g. %eval(&x + 1) or %sysfunc(today(), date9.)",
    value: lastExpression,
    ignoreFocusOut: true,
    validateInput: (value) => checkMacroExpression(value),
  });
  if (expression === undefined) {
    return;
  }
  lastExpression = expression;

  let result;
  try {
    result = await window.withProgress(
      { location: ProgressLocation.Window, title: "Evaluating macro expression" },
      () => session.evaluateMacroExpression(expression),
    );
  } catch (error) {
    void window.showErrorMessage(
      `The macro expression could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const shown =
    result.value.length > MAX_SHOWN
      ? `${result.value.slice(0, MAX_SHOWN)}… (${result.value.length} characters)`
      : result.value;
  const text = `${expression} → ${shown === "" ? "(empty)" : shown}`;
  const copy = "Copy Value";
  const choice =
    result.messages.length > 0
      ? await window.showWarningMessage(`${text}\n\n${result.messages.join("\n")}`, copy)
      : await window.showInformationMessage(text, copy);
  if (choice === copy) {
    await env.clipboard.writeText(result.value);
  }
}
