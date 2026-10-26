// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/const.ts (Apache-2.0).
import { l10n } from "vscode";

import { isAxiosError } from "axios";

import type { ValidationError } from "./utils";

export const Messages = {
  AccessError: l10n.t("The item cannot be accessed."),
  CheckOutError: l10n.t(
    "There was an error checking out the selected item(s). {message}",
  ),
  CheckOutSuccess: l10n.t("Successfully checked out selected item(s)."),
  CheckOutWarning: l10n.t(
    "There was a warning checking out the selected item(s). {message}",
  ),
  CheckingOutMessage: l10n.t("Checking out..."),
  CheckedOutBy: l10n.t("Checked out by {name}"),
  CheckedOutBySelf: l10n.t("Checked out by you"),
  CommentPrompt: l10n.t("Enter an optional comment for this action."),
  CommentTitle: l10n.t("Comment"),
  DownloadTitle: l10n.t("Download"),
  DownloadedMessage: l10n.t('Downloaded "{name}" to "{location}"'),
  DownloadingMessage: l10n.t("Downloading content..."),
  DownloadError: l10n.t(
    "There was an error downloading the selected item(s). {message}",
  ),
  FolderCreationError: l10n.t(
    'Unable to create new folder "{name}" at "{location}". {message}',
  ),
  FolderCreationSuccess: l10n.t('Created new folder "{name}" at "{location}".'),
  ListError: l10n.t("Unable to list the Clinical Repository. {message}"),
  NewFolderPrompt: l10n.t("Enter a folder name."),
  NewFolderTitle: l10n.t("New Folder"),
  RenameError: l10n.t('Unable to rename "{oldName}" to "{newName}". {message}'),
  RenameFileTitle: l10n.t("Rename File"),
  RenameFolderTitle: l10n.t("Rename Folder"),
  RenamePrompt: l10n.t("Enter a new name."),
  RenameSuccess: l10n.t('Successfully renamed "{oldName}" to "{newName}".'),
  StartActionError: l10n.t("Unable to start the requested action. {message}"),
  UndoCheckOutError: l10n.t(
    "There was an error reverting the check out of the selected item(s). {message}",
  ),
  UndoCheckOutMessage: l10n.t("Undoing check out..."),
  UndoCheckOutSuccess: l10n.t(
    "Successfully reverted the check out of the selected item(s).",
  ),
  UndoCheckOutWarning: l10n.t(
    "There was a warning reverting the check out of the selected item(s). {message}",
  ),
  UploadAndExpandTitle: l10n.t("Upload and Expand"),
  UploadError: l10n.t("There was an error uploading the selected item(s)."),
  UploadErrorMessage: l10n.t(
    'Unable to upload "{name}" to "{location}". {message}',
  ),
  UploadTitle: l10n.t("Upload"),
  UploadedAndExpandedMessage: l10n.t(
    'Uploaded and expanded "{name}" to "{location}".',
  ),
  UploadedMessage: l10n.t('Uploaded "{name}" to "{location}".'),
  UploadingMessage: l10n.t("Uploading content..."),
  VersionPrompt: l10n.t("Enter an optional version for this upload."),
  VersionTitle: l10n.t("Version"),
};

const ValidationMessages: Record<ValidationError, string> = {
  fileName: l10n.t("Invalid file name."),
  folderLength: l10n.t(
    "The folder name cannot contain more than 255 characters.",
  ),
  folderDot: l10n.t("Leading dot character is not allowed."),
  folderLeadingSpace: l10n.t("Leading whitespace characters are not allowed."),
  folderTrailingSpace: l10n.t(
    "Trailing whitespace characters are not allowed.",
  ),
  folderCharacters: l10n.t("The folder name provided has invalid characters."),
  commentLength: l10n.t(
    "The comment cannot contain more than 1024 characters.",
  ),
  versionFormat: l10n.t("Please enter a valid version (ex: 1.0, etc.)."),
};

/** Adapt a pure validator to `showInputBox`'s validateInput. */
export const toInputValidator =
  (validate: (value: string) => ValidationError | undefined) =>
  (value: string): string | undefined => {
    const error = validate(value);
    return error ? ValidationMessages[error] : undefined;
  };

/** Best-effort server message from an axios error. */
export function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data: unknown = error.response?.data;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
