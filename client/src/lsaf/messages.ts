// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

export const Messages = {
  // Sign-in
  NotDetected: l10n.t(
    "No LSAF server is detected. Set SAS.lsaf.url to the URL of your SAS Life Science Analytics Framework server.",
  ),
  NotSignedIn: l10n.t("Sign in to LSAF first."),
  SignInTitle: l10n.t("Sign In to LSAF"),
  UserIdPrompt: l10n.t("Your LSAF user ID on {url}"),
  UserIdRequired: l10n.t("Enter a user ID."),
  PasswordPrompt: l10n.t("The LSAF password of {user}"),
  SigningIn: l10n.t("Signing in to LSAF..."),
  SignInFailed: l10n.t("Signing in to LSAF failed. {message}"),
  PasswordNotRemembered: l10n.t(
    "The LSAF server could not encrypt your password, so it isn't remembered: you will be asked again when this session ends.",
  ),
  SignedInAs: l10n.t("Signed in to LSAF as {user}."),
};
