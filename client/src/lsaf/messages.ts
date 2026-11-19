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

  // Repository view
  ListError: l10n.t("Unable to list the LSAF folder. {message}"),
  Signed: l10n.t("signed"),
  CheckedOutBySelf: l10n.t("Checked out by you"),
  CheckedOutBy: l10n.t("Checked out by {user}"),
  RepositoryReadOnly: l10n.t(
    "Repository files are read-only: edit the workspace copy and check it in.",
  ),
  NoDeleteOrRename: l10n.t(
    "The LSAF REST API cannot delete or rename files and folders. Use the LSAF web application.",
  ),
  PropertiesTitle: l10n.t("{name}: LSAF Properties"),
  NoVersions: l10n.t("{name} has no versions."),
  LatestVersion: l10n.t("{version} (latest)"),
  VersionsTitle: l10n.t("Versions of {name}"),
  PickVersion: l10n.t("Select a version"),
  OpenVersion: l10n.t("Open This Version"),
  CompareWithLatest: l10n.t("Compare with the Latest Version"),
  CompareWithWorkspace: l10n.t("Compare with the Workspace Copy"),
  VersionActionTitle: l10n.t("{name}, version {version}"),
  VersionVsWorkspace: l10n.t("{name} ({version} ↔ workspace)"),
  DownloadTitle: l10n.t("Download from LSAF"),
  DownloadHere: l10n.t("Download Here"),
  Downloading: l10n.t("Downloading {name}..."),
  DownloadingCount: l10n.t("Downloading {count} items..."),
};
