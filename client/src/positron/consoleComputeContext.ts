// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Choose Compute Context..., in the Console title bar of a SAS Viya console.
// The choice is the connection profile's compute context, which every
// interactive session of the profile uses (and background jobs by default).
// A running console keeps its own context (see consoleContext.ts), so the
// user is offered to replace it with a new console in the new context.
import { QuickPickItem, commands, l10n, window } from "vscode";

import { profileConfig } from "../commands/profile";
import { ContextsApi } from "../connection/rest/api/compute";
import { getApiConfig } from "../connection/rest/common";
import type { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import { effectiveContext, withContext } from "./consoleContext";
import type { PositronApi } from "./positron-types";

export const CHOOSE_COMPUTE_CONTEXT = "SAS.console.chooseComputeContext";

/**
 * The profile a SAS runtime was registered for. Read from the runtime
 * metadata, which exists as soon as the session does; the console object is
 * registered only once its SAS session has started.
 */
function profileOf(extraRuntimeData: unknown): string | undefined {
  if (
    extraRuntimeData &&
    typeof extraRuntimeData === "object" &&
    "profile" in extraRuntimeData &&
    typeof extraRuntimeData.profile === "string"
  ) {
    return extraRuntimeData.profile;
  }
  return undefined;
}
/** Set while the console in front is a SAS Viya console with a context. */
export const COMPUTE_CONTEXT_KEY = "SAS.consoleComputeContext";

/** Whether the foreground console can choose a compute context. */
export async function updateComputeContextKey(api: PositronApi): Promise<void> {
  const session = await api.runtime.getForegroundSession();
  const profile =
    session?.runtimeMetadata.languageId === "sas"
      ? profileOf(session.runtimeMetadata.extraRuntimeData)
      : undefined;
  await commands.executeCommand(
    "setContext",
    COMPUTE_CONTEXT_KEY,
    !!profile && !!effectiveContext(profileConfig.getProfileByName(profile)),
  );
}

/**
 * The compute contexts the user can see, by name. Uses the compute API that
 * the console's own SAS Viya session configured; undefined when it can't be
 * listed.
 */
async function listContextNames(): Promise<string[] | undefined> {
  try {
    const response = await ContextsApi(getApiConfig()).getContexts({
      limit: 100,
    });
    const names = (response.data.items ?? [])
      .map((context) => context.name)
      .filter((name): name is string => !!name);
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** Ask for a compute context, starting from the current one. */
async function pickContext(
  profile: string,
  current: string,
): Promise<string | undefined> {
  const names = await listContextNames();
  if (!names) {
    // Listing contexts may not be allowed; a name can still be typed in.
    const typed = await window.showInputBox({
      prompt: l10n.t("Compute context for the SAS Viya profile {profile}", {
        profile,
      }),
      value: current,
      ignoreFocusOut: true,
    });
    return typed?.trim() || undefined;
  }
  const items: (QuickPickItem & { name: string })[] = [...names]
    .sort((a, b) =>
      a === current ? -1 : b === current ? 1 : a.localeCompare(b),
    )
    .map((name) => ({
      name,
      label: name,
      description: name === current ? l10n.t("$(check) current") : undefined,
    }));
  const choice = await window.showQuickPick(items, {
    placeHolder: l10n.t("Compute context for the SAS Viya profile {profile}", {
      profile,
    }),
    ignoreFocusOut: true,
  });
  return choice?.name;
}

/**
 * Choose the compute context of the foreground SAS Viya console's profile,
 * then offer to replace the console with one in the new context.
 */
export async function chooseConsoleComputeContext(
  api: PositronApi | undefined,
  getConsole: (sessionId: string) => SASLanguageRuntimeSession | undefined,
): Promise<void> {
  const foreground = await api?.runtime.getForegroundSession();
  const profileName =
    foreground?.runtimeMetadata.languageId === "sas"
      ? profileOf(foreground.runtimeMetadata.extraRuntimeData)
      : undefined;
  const profile = profileName
    ? profileConfig.getProfileByName(profileName)
    : undefined;
  // The context this console runs in; while its SAS session is still
  // starting, the profile's, which it is being created with.
  const current =
    (foreground && getConsole(foreground.metadata.sessionId)?.computeContext) ??
    effectiveContext(profile);
  if (!api || !foreground || !profileName || !profile || !current) {
    window.showInformationMessage(
      l10n.t(
        "Bring a SAS console on SAS Viya to the front to choose its compute context.",
      ),
    );
    return;
  }

  const chosen = await pickContext(profileName, current);
  if (!chosen || chosen === current) {
    return;
  }

  try {
    await profileConfig.upsertProfile(
      profileName,
      withContext(profile, chosen),
    );
  } catch (error) {
    window.showErrorMessage(
      l10n.t(
        "Could not save the compute context in the profile {profile}. {message}",
        {
          profile: profileName,
          message: error instanceof Error ? error.message : String(error),
        },
      ),
    );
    return;
  }

  const restartNow = l10n.t("Restart Now");
  const answer = await window.showInformationMessage(
    l10n.t(
      "The compute context of {profile} is now {chosen}. This SAS console keeps {current} until it is replaced; replacing it loses WORK and macro variables.",
      { profile: profileName, chosen, current },
    ),
    restartNow,
    l10n.t("Later"),
  );
  if (answer !== restartNow) {
    return;
  }

  // A new session rather than a restart in place: Positron reads a console's
  // name only when the session is created, and the new one should show (and
  // run in) the new context.
  const { runtimeId, runtimeShortName } = foreground.runtimeMetadata;
  await api.runtime.deleteSession(foreground.metadata.sessionId);
  const started = await api.runtime.startLanguageRuntime(
    runtimeId,
    runtimeShortName,
  );
  api.runtime.focusSession(started.metadata.sessionId);
}
