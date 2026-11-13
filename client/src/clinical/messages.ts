// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/const.ts (Apache-2.0).
import { l10n } from "vscode";

import { isAxiosError } from "axios";

import type { AuditReportLabels } from "./auditReport";
import type { PropertyLabels } from "./properties";
import type { SignatureKeyLabels } from "./signatureKey";
import type { SignatureReportLabels } from "./signatureReport";
import type { SigningStatus } from "./types";
import type { CheckInBlock, ValidationError } from "./utils";

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
  CheckInNotCheckedOut: l10n.t(
    "\"{name}\" is already in the repository and is not checked out to you, so it can't be checked in: a copy can't replace a repository version. Check the file out first; Check out to Workspace > Without Content leaves your workspace file as it is. If Check out to Workspace is missing, you have no write permission on the file: its Properties show your permissions.",
  ),
  CheckInCheckedOutByOther: l10n.t(
    '"{name}" is checked out by {user}, so only they can check it in.',
  ),
  CheckInNotOffered: l10n.t(
    '"{name}" has nothing to check in, or the server does not allow it.',
  ),
  CheckInBlockedMany: l10n.t(
    "{count} of the selected files can't be checked in. The SAS Clinical Repository output lists the reasons.",
  ),
  CheckInSomeLeftOut: l10n.t(
    "{count} file(s) were left out of the check-in. The SAS Clinical Repository output lists the reasons.",
  ),
  ShowDetails: l10n.t("Show Details"),
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
  Signed: l10n.t("Signed"),
  SignatureHistoryError: l10n.t(
    "Unable to load the signature history. {message}",
  ),
  SignatureExportTitle: l10n.t("Export Signature History"),
  SignatureExported: l10n.t('Saved the signature history to "{path}".'),
  SignatureExportError: l10n.t(
    "Unable to save the signature history. {message}",
  ),
  ShowSignatureHistory: l10n.t("Show Signature History"),
  SignFilesTitle: l10n.t("Sign Files"),
  SignFilesStep: l10n.t("Sign Files ({step}/{total})"),
  SignPreparing: l10n.t("Preparing to sign..."),
  SignPrepareError: l10n.t("Unable to prepare the signing. {message}"),
  SignPrivilegeMissing: l10n.t(
    "You don't have the Sign Files privilege. An administrator can grant it in SAS Clinical Acceleration Repository.",
  ),
  SignNoReasonsOrRoles: l10n.t(
    "The server has no signature reasons or roles configured. An administrator sets them in SAS Environment Manager (sas.clinical.signatures).",
  ),
  SignNothing: l10n.t(
    "None of the selected files can be signed: SAS Clinical Acceleration doesn't sign checked-out files. Check them in, or undo the check-out, first.",
  ),
  SignTooMany: l10n.t(
    "Only the first {max} files are offered for signing. Select fewer files or folders to sign the rest.",
  ),
  SignFilesPick: l10n.t("Select the files to sign"),
  SignFilesPickSkipped: l10n.t(
    "Select the files to sign ({count} checked-out file(s) left out: they can't be signed)",
  ),
  SignReasonPlaceholder: l10n.t("Select the reason for your signature"),
  SignRolePlaceholder: l10n.t("Select your signatory role"),
  SignCommentPrompt: l10n.t(
    "Enter a comment for the audit record. A comment is optional, but best practice.",
  ),
  SignConfirm: l10n.t("Sign {count} file(s) electronically?"),
  SignConfirmDetail: l10n.t(
    "Signer: {signer}\nReason: {reason}\nRole: {role}\n\n{files}\n\nThe signature is recorded in the audit history and can't be removed.",
  ),
  SignConfirmButton: l10n.t("Sign"),
  SignMoreFiles: l10n.t("and {count} more"),
  SignPinPrompt: l10n.t(
    "Enter the current PIN from your authenticator app. To link an authenticator app, enable signatures in the settings of SAS Clinical Acceleration Repository.",
  ),
  SignPinInvalid: l10n.t(
    "Enter the 6 to 8 digits your authenticator app shows.",
  ),
  SigningMessage: l10n.t("Signing..."),
  SignSuccess: l10n.t("Signed {count} file(s)."),
  SignWarning: l10n.t("Some files were not signed. {message}"),
  SignError: l10n.t("The files were not signed. {message}"),
  SignRetry: l10n.t("Retry with a New PIN"),
  SignSetUpAuthenticator: l10n.t("Set Up Authenticator..."),
  EnableSignaturesTitle: l10n.t("Enable Signatures"),
  EnableSignaturesConfirm: l10n.t("Generate a new QR code for signing?"),
  EnableSignaturesConfirmDetail: l10n.t(
    "The QR code links an authenticator app to your account, and the app's PINs sign files. If you linked an app before, its PINs stop working and you need to scan the new code.",
  ),
  EnableSignaturesButton: l10n.t("Generate QR Code"),
  EnableSignaturesGenerating: l10n.t("Generating a QR code..."),
  EnableSignaturesError: l10n.t("Unable to generate a QR code. {message}"),
  EnableSignaturesShown: l10n.t(
    "Scan the QR code with your authenticator app. Then use the app's current PIN when you sign files.",
  ),
  SearchStep: l10n.t("Search Repository ({step}/{total})"),
  SearchNamePrompt: l10n.t(
    "Name of the item. * matches any characters and ? one character; case is ignored. Leave empty for any name.",
  ),
  SearchContentPrompt: l10n.t(
    'Text in the files, or empty to search by name and properties only. Words match any of them; use AND for all of them and "quotes" for a phrase. Only files match.',
  ),
  SearchContentInvalid: l10n.t(
    "The text can't start with * or ?. Wildcards can follow other characters.",
  ),
  SearchRefinePlaceholder: l10n.t(
    "Optionally narrow the search, then press Enter",
  ),
  SearchOnlyFiles: l10n.t("Only files"),
  SearchOnlyFolders: l10n.t("Only folders and contexts"),
  SearchOwnedByMe: l10n.t("Owned by me"),
  SearchCheckedOutByMe: l10n.t("Checked out by me"),
  SearchSigned: l10n.t("Signed (latest version)"),
  SearchModified7: l10n.t("Modified in the last 7 days"),
  SearchModified30: l10n.t("Modified in the last 30 days"),
  SearchEverything: l10n.t(
    "The search has no conditions and lists the whole repository, up to 500 items. Search anyway?",
  ),
  SearchEverythingButton: l10n.t("Search"),
  SearchNoResults: l10n.t("No items match the search."),
  SearchResultCount: l10n.t("{count} item(s) found."),
  SearchMoreResults: l10n.t(
    "The first {count} of {total} matching items. Narrow the search to see the others.",
  ),
  SearchMayHaveMore: l10n.t(
    "{count} item(s) found. The content search stopped at its limit, so more files may match: narrow the search.",
  ),
  SearchError: l10n.t("Unable to search the repository. {message}"),
  SearchIn: l10n.t("in"),
  AuditStep: l10n.t("Search Audit History ({step}/{total})"),
  AuditSearching: l10n.t("Searching the audit history..."),
  AuditError: l10n.t("Unable to read the audit history. {message}"),
  AuditNamePrompt: l10n.t(
    "Name of the item. * matches any characters and ? one character; case is ignored. Leave empty for any name.",
  ),
  LocationPlaceholder: l10n.t(
    "Where the items are: a folder includes its subfolders",
  ),
  LocationSelected: l10n.t("selected folder"),
  LocationAnywhere: l10n.t("Anywhere in the repository"),
  LocationKeep: l10n.t("as in the last search"),
  LocationChooseFolder: l10n.t("Choose a Folder..."),
  LocationEnterPath: l10n.t("Enter a Path..."),
  LocationPathPrompt: l10n.t(
    "Repository path of the folder, such as /Acme/Study1",
  ),
  LocationPathInvalid: l10n.t("Enter a path that starts with /."),
  AuditActionsPlaceholder: l10n.t(
    "Select the actions to find, or none for any action",
  ),
  AuditModesPlaceholder: l10n.t(
    "Select the modes to find, or none for any mode",
  ),
  AuditPeriodPlaceholder: l10n.t("When the actions took place"),
  AuditLastDay: l10n.t("Last 24 hours"),
  AuditLast7Days: l10n.t("Last 7 days"),
  AuditLast30Days: l10n.t("Last 30 days"),
  AuditLast90Days: l10n.t("Last 90 days"),
  AuditAnyTime: l10n.t("Any time"),
  AuditCustomRange: l10n.t("Custom Range..."),
  AuditFromPrompt: l10n.t("First day (YYYY-MM-DD)"),
  AuditToPrompt: l10n.t("Last day (YYYY-MM-DD), or empty for today"),
  AuditDateInvalid: l10n.t("Enter a date as YYYY-MM-DD."),
  AuditNothingToExport: l10n.t(
    "Show an audit history first: Show Audit History on an item, or Search Audit History.",
  ),
  AuditExportTitle: l10n.t("Export Audit History"),
  AuditExported: l10n.t('Saved the audit history to "{path}".'),
  AuditExportError: l10n.t("Unable to save the audit history. {message}"),
};

/** Labels of the audit history report, its CSV and its search. */
export const AuditLabelText: AuditReportLabels & {
  item: string;
  any: string;
  from: string;
  to: string;
} = {
  title: l10n.t("Audit History"),
  query: l10n.t("Search"),
  entries: l10n.t("Audit records"),
  date: l10n.t("Date"),
  user: l10n.t("Acted on by"),
  action: l10n.t("Action"),
  object: l10n.t("Object"),
  name: l10n.t("Name"),
  location: l10n.t("Location"),
  mode: l10n.t("Mode"),
  details: l10n.t("Changes"),
  attribute: l10n.t("Attribute"),
  oldValue: l10n.t("Old value"),
  newValue: l10n.t("New value"),
  none: l10n.t("No audit records match."),
  generated: l10n.t("Generated"),
  count: l10n.t("{shown} of {total} records, newest first."),
  truncated: l10n.t(
    "Only the newest records are listed. Narrow the search to see older ones.",
  ),
  detailsLimited: l10n.t("Changes are shown for the first {count} records."),
  scope: l10n.t(
    "SAS Clinical Acceleration lists administrators the actions of all users, and other users only their own actions.",
  ),
  modes: {
    USER: l10n.t("User"),
    ADMIN: l10n.t("Administrative"),
    SYSTEM: l10n.t("System"),
  },
  objectTypes: {
    FILE: l10n.t("File"),
    JOB_FILE: l10n.t("Job file"),
    FOLDER: l10n.t("Folder"),
    CONTEXT: l10n.t("Context"),
  },
  item: l10n.t("Item"),
  any: l10n.t("Any"),
  from: l10n.t("From"),
  to: l10n.t("To"),
};

/** Whether a file is signed, as the Properties view and reports say it. */
export const SigningStatusText: Record<SigningStatus, string> = {
  NONE: l10n.t("Not signed"),
  CURRENT: l10n.t("Signed"),
  PREVIOUS: l10n.t("Earlier versions signed"),
  BOTH: l10n.t("Signed, and earlier versions"),
};

/** Labels of the signature history report and its CSV export. */
export const SignatureKeyLabelText: SignatureKeyLabels = {
  title: l10n.t("Enable Signatures"),
  description: l10n.t(
    "Open an authenticator app, then scan the QR code to link SAS Clinical Acceleration Repository to the app, which enables you to sign files.",
  ),
  steps: [
    l10n.t(
      "On your mobile device, open an authenticator app, such as Microsoft Authenticator or Google Authenticator.",
    ),
    l10n.t("Add an account, and scan the QR code."),
    l10n.t(
      "When you sign files, enter the PIN that the app shows for SAS Clinical Acceleration Repository.",
    ),
  ],
  alt: l10n.t("QR code"),
  note: l10n.t(
    "Close this tab when you are done. The QR code is not kept, and the tab closes on its own after 10 minutes. To link another app, generate a new QR code.",
  ),
};

export const SignatureLabelText: SignatureReportLabels = {
  title: l10n.t("Signature History"),
  file: l10n.t("File"),
  location: l10n.t("Location"),
  version: l10n.t("Version"),
  status: l10n.t("Signatures"),
  signatures: l10n.t("Signatures"),
  date: l10n.t("Date signed"),
  signedBy: l10n.t("Signed by"),
  userId: l10n.t("User ID"),
  role: l10n.t("Role"),
  reason: l10n.t("Reason"),
  comment: l10n.t("Comment"),
  none: l10n.t("No signatures."),
  latestOnly: l10n.t(
    "Signatures of the latest version. The signatures of earlier versions are in their version history: select a signed version in the Version History view.",
  ),
  generated: l10n.t("Generated"),
  statuses: SigningStatusText,
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
  permissions: l10n.t("Your permissions"),
  privileges: l10n.t("Your versioning privileges"),
  noPermissions: l10n.t("None"),
  privilegeEnable: l10n.t("Enable versioning"),
  privilegeManage: l10n.t("Manage versioning"),
  signatures: l10n.t("Signatures"),
  signingStatuses: SigningStatusText,
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

/** Why a file can't be checked in, in one sentence. */
export function describeCheckInBlock(block: CheckInBlock): string {
  switch (block.reason) {
    case "notCheckedOut":
      return l10n.t(Messages.CheckInNotCheckedOut, { name: block.name });
    case "checkedOutByOther":
      return l10n.t(Messages.CheckInCheckedOutByOther, {
        name: block.name,
        user: block.by ?? "?",
      });
    default:
      return l10n.t(Messages.CheckInNotOffered, { name: block.name });
  }
}

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
