// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Prompts for the parameters of a job before it runs.
import { l10n, window } from "vscode";

import type { ItemPicker } from "./ItemPicker";
import { JobMessages, ParameterProblems } from "./messages";
import {
  buildParameterValue,
  defaultPath,
  defaultText,
  isTextType,
  validateParameterText,
} from "./parameterValues";
import type { ClinicalJob, JobResource, ParameterValue } from "./types";

/**
 * Ask for every parameter of the job, pre-filled with its default. Returns
 * undefined when the user cancels any prompt.
 */
export async function promptParameterValues(
  job: ClinicalJob,
  resource: JobResource,
  picker: ItemPicker,
): Promise<ParameterValue[] | undefined> {
  const values: ParameterValue[] = [];
  for (const param of job.parameters ?? []) {
    const label = param.label || param.name;
    const title = l10n.t(JobMessages.ParameterTitle, {
      name: resource.name,
      label,
    });
    if (isTextType(param.type)) {
      const text = await window.showInputBox({
        title,
        prompt: l10n.t(JobMessages.ParameterPrompt, {
          label,
          type: param.type,
        }),
        value: defaultText(param),
        password: param.type === "CHARACTER_MASKED",
        placeHolder:
          param.type === "DATE" ? JobMessages.DatePlaceholder : undefined,
        ignoreFocusOut: true,
        validateInput: (value) => {
          const problem = validateParameterText(param.type, value);
          return problem ? ParameterProblems[problem] : undefined;
        },
      });
      if (text === undefined) {
        return undefined;
      }
      values.push(buildParameterValue(param, text));
      continue;
    }

    const folder = param.type === "FOLDER";
    const start = defaultPath(param, resource.location);
    const path = await picker.pick({
      mode: folder ? "folder" : "file",
      location: resource.resourceLocation,
      title: l10n.t(folder ? JobMessages.PickFolder : JobMessages.PickFile, {
        label,
      }),
      startPath: folder ? start : start && start.replace(/\/[^/]*$/, ""),
    });
    if (path === undefined) {
      return undefined;
    }
    let includeSubfolders = false;
    if (folder) {
      const answer = await window.showQuickPick(
        [
          { label: JobMessages.IncludeSubfoldersNo, include: false },
          { label: JobMessages.IncludeSubfoldersYes, include: true },
        ],
        { title: JobMessages.IncludeSubfolders, ignoreFocusOut: true },
      );
      if (!answer) {
        return undefined;
      }
      includeSubfolders = answer.include;
    }
    values.push(buildParameterValue(param, path, includeSubfolders));
  }
  return values;
}
