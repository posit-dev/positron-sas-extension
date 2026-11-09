---
name: sas-clinical-acceleration
description: >
  Working with SAS Clinical Acceleration (CA) in Positron: the Clinical
  Repository, Clinical Workspace, Clinical Repository Properties and Clinical
  Version History views in the Clinical Acceleration sidebar. Use when the user asks about files
  in the Clinical Repository or their CA workspace, checking files out or in,
  versioning, comparing versions, copying repository files into the workspace,
  or running SAS programs and opening SAS datasets that live in CA. Triggers:
  "check out", "check in", "clinical repository", "my workspace", "version
  history", "enable versioning", "copy to workspace", "open this sas7bdat from
  the repository".
---

# SAS Clinical Acceleration in Positron

The SAS extension adds four views to their own **Clinical Acceleration** sidebar (a separate
icon below **SAS** in the activity bar) when the active SAS
profile is a SAS Viya profile and the server runs SAS Clinical Acceleration. The
views use the same sign-in as the SAS Viya profile. If they are missing, the
profile is not a SAS Viya profile, the user is not signed in, or the server has
no Clinical Repository service.

These actions are mouse and context-menu driven. There are no commands to run
for them from a tool, so guide the user through the steps.

## The two places files live

- **Clinical Repository:** the shared, controlled store. Files open read-only.
  Changes go through the workspace.
- **Clinical Workspace:** the user's own area on the server. Files here are
  editable, and saving an editor saves the file back to the workspace.

A file moves between them like this:

1. **Copy or check out** a repository file to the workspace. In the Clinical
   Repository view, right-click and choose **Check out to Workspace** (with or
   without content) to claim the file for editing, or **Copy to Workspace** to
   get a copy without claiming it.
2. **Edit** the file in the workspace.
3. **Check in** from the Clinical Workspace view (**Check In...**). The extension
   asks only what it needs: whether to version new files and with which
   version, **Major** or **Minor** for already versioned files, and a comment.
   **Undo Check out** gives up the changes.

A checked-out file shows a **CO** badge: highlighted for the user's own, dimmed for
another user's. Only the person who checked a file out can check it in.

## Versions

- **Enable Versioning...** and **Disable Versioning...** (Clinical Repository
  view, files only) need a versioning privilege on the server.
- **Clinical Version History** lists the versions of the selected file. Select
  one to open it read-only. Right-click to download it, compare it, or copy that
  version to the workspace.
- **Select for Compare**, then **Compare with Selected**, compares any two files
  or versions, across the repository, the workspace and the history. With two
  items selected, **Compare Selected** compares them directly.
- **Clinical Repository Properties** shows the details of the selected item,
  including whether the workspace copy is in sync.

An upload is versioned only if the user types a version in the prompt. An empty
version uploads without versioning.

## Running and opening CA files

- **Run a SAS program:** open the `.sas` file from the workspace (or the
  repository) and run it as usual. The program runs in the SAS console session
  of the active profile. Saved results are not written back to CA by the run.
  Check in files that the user wants in the repository.
- **Open a dataset:** a `.sas7bdat` or `.xpt` file from the repository or the
  workspace opens in the Data Explorer (versions from the version history do not). The extension
  copies it into the SAS session's WORK library first, so a SAS session must be
  running. If it is not, ask the user to start one.

## When something is refused

Actions that change things appear only where the user has permission. A server
can still refuse an action, for example a check-out without write permission or
a versioning change without the privilege. That is the server enforcing its
rules and not a fault in the extension. The **SAS Clinical Repository** output
channel lists what the server said. Ask the user to read it out, then suggest
asking a Clinical Acceleration administrator for the permission.

Delete in the Clinical Repository moves items to a recycle bin; they can be
restored with the Manage Data Repository application of SAS Clinical
Acceleration. Delete in the workspace removes only the workspace copy.
