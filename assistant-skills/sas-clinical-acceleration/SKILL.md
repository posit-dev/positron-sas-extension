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

A copy made with **Copy to Workspace** can't be checked in over the repository
file: only a check-out lets the user add a version. The extension says so and
lists the files it left out in the **SAS Clinical Repository** output channel.
To keep the changed copy, check the file out with **Check out to Workspace >
Without Content**, which leaves the workspace file as it is, then check in.

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
  including whether the workspace copy is in sync, **Your permissions** on it
  (such as `READ` and `WRITE`) and **Your versioning privileges**.

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
- **Run one program as a job:** right-click a `.sas` file in the Clinical
  Workspace view (or use the editor's Run menu or context menu) and choose
  **Run as Clinical Job**. The first time, it creates `<program>.cjob` next to
  the program and runs it; later runs reuse it. Unsaved editor changes are saved
  first. This is the quickest way to get an audited run of a program. The job
  and its outputs stay in the workspace; for a repository record, check in the
  job and program and run the job from the Clinical Repository view.
- **Repository runs see only Publish Setup:** a job run from the repository
  runs in a transient workspace that holds only the files and folders in the
  job's Publish Setup ("Repository runs" in the job editor) and its file and
  folder parameters. A job that works in the workspace but fails from the
  repository with missing datasets or libraries usually lacks those inputs.
  Paths in programs should use `&_SASWS_` (the workspace root, set in every
  job run), such as `libname sdtm "&_SASWS_/Study/data/sdtm";`.
- **Run and populate:** right-click a `.cjob` in the Clinical Workspace view
  and choose **Run and Populate Clinical Job...** (or **Run and Populate...**
  in the job editor). The user picks relative paths (`./`, `../`; the job can
  be copied to a folder with the same structure) or absolute paths. If the run
  succeeds, Publish Setup is replaced with the files the programs read and the
  folders they wrote, and all check-in locations are removed (add them again
  in the editor); programs and parameters stay. A failed run leaves the job
  unchanged. Workspace jobs only: the service refuses repository jobs. Use it
  before checking a job in, so its repository runs get their inputs.
- **Test a job:** right-click a `.cjob` in the Clinical Workspace view and
  choose **Test Clinical Job...** (or **Test...** in the job editor). It runs
  the workspace job as if from the repository: programs and inputs are read
  from their repository locations, and file and folder parameters are picked
  in the repository. Only the log, listing and manifest are written, to the
  workspace; nothing is checked in and no audit record is made. A passed test
  means the job should run from the repository, but check-in problems
  (write permission, versioning privilege) can still occur. Suggested order:
  Run and Populate, check the job and its programs and inputs in, Test, then
  run from the repository.
- **Create and edit jobs:** a `.cjob` opens in the clinical job editor, a form
  with General (description), Programs (ordered, optional version; empty means
  latest), Parameters (name, label, type, default; names must be valid SAS
  names because programs see them as macro variables), Output locations
  (relative to the job, `./` is its folder) and Repository runs (inputs and
  check-in, used only when the job runs from the repository). Save like any
  file; **Run** saves and runs, **Open as JSON** shows the text. Create a job
  with **New Clinical Job...** on a Clinical Workspace folder. Repository jobs
  open read-only: copy or check them out to the workspace to change them.
- **Review runs:** the **Clinical Jobs** view lists the user's runs, newest
  first. Expanding a run shows its manifest: Programs (state and run time),
  Parameters, Inputs, Outputs, Logs, Results, and Check-in failures. A
  versioned repository file opens at the version the run used. Right-click a
  run for **Run Again** (same values, no prompts), **Open Job**, **Cancel Run**,
  **Copy Run ID** and **Remove from List**. **Clear Finished Runs** (view
  title) hides all finished runs. Hiding is only in Positron, per user and
  server; the run history on the server stays. **Show Hidden Runs** and
  **Restore to List** bring them back.
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
- **Schedules:** **New Schedule...** on a `.cjob` (Clinical Workspace or
  Clinical Repository view, the job editor's **Schedule...** button, or the +
  of the **Clinical Job Schedules** view) asks for a name, when to run (once,
  several dates, every few minutes, hourly, daily, weekly, monthly or yearly,
  by day number or by weekday such as the first Monday), the first day and
  end for repeated runs, the time zone (default: the computer's) and the
  parameter values. The **Clinical Job Schedules** view lists schedules with
  their timing; expanding one shows its job, values and next runs as the
  server calculates them, which is how to check that a schedule does what
  was meant. Right-click for **Run Now**, **Edit Schedule...**, **Disable** /
  **Enable Schedule**, **Delete Schedule...** (keeps the job) and **Copy
  Schedule ID**. Schedules run under the user who created them. The view lists
  the user's own schedules; **Show All Users' Schedules** lists everyone's
  (marked with the owner, read-only).

The Clinical Jobs and Clinical Job Schedules views appear only when the server
also runs SAS Clinical Job Management.

## When something is refused

Actions that change things appear only where the user has permission. A server
can still refuse an action, for example a check-out without write permission or
a versioning change without the privilege. That is the server enforcing its
rules and not a fault in the extension. The **SAS Clinical Repository** output
channel lists what the server said. Ask the user to read it out, then suggest
asking a Clinical Acceleration administrator for the permission.

If an action is missing from a menu, such as **Check out to Workspace**, ask the
user to select the item and read **Your permissions** in Clinical Repository
Properties. Without `WRITE` on the file, check-out isn't offered, in SAS Studio
either. Being able to add new files to a folder doesn't mean the user may change
files that are already there.

Delete in the Clinical Repository moves items to a recycle bin; they can be
restored with the Manage Data Repository application of SAS Clinical
Acceleration. Delete in the workspace removes only the workspace copy.
