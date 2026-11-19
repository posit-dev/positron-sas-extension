---
name: sas-lsaf
description: >
  Working with SAS Life Science Analytics Framework (LSAF) in Positron: the
  Repository, Workspace and Jobs views in the LSAF sidebar. Use when the user
  asks about LSAF, files in the LSAF repository or their LSAF workspace,
  checking files out or in, versions, running LSAF jobs (.job) or a SAS
  program on LSAF, job manifests (.mnf) and logs, or why an LSAF action is
  missing. Triggers: "LSAF", "Life Science Analytics Framework", "check out",
  "check in", "my workspace", "repository", "run the job", "run on LSAF",
  "manifest", "where is the log", "sign in to LSAF", "delete in LSAF".
---

# SAS Life Science Analytics Framework (LSAF) in Positron

The SAS extension adds an **LSAF** sidebar (its own icon in the activity bar)
when an LSAF server is configured and answers like LSAF. The server comes from
the `SAS.lsaf.url` setting, or the `SAS_LSAF_URL` environment variable when the
setting is empty. It does not depend on the active SAS profile, and it has its
own sign-in: **Sign In** in the views, or **SAS LSAF: Sign In** in the Command
Palette.

If the sidebar is missing, `SAS.lsaf.url` is empty or wrong, or the server
did not answer. The **SAS LSAF** output channel shows what was checked.
**SAS LSAF: Refresh** checks again.

LSAF support was built from the LSAF REST API specification and has not been
tested with a live LSAF server. If something fails, the **SAS LSAF** output
channel has the server's answer. Suggest reporting an issue with it.

These actions are mouse and context-menu driven. Guide the user through the
steps; there are no tools to run them.

## The two places files live

- **Repository:** the shared, controlled store of contexts (studies),
  folders and files. Files open read-only.
- **Workspace:** the user's own area. Files are editable, and saving an editor
  saves the file back to the workspace. Workspace files sit at the same paths
  as their repository files.

A file moves between them like this:

1. **Check Out** a repository file (right-click it in the Repository view, or
   in the Workspace view if a copy is there). If the workspace has a copy, the
   user chooses to keep it or replace it with the repository version.
   **Copy to Workspace** gets a copy without claiming the file. A copy can't
   be checked in.
2. **Edit** the file in the Workspace view.
3. **Check In...** (either view) asks for the version of a versioned file
   (next major, which is the default, next minor, or a specific one such as
   2.3) and an optional comment. **Undo Check Out** gives up the check-out.

A checked-out file shows a **CO** badge: highlighted for the user's own,
dimmed for another user's. Only the person who checked a file out can check
it in. A workspace file that is **not in repository** gets **Add to
Repository...**, which asks whether to version it.

## Versions and properties

Right-click a repository file:

- **Version History...** opens a version, or compares it with the latest or
  with the workspace copy.
- **Properties** shows the details, versions and signatures in the Viewer.

Signing, versioning changes and permissions are not available from Positron.

## Jobs

- **Run Job** on a `.job` file (either view, or the editor title bar) runs it.
  A repository job runs as a published job and checks its outputs in.
  **Run Job with Parameters...** takes `NAME=value` entries; LSAF can't list a
  job's parameters, so the user types them.
- **Run on LSAF** (the Run menu of a `.sas` file opened from the Workspace
  view) creates `<program>.job` next to the program, or reuses it, and runs it.
- The **Jobs** view lists runs started from Positron on this computer, with
  their state. Expand a finished run for its manifest (`.mnf`), log and
  listing. **Open Log**, **Open Manifest**, **Run Again** and **Remove from
  List** are on the right-click menu. A message offers the log when a run ends.
- Running a `.sas` file in the SAS console works too, but LSAF keeps no record
  of it.

## What the LSAF REST API can't do

When the user asks for one of these, explain the gap and the workaround:

- **Delete or rename** files or folders: use the LSAF web application.
- **See all runs**, including runs started elsewhere or by schedules: the Jobs
  view shows only runs started from Positron on this computer. Use the LSAF
  web application.
- **Cancel a run**: use the LSAF web application.
- **Find the log**: the manifest format isn't documented. The extension takes
  `.log` paths from the manifest, or new `.log` files in the job's folder. If
  none is found, open the manifest and look there.
- **Folders with more than 10,000 items** show only the first 10,000.
- **Sign files, change versioning or permissions**: use the LSAF web
  application.
- **Check permissions in advance**: the API can't, so actions are offered to
  everyone and LSAF refuses those the user may not do.

## Datasets

A `.sas7bdat` or `.xpt` file from either view opens in the Data Explorer. The
extension first copies it into the WORK library of the SAS console, so a SAS
console must be running.
