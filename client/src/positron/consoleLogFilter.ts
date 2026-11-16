// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  ConfigurationTarget,
  type QuickPickItem,
  window,
  workspace,
} from "vscode";

import {
  LOG_CATEGORIES,
  type LogCategory,
  parseLogOutputSetting,
} from "./consoleLog";

const SETTING = "console.logOutput";

const LABELS: Record<LogCategory, { label: string; detail: string }> = {
  source: {
    label: "Source",
    detail: "The SAS code echoed in the log, with line numbers",
  },
  notes: { label: "Notes", detail: "NOTE lines and other log text" },
  warnings: { label: "Warnings", detail: "WARNING lines" },
  errors: { label: "Errors", detail: "ERROR lines" },
};

/** The log categories the SAS console shows (`SAS.console.logOutput`). */
export function getConsoleLogOutput(): Set<LogCategory> {
  return parseLogOutputSetting(
    workspace.getConfiguration("SAS").get<unknown>(SETTING),
  );
}

/**
 * Command "SAS: Choose Console Log Output": pick the log categories the
 * console shows. The choice applies from the next run; the SAS Log output
 * channel always has the full log.
 */
export async function chooseConsoleLogOutput(): Promise<void> {
  const shown = getConsoleLogOutput();
  const items: (QuickPickItem & { category: LogCategory })[] =
    LOG_CATEGORIES.map((category) => ({
      ...LABELS[category],
      category,
      picked: shown.has(category),
    }));
  const picked = await window.showQuickPick(items, {
    canPickMany: true,
    title: "SAS Console Log Output",
    placeHolder:
      "Choose what the SAS console shows. The SAS Log output channel always has the full log.",
  });
  if (!picked) {
    return;
  }
  await workspace.getConfiguration("SAS").update(
    SETTING,
    picked.map((item) => item.category),
    ConfigurationTarget.Global,
  );
  if (picked.length === 0) {
    void window.showInformationMessage(
      "The SAS console now shows no log lines, only results and the error and warning summary. The SAS Log output channel still has the full log.",
    );
  }
}
