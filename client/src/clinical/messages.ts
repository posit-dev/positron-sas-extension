// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/const.ts (Apache-2.0).
import { l10n } from "vscode";

import { isAxiosError } from "axios";

import type { PropertyLabels } from "./properties";
import type { ValidationError } from "./utils";

export const Messages = {
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
  CheckInError: l10n.t(
    "There was an error checking in the selected item(s). {message}",
  ),
  CheckInNoItems: l10n.t("None of the selected items can be checked in."),
  CheckInSuccess: l10n.t("Successfully checked in the selected item(s)."),
  CheckInVersionPrompt: l10n.t("Enter the version to check in with."),
  CheckInWarning: l10n.t(
    "There was a warning checking in the selected item(s). {message}",
  ),
  CheckingInMessage: l10n.t("Checking in..."),
  CopyError: l10n.t(
    "There was an error copying the selected item(s) to your workspace. {message}",
  ),
  CopySuccess: l10n.t(
    "Successfully copied the selected item(s) to your workspace.",
  ),
  CopyWarning: l10n.t(
    "There was a warning copying the selected item(s) to your workspace. {message}",
  ),
  CopyingMessage: l10n.t("Copying to your workspace..."),
  CompareFilesOnly: l10n.t("Select two files to compare."),
  DeleteAction: l10n.t("Delete"),
  DeleteConfirm: l10n.t('Delete "{name}"?'),
  DeleteConfirmMany: l10n.t("Delete the {count} selected items?"),
  DeleteDetail: l10n.t(
    "The items are moved to the recycle bin. You can restore them with the Manage Data Repository application of SAS Clinical Acceleration.",
  ),
  DeleteError: l10n.t("There was an error deleting the selected item(s)."),
  DeleteItemError: l10n.t('Unable to delete "{name}". {message}'),
  DeleteSuccess: l10n.t('Deleted "{name}".'),
  DeleteFromWorkspaceDetail: l10n.t(
    "The items are removed from your workspace. Nothing changes in the repository.",
  ),
  DeleteFromWorkspaceError: l10n.t(
    "There was an error deleting the selected item(s). {message}",
  ),
  DeleteFromWorkspaceSuccess: l10n.t(
    "Deleted the selected item(s) from your workspace.",
  ),
  DeleteFromWorkspaceWarning: l10n.t(
    "There was a warning deleting the selected item(s). {message}",
  ),
  DeletingMessage: l10n.t("Deleting..."),
  DisableVersioningError: l10n.t(
    "There was an error disabling versioning. {message}",
  ),
  DisableVersioningMessage: l10n.t("Disabling versioning..."),
  DisableVersioningSuccess: l10n.t("Versioning was disabled for the file."),
  DisableVersioningWarning: l10n.t(
    "There was a warning disabling versioning. {message}",
  ),
  DownloadTitle: l10n.t("Download"),
  DownloadedMessage: l10n.t('Downloaded "{name}" to "{location}"'),
  DownloadingMessage: l10n.t("Downloading content..."),
  DownloadError: l10n.t(
    "There was an error downloading the selected item(s). {message}",
  ),
  EnableVersioningError: l10n.t(
    "There was an error enabling versioning. {message}",
  ),
  EnableVersioningMessage: l10n.t("Enabling versioning..."),
  EnableVersioningSuccess: l10n.t("Versioning was enabled for the file."),
  EnableVersioningWarning: l10n.t(
    "There was a warning enabling versioning. {message}",
  ),
  EnableVersionPrompt: l10n.t("Enter the first version of the file."),
  FileCreationError: l10n.t(
    'Unable to create new file "{name}" at "{location}". {message}',
  ),
  FileCreationSuccess: l10n.t('Created new file "{name}" at "{location}".'),
  FolderCreationError: l10n.t(
    'Unable to create new folder "{name}" at "{location}". {message}',
  ),
  FolderCreationSuccess: l10n.t('Created new folder "{name}" at "{location}".'),
  Major: l10n.t("Major"),
  MajorDetail: l10n.t(
    "Raise the major version of all versioned files being checked in.",
  ),
  Minor: l10n.t("Minor"),
  MinorDetail: l10n.t(
    "Raise the minor version of all versioned files being checked in.",
  ),
  ListError: l10n.t("Unable to list the Clinical Repository. {message}"),
  NoItemSelected: l10n.t("Select an item to see its properties."),
  NoVersionHistory: l10n.t("Select a file to see its versions."),
  NotVersioned: l10n.t("This file is not versioned."),
  NewFilePrompt: l10n.t("Enter a file name."),
  NewFileTitle: l10n.t("New File"),
  NewFolderPrompt: l10n.t("Enter a folder name."),
  NewFolderTitle: l10n.t("New Folder"),
  No: l10n.t("No"),
  PropertiesError: l10n.t("Unable to load the properties. {message}"),
  RenameError: l10n.t('Unable to rename "{oldName}" to "{newName}". {message}'),
  RenameFileTitle: l10n.t("Rename File"),
  RenameFolderTitle: l10n.t("Rename Folder"),
  RenamePrompt: l10n.t("Enter a new name."),
  RenameSuccess: l10n.t('Successfully renamed "{oldName}" to "{newName}".'),
  SaveError: l10n.t('Unable to save "{name}". {message}'),
  StartActionError: l10n.t("Unable to start the requested action. {message}"),
  VersionCommentLabel: l10n.t("Comment"),
  VersionCreatedBy: l10n.t("Version created by"),
  VersionDate: l10n.t("Date version created"),
  VersionListError: l10n.t("Unable to list the versions. {message}"),
  VersionSize: l10n.t("Size"),
  VersioningPrivilegeMissing: l10n.t(
    "You do not have a privilege to change the versioning of files.",
  ),
  VersionBumpPlaceholder: l10n.t(
    "Select the version scheme for the versioned files being checked in.",
  ),
  VersionExistingFiles: l10n.t(
    "Enable versioning for the {count} checked out file(s) without versioning?",
  ),
  VersionNewFiles: l10n.t("Enable versioning for the {count} new file(s)?"),
  WorkspaceListError: l10n.t("Unable to list your workspace. {message}"),
  Yes: l10n.t("Yes"),
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
  VersionPrompt: l10n.t(
    "Leave empty to upload without versioning, or enter a version (ex: 1.0, MAJOR, MINOR).",
  ),
  VersionTitle: l10n.t("Version"),
};

/** Labels of the Properties view. */
export const PropertyLabelText: PropertyLabels = {
  name: l10n.t("Name"),
  description: l10n.t("Description"),
  location: l10n.t("Location"),
  type: l10n.t("Type"),
  owner: l10n.t("Owner"),
  createdBy: l10n.t("Created by"),
  dateCreated: l10n.t("Date created"),
  modifiedBy: l10n.t("Modified by"),
  dateModified: l10n.t("Date modified"),
  state: l10n.t("State"),
  size: l10n.t("Size"),
  lockStatus: l10n.t("Lock status"),
  versionStatus: l10n.t("Version status"),
  version: l10n.t("Version"),
  checkedOut: l10n.t("Check out status"),
  checkedOutBy: l10n.t("Checked out by"),
  checkedOutDate: l10n.t("Date checked out"),
  workspaceStatus: l10n.t("Workspace file status"),
  locked: l10n.t("Locked"),
  unlocked: l10n.t("Unlocked"),
  versioned: l10n.t("Versioned"),
  unversioned: l10n.t("Not versioned"),
  checkedOutYes: l10n.t("Checked out"),
  checkedOutNo: l10n.t("Not checked out"),
  syncMissing: l10n.t("Missing"),
  syncOutOfSync: l10n.t("Out of sync"),
  syncInSync: l10n.t("Synced"),
  syncNotSynced: l10n.t("Not synced"),
  syncUnknown: l10n.t("Unknown"),
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
  versionFormat: l10n.t(
    "Please enter a valid version (ex: 1.0), or MAJOR or MINOR.",
  ),
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
