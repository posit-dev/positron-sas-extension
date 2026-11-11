---
name: sas-clinical-acceleration
description: >
  Working with SAS Clinical Acceleration (CA) in Positron: the Clinical
  Repository, Clinical Workspace, Clinical Repository Properties, Clinical
  Version History and Clinical Jobs views in the Clinical Acceleration sidebar. Use when the user asks about files
  in the Clinical Repository or their CA workspace, checking files out or in,
  versioning, comparing versions, copying repository files into the workspace,
  running SAS programs and opening SAS datasets that live in CA, or running
  clinical jobs (.cjob) and reviewing their runs and manifests (.cmnf).
  Triggers: "check out", "check in", "clinical repository", "my workspace",
  "version history", "enable versioning", "copy to workspace", "open this
  sas7bdat from the repository", "clinical job", "run the job", "manifest",
  "audit trail", "which inputs did the run use".
---

# SAS Clinical Acceleration in Positron

The SAS extension adds its views to their own **Clinical Acceleration** sidebar (a separate
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

## Clinical jobs: runs with an audit record

Running a `.sas` file in the console leaves no record in CA. For a run that CA
records, use a **clinical job**: a `.cjob` file that lists programs to run in
order and their parameters. Each run writes a **manifest** (`.cmnf`) next to
the job: which programs ran and how they ended, the parameter values, and every
input and output file with its version (and MD5 checksum for repository files).
That manifest is the audit trail.

- **Run a job:** right-click a `.cjob` in the Clinical Workspace or Clinical
  Repository view and choose **Run Clinical Job** (or use the editor title
  button on an open `.cjob`). The extension prompts for each parameter,
  pre-filled with its default. A notification follows the run; its **Cancel**
  cancels the run. When it ends, **Open Log** and **Open Results** open the
  `.log` and `.lst` the job wrote next to itself.
- **Review runs:** the **Clinical Jobs** view lists the user's runs, newest
  first. Expanding a run shows its manifest: Programs (state and run time),
  Parameters, Inputs, Outputs, Logs, Results, and Check-in failures. A
  versioned repository file opens at the version the run used. Right-click a
  run for **Run Again** (same values, no prompts), **Open Job**, **Cancel Run**
  and **Copy Run ID**.
- **Manifest report:** **Show Manifest Report** (on a run in the Clinical Jobs
  view, on a `.cmnf` file, or in the end-of-run notification) opens the
  manifest as an HTML page in the Viewer, which you can read: the job, state,
  who ran it, parameter values, programs with result and time, and each input
  and output with path, version, size, modification time and MD5. Use it to
  answer audit questions such as "which version of adsl did this run read?".
  **Export Manifest...** saves it as `.html` or `.json`. A run's manifest is
  only available while its `.cmnf` is unchanged; the next run of the same job
  overwrites it, so suggest exporting reports that must be kept.
- **States:** a run ends as successful, with program warnings or errors,
  failed, canceled, or with a *check-in error*. A check-in error means a
  repository job ran but some outputs were not checked in (an output was
  checked out, or the user lacks write permission). The Check-in failures group
  lists them.
- Jobs cannot be created or edited in Positron yet, and schedules are not
  shown. Point the user to SAS Clinical Acceleration for that.

The Clinical Jobs view appears only when the server also runs SAS Clinical Job
Management.

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
