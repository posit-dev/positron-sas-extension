// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Which compute context a background job runs in. By default the same one as
// interactive runs: the profile's context, or the extension's default. The
// SAS.backgroundJobs.computeContext setting overrides it.
import {
  ConfigurationTarget,
  QuickPickItem,
  l10n,
  window,
  workspace,
} from "vscode";

import { DEFAULT_COMPUTE_CONTEXT } from "../components/profile";
import { getActiveViyaContext } from "../viya/endpoint";
import type { JobsModel } from "./JobsModel";
import { BackgroundJobMessages, backgroundJobErrorMessage } from "./messages";

const SETTING_SECTION = "SAS.backgroundJobs";
const SETTING_KEY = "computeContext";

/** The configured context, before checking that the server has it. */
export function configuredContext(): string {
  const setting = workspace
    .getConfiguration(SETTING_SECTION)
    .get<string>(SETTING_KEY, "")
    .trim();
  return setting || getActiveViyaContext() || DEFAULT_COMPUTE_CONTEXT;
}

export class ComputeContextResolver {
  /** Contexts confirmed to exist, per endpoint. */
  private readonly confirmed = new Map<string, string>();

  constructor(
    private readonly model: JobsModel,
    private readonly log: (message: string) => void,
  ) {}

  /**
   * The context to submit to, checked against the server once per endpoint.
   * Undefined when the user dismissed the picker.
   */
  async resolve(endpoint: string): Promise<string | undefined> {
    const wanted = configuredContext();
    if (this.confirmed.get(endpoint) === wanted) {
      return wanted;
    }
    let names: string[];
    try {
      names = (await this.model.listComputeContexts()).map((c) => c.name);
    } catch (error) {
      // Some users may not list contexts but can still use one. Let the
      // submit itself report a bad name.
      this.log(
        `Could not list compute contexts, using "${wanted}": ${backgroundJobErrorMessage(error)}`,
      );
      return wanted;
    }
    if (names.includes(wanted)) {
      this.confirmed.set(endpoint, wanted);
      return wanted;
    }
    window.showWarningMessage(
      l10n.t(BackgroundJobMessages.ContextNotFound, { name: wanted }),
    );
    const picked = await this.pick(names);
    if (picked) {
      this.confirmed.set(endpoint, picked);
    }
    return picked;
  }

  /** Let the user choose a context, and optionally keep the choice. */
  async choose(): Promise<string | undefined> {
    let names: string[] = [];
    try {
      names = (await this.model.listComputeContexts()).map((c) => c.name);
    } catch (error) {
      this.log(
        `Could not list compute contexts: ${backgroundJobErrorMessage(error)}`,
      );
    }
    if (!names.length) {
      const typed = await window.showInputBox({
        prompt: BackgroundJobMessages.EnterContext,
        value: configuredContext(),
        ignoreFocusOut: true,
      });
      if (typed?.trim()) {
        await this.save(typed.trim());
        return typed.trim();
      }
      return undefined;
    }
    return this.pick(names, true);
  }

  private async pick(
    names: string[],
    alwaysSave = false,
  ): Promise<string | undefined> {
    const current = configuredContext();
    const items: (QuickPickItem & { name: string })[] = [...names]
      .sort((a, b) =>
        a === current ? -1 : b === current ? 1 : a.localeCompare(b),
      )
      .map((name) => ({
        name,
        label: name,
        description: name === current ? "$(check)" : undefined,
      }));
    const choice = await window.showQuickPick(items, {
      placeHolder: BackgroundJobMessages.ChooseContext,
      ignoreFocusOut: true,
    });
    if (!choice) {
      return undefined;
    }
    if (alwaysSave) {
      await this.save(choice.name);
    } else {
      const keep = await window.showInformationMessage(
        choice.name,
        BackgroundJobMessages.AlwaysUseContext,
      );
      if (keep) {
        await this.save(choice.name);
      }
    }
    return choice.name;
  }

  private async save(name: string): Promise<void> {
    await workspace
      .getConfiguration(SETTING_SECTION)
      .update(SETTING_KEY, name, ConfigurationTarget.Global);
  }

  reset(): void {
    this.confirmed.clear();
  }
}
