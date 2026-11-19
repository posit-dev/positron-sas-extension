---
sidebar_position: 10.5
---

# SAS Life Science Analytics Framework

SAS Life Science Analytics Framework (LSAF) stores clinical study files in a controlled repository, gives each user a workspace for editing them, and runs SAS programs as jobs with a record of what each run read and wrote. The Positron SAS extension adds an **LSAF** sidebar to the activity bar. Use it to browse the repository, edit files in your workspace, check them out and in, and run jobs.

The extension works with LSAF through the LSAF REST API 1.0. It doesn't need a SAS connection profile: LSAF is separate from the SAS console and from SAS Viya.

:::caution Not yet tested with a live LSAF server

LSAF support was built from the REST API's published specification and tested against a local stand-in for the API, not against a real LSAF server. Some details the specification leaves open are guesses. These are listed in [What the LSAF REST API can't do](#what-the-lsaf-rest-api-cant-do). If something doesn't work, the **SAS LSAF** output channel shows each request and the server's answer. Please [report an issue](https://github.com/posit-dev/positron-sas-extension/issues/new/choose) with what it says.

:::

## Set up

The **LSAF** sidebar stays hidden until the extension detects an LSAF server. To detect one, it needs the server's address from either of these:

- The `SAS.lsaf.url` setting. Enter the server, such as `https://lsaf.example.com`, or the full REST API address, such as `https://lsaf.example.com/lsaf/api`.
- The `SAS_LSAF_URL` environment variable, used when the setting is empty. On Posit Workbench, an administrator can set it for everyone.

The extension then asks that address whether it is an LSAF REST API. It shows the **LSAF** sidebar when the answer looks like LSAF: API metadata, or an LSAF sign-in error. If the server doesn't answer, the extension asks again after 30 seconds, then after longer waits. When you change the setting, it checks the new address.

The optional `SAS.lsaf.userId` setting fills in your user ID when you sign in.

If you use only LSAF and have no SAS connection profile, the **Sign In** button of the **SAS** sidebar is hidden while LSAF is detected: without a profile, it could only ask you to create one. Add a profile with **SAS: Add New Connection Profile** when you want a SAS console as well.

### Sign in

Open the **LSAF** sidebar and click **Sign In**, or run **SAS LSAF: Sign In** from the Command Palette. Enter your LSAF user ID and password.

The extension asks LSAF to encrypt your password, then keeps only the encrypted form, in the secret storage of Positron. LSAF sessions end after a period of inactivity. When that happens, the extension signs in again with the encrypted password without asking you. When you start Positron, it signs you in again the same way.

If the server can't encrypt passwords, the extension signs in with the password you typed but doesn't keep it. You are then asked again when the session ends.

To sign out and forget the stored password, click **Sign Out** in the **...** menu of the **Repository** or **Workspace** view.

## The views

- **Repository**: the shared, controlled store of studies, folders, and files. Files open read-only.
- **Workspace**: your own area on the server. Files open for editing, and saving a file saves it to your workspace.
- **Jobs**: the jobs you ran from Positron, with each run's manifest, log, and listing.

A file that is checked out shows a **CO** badge in both views. The badge is highlighted for your own check-outs and dimmed for other users'. Hover over a file to see who checked it out. Versioned files show their latest version, such as **v2.0**. Signed files show **signed**.

The views don't see changes made in the LSAF web application or by other users. Click **Refresh** in the title bar of a view to see them.

## Browse the repository

Expand contexts and folders in the **Repository** view. Click a file to open it read-only. Right-click an item for these actions:

- **Properties**: a report in the Viewer with the item's details. For a file, it also shows its versions and signatures, and each version links to that version's content.
- **Version History...**: pick a version of a file. Then open it, compare it with the latest version, or compare it with your workspace copy.
- **Download...**: save a file, or a folder as a zip file. With several items selected, pick a folder to save them in.
- **Copy Path**: copy the item's LSAF path.

## Work in your workspace

The **Workspace** view shows your workspace. LSAF keeps workspace files at the same paths as their repository files. For each file, the extension looks up the repository file at that path. This tells it whether the file is in the repository, whether it is versioned, and who checked it out. A file that exists only in your workspace shows **not in repository**.

### Get files into the workspace

In the **Repository** view, right-click a file and choose one of these actions:

- **Check Out**: claim the file so that only you can check in a new version. If your workspace already has a copy, choose whether to keep your copy, to check in your changes, or to replace it with the repository version.
- **Copy to Workspace**: get a copy without claiming the file. You can't check in a copy you didn't check out.

**Check Out** is also in the **Workspace** view for files that are in the repository and not checked out.

### Edit and organize files

Click a file in the **Workspace** view to edit it. Saving writes it to your workspace. Right-click a folder for these actions:

- **New File...**: create an empty file and open it.
- **New Folder...**: create a folder.
- **Upload Files...**: add files from your computer. The extension asks before it replaces files that exist.
- **Download...**: save a file, or a folder as a zip file.

### Check in

Right-click a file you checked out, in either view, and choose **Check In...**. Unsaved changes in the file's editor are saved first.

For a versioned file, choose the version to create:

- the next major version, which is the default of LSAF
- the next minor version
- a specific version, such as `2.3`

Then add an optional comment of up to 1,024 characters for the repository's history.

**Undo Check Out** gives up the check-out. Changes in your workspace that you haven't checked in don't reach the repository.

**Compare with Repository** shows the repository's latest version next to your workspace copy.

### Add new files to the repository

To add a file that exists only in your workspace, right-click it and choose **Add to Repository...**. Choose whether the file is versioned and, if so, whether it starts at version 1.0, 0.1, or a version you give. Then add an optional comment. The file is added at the same path in the repository, and any missing folders are created.

**Upload Files...** on a repository folder adds files from your computer straight to the repository, with the same choices. A file that exists gets a new version if it is versioned. If it isn't versioned, the upload replaces it, after you confirm.

## Run jobs

An LSAF job (a `.job` file) lists the programs to run and their parameters. LSAF runs it and writes a manifest (a `.mnf` file): the record of the run, with the programs, inputs, and outputs.

### Run a job

Right-click a `.job` file in either view and choose **Run Job**. A job opened in the editor has **Run Job** in its title bar. A job in the repository runs as a published job, so LSAF checks its outputs in to the repository. A job in your workspace runs in your workspace.

**Run Job with Parameters...** first asks for parameter values, one `NAME=value` at a time. Leave the box empty to run. The values replace the job's own values for this run. LSAF gives no way to read a job's parameters, so type their names as the job defines them. For a date, use a value such as `2026-06-16T00:00:00.000Z`. For a file, use a path such as `/folder/file.txt?version=2.0`.

### Run a program

To run a SAS program from your workspace with an LSAF record of the run, open it from the **Workspace** view. Then choose **Run on LSAF** in the Run menu of the editor title bar, or right-click the program and choose **Run on LSAF**. The extension saves the program and creates a job named after it next to it, such as `adsl.job` for `adsl.sas`. Then it runs the job.

If that job exists, the extension runs it as it is. It doesn't check that the job still runs the program.

To run a program interactively instead, run it in the SAS console as usual. LSAF keeps no record of console runs.

### The Jobs view

The **Jobs** view lists the runs you started from Positron, newest first, with their state:

- **Running**
- **Completed**
- **Completed with warnings**
- **Failed**
- **Canceled**
- **Finished** (a state the extension doesn't recognize)

Hover over a run to see the server's state and message, its parameters, and the submission ID.

The extension checks running runs every few seconds. When a run ends, a message offers **Open Log** and **Show Manifest**. Expand a finished run to see its manifest, log, and listing, and click one to open it.

Right-click a run for these actions:

- **Open Log**: also the icon next to the run.
- **Open Manifest**
- **Open Job**
- **Run Again**: runs the job with the same parameter values.
- **Copy Submission ID**
- **Remove from List**: removes the run from the view; the run stays in LSAF.

**Remove Finished Runs** in the title bar clears every finished run from the view.

The list is kept for each LSAF server and user, and lives on this computer only.

## Run programs and open datasets

Open a `.sas` file from either view and run it in the SAS console as you run any SAS program. Running it this way doesn't write results to LSAF, and LSAF keeps no record of the run.

A `.sas7bdat` or `.xpt` file from either view opens in the Data Explorer. The extension first copies the file into the WORK library of the SAS console, so a SAS console must be running. If none is, the extension offers to start one.

## What the LSAF REST API can't do

The LSAF REST API 1.0 covers less than the LSAF web application. The extension works around the gaps where it can.

| Gap in the REST API                                                | What it means in Positron                                                                                                                                                                                                                                       | What to do                                                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| No delete or rename                                                | The views can't delete or rename files or folders. Trying to delete or rename an LSAF file in Positron gives an error that says so.                                                                                                                             | Use the LSAF web application.                                                                                                            |
| No "create folder"                                                 | **New Folder...** uploads a zip file that holds only the new, empty folder, and the server unpacks it.                                                                                                                                                          | Nothing. If **New Folder...** fails, create the folder in the LSAF web application.                                                      |
| No list of job runs                                                | The **Jobs** view shows only the runs started from this extension on this computer. Runs started in the LSAF web application, by schedules, or on another computer don't appear.                                                                                | Use the LSAF web application to see all runs.                                                                                            |
| No way to cancel a run                                             | A running job can't be stopped from Positron.                                                                                                                                                                                                                   | Cancel it in the LSAF web application.                                                                                                   |
| No way to read a job's parameters or programs                      | **Run Job with Parameters...** can't list the parameters or show their defaults.                                                                                                                                                                                | Type the names and values. Open the `.job` file to see what it defines.                                                                  |
| The format of manifests and the location of logs aren't documented | The API gives the path of a run's manifest. The extension finds the log and listing from the `.log` and `.lst` paths in the manifest. If the manifest names none, it looks for `.log` and `.lst` files that appeared in the job's folder since the run started. | If the log isn't found, open the manifest from the **Jobs** view and look there.                                                         |
| Submission states aren't documented                                | The specification shows only the state `completed`. The extension reads failure, cancellation, and warnings from the state and its message. An unknown state that has an end time shows as **Finished**.                                                        | Hover over the run for the server's own state and message.                                                                               |
| Workspace check-in takes no comment or version                     | Check-in from the **Workspace** view uses the repository's check-in, which takes both, on the same path.                                                                                                                                                        | Nothing.                                                                                                                                 |
| Workspace listings don't show check-out state                      | For each workspace folder, the extension also lists the repository folder at the same path.                                                                                                                                                                     | Nothing. If the repository can't be read, the workspace files show no repository state or check-in actions.                              |
| No paging                                                          | A folder listing asks for up to 10,000 items. A folder with more items shows only the first 10,000, and the **SAS LSAF** output channel says so.                                                                                                                | Use the LSAF web application for such folders.                                                                                           |
| No interactive SAS session                                         | LSAF runs code only as jobs, so the SAS console can't connect to LSAF.                                                                                                                                                                                          | Use **Run on LSAF** for a recorded run, or a SAS connection profile for interactive work.                                                |
| Versions and signatures are read-only                              | You can see versions and signatures, but not sign files, change versioning, or change permissions.                                                                                                                                                              | Use the LSAF web application.                                                                                                            |
| No permissions                                                     | The extension can't tell in advance whether you may check out, check in, or upload a file, so it offers these actions to everyone.                                                                                                                              | If LSAF refuses an action, its message appears in Positron and in the **SAS LSAF** output channel. Ask an LSAF administrator for access. |

## Troubleshooting

- **The LSAF sidebar doesn't appear.** Check that `SAS.lsaf.url` or `SAS_LSAF_URL` is set and that Positron can reach the server. The **SAS LSAF** output channel shows the address the extension checked and the answer, such as `absent` when the address answered but not like LSAF, or `error` when it didn't answer. Run **SAS LSAF: Refresh** to check again.
- **You are asked to sign in again.** The stored password no longer works, for example because it was changed. Sign in with the new one.
- **An action fails.** The message shows the server's answer. The **SAS LSAF** output channel has the details.
