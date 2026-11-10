// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n, window } from "vscode";

import { getViyaSession } from "../components/AuthProvider";
import { ConnectionType, ProfileConfig } from "../components/profile";
import type { ViyaProfile } from "../components/profile";
import { viyaTokenFilePath, writeViyaTokenFile } from "../positron/saspyToken";

export interface SaveViyaTokenResult {
  /** The token file. The token itself is never returned. */
  path: string;
  endpoint: string;
  /** ISO time the token expires, when known. */
  expiresAt?: string;
}

/**
 * Save the SAS Viya access token of the extension's sign-in to a file that only
 * the user can read, so that saspy in a Quarto render (a separate R and Python
 * process) can use it. The generated sascfg_personal.py reads that file.
 *
 * Also called by Posit Assistant right before a render, so it returns where
 * the file is and never the token itself: the token must not end up in a chat.
 */
export async function saveViyaTokenForSaspy(): Promise<SaveViyaTokenResult> {
  const profileConfig = new ProfileConfig();
  const profileName = profileConfig.getActiveProfile();
  const profile = profileName
    ? profileConfig.getProfileByName<ViyaProfile>(profileName)
    : undefined;
  if (profile?.connectionType !== ConnectionType.Rest) {
    throw new Error(
      l10n.t("The active SAS connection profile is not a SAS Viya profile."),
    );
  }

  const session = await getViyaSession();
  const saved = writeViyaTokenFile(
    viyaTokenFilePath(),
    profile.endpoint,
    session.accessToken,
  );

  window.setStatusBarMessage(l10n.t("SAS Viya token saved for saspy."), 5000);
  return {
    path: viyaTokenFilePath(),
    endpoint: saved.endpoint,
    expiresAt:
      saved.expires_at === undefined
        ? undefined
        : new Date(saved.expires_at * 1000).toISOString(),
  };
}
