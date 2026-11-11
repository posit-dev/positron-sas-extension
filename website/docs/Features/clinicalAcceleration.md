---
sidebar_position: 10
---

# SAS Clinical Acceleration

SAS Clinical Acceleration stores clinical study files in a controlled repository on a SAS Viya server. The Positron SAS extension adds views to their own **Clinical Acceleration** sidebar, next to the **SAS** one in the activity bar, so that you can browse the repository, work on files in your own workspace, check them back in, and run clinical jobs.

The **Clinical Acceleration** icon appears in the activity bar, and the views with it, when the active SAS profile is a SAS Viya profile, you are signed in, and the server runs the Clinical Repository service. The extension finds the service on its own and uses your SAS Viya sign-in, so there is nothing to configure.

## The views

- **Clinical Repository**: the shared store. Files open read-only.
- **Clinical Workspace**: your own area on the server. Files open for editing, and saving a file saves it to your workspace.
- **Clinical Jobs**: your clinical job runs and what each run used and wrote.
- **Clinical Job Schedules**: your schedules that run clinical jobs at set times.

**Clinical Jobs** and **Clinical Job Schedules** appear when the server also runs SAS Clinical Job Management.
- **Clinical Repository Properties** (collapsed at first): the details of the item you select in the **Clinical Repository** view.
- **Clinical Version History** (collapsed at first): the versions of the file you select in the **Clinical Repository** view.

To refresh the **Clinical Repository** view and detect the service again, click **Refresh** in the title bar of the view.

## Browse the repository

Expand folders in the **Clinical Repository** view and click a file to open it read-only. Studies and organizations appear as top-level items. Administrators manage organizations, so you cannot rename or delete them.

Right-click an item to see the actions you can use. The extension shows an action that changes an item only where you have write permission.

- **New Folder**: create a folder in the selected folder.
- **Rename**: rename a file or folder.
- **Delete**: move the selected items to the recycle bin of the Clinical Repository. You can restore them with the Manage Data Repository application of SAS Clinical Acceleration. You cannot delete studies or organizations.
- **Upload** and **Upload and Expand**: add files to a folder. **Upload and Expand** unpacks a zip file into the folder.
- **Download**: save the selected items to your computer. A folder or a selection of several items arrives as a zip file.
- **Copy Path**: copy the repository path of the selected items.

An upload asks for an optional comment and an optional version. Leave the version empty to upload without versioning, which works without any special privilege. Enter a version such as `1.0` to create a versioned file. You can also enter `MAJOR` or `MINOR` to raise the version of a file that is already versioned.

## Work in your workspace

Your workspace is a private area on the server. Files in the repository stay unchanged until you check in your changes from the workspace.

### Get files into the workspace

Right-click an item in the **Clinical Repository** view and use one of these actions:

- **Check out to Workspace > With Content**: reserve the file for yourself and copy its content to the workspace.
- **Check out to Workspace > Without Content**: reserve the file without copying its content to the workspace.
- **Copy to Workspace > Copy Latest Version**: copy the current version of a file without reserving it. On a folder, the action is **Copy Folder** and copies the files in it.
- **Copy to Workspace > Copy Folder Structure**: copy the folders, with their subfolders, but not the files.

To copy an older version, right-click it in the **Clinical Version History** view and select **Copy to Workspace**.

A checked-out file has a **CO** badge in both the **Clinical Repository** and **Clinical Workspace** views. The badge is highlighted for your own check-outs and dimmed for check-outs by other users. Point to the badge to see who has the file.

### Edit and organize files

Click a file in the **Clinical Workspace** view to edit it. Save the file as usual to send the changes to your workspace. Right-click a file or folder for these actions:

- **New File** and **New Folder**: create an item in the selected folder. Without a selection, the item goes to the top level of the workspace.
- **Rename**: rename an item. The extension closes the open editors of the item, and reopens a renamed file.
- **Delete**: remove the selected items from your workspace. This does not change the repository.
- **Upload**, **Upload and Expand**, and **Download**: move files between your computer and the workspace.
- **Copy Path**: copy the workspace path of the selected items.

### Check in

When your changes are ready, right-click a file or folder in the **Clinical Workspace** view and select **Check In**. For a folder, the extension checks in every eligible file in it. The extension asks only the questions that apply to your files:

1. For files that are new to the repository, whether to enable versioning, and the first version.
2. For files that you checked out without versioning, the same two questions.
3. For files that are already versioned, whether to raise the **Major** or **Minor** version.
4. An optional comment.

Select **Undo Check out** to give up your changes to a checked-out file. Only the person who checked out a file can check it in or undo the check-out.

A copy from **Copy to Workspace** cannot replace a file that is already in the repository, because only a check-out lets you add a version. When you try, the extension says which files it left out and why: a copy that is not checked out to you, or a file checked out by someone else. To check in a changed copy, check the file out first with **Check out to Workspace > Without Content**, which leaves your workspace file as it is. The **SAS Clinical Repository** output channel lists every file that was left out.

## Versions

Select a versioned file in the **Clinical Repository** view and the **Clinical Version History** view lists its versions, newest first. Point to a version to see who created it, when, its size, and its comment.

Click a version to open it read-only. Right-click a version to download it, compare it, or copy it to your workspace.

To turn versioning on or off for a file, right-click it in the **Clinical Repository** view and select **Enable Versioning** or **Disable Versioning**. Changing versioning needs a versioning privilege on the server. The extension stops and tells you when the server reports that you have no such privilege.

The **Clinical Repository Properties** view shows the details of the selected item. For a file, it lists the size, the lock state, the version, the check-out state, and whether the copy of the file in your workspace is in sync with the repository.

For files and folders, it also lists **Your permissions**, the permissions the server grants you on the item, such as `READ` and `WRITE`, and **Your versioning privileges**. They explain a missing action: without `WRITE` on a file, for example, **Check out to Workspace** is not offered. Permissions can differ between folders, and adding new files to a folder is not the same as changing a file that is already there.

## Compare files and versions

You can compare any two files or versions from the repository, your workspace, and the version history.

1. Right-click the first file or version and select **Select for Compare**.
2. Right-click the second one and select **Compare with Selected**.

To compare two items in the same view, select both, right-click one of them, and select **Compare Selected**.

## Run programs and open datasets

Open a `.sas` file from the **Clinical Workspace** or **Clinical Repository** view and run it as you run any SAS program. The program runs in the SAS console session of the active profile. Running a program does not write its results to your workspace, and SAS Clinical Acceleration keeps no record of the run. To keep a result file, save it on your computer and upload it. To run a program with a record of its inputs and outputs, run it as a clinical job, as described in [Run a program as a clinical job](#run-a-program-as-a-clinical-job).

A `.sas7bdat` or `.xpt` file from the **Clinical Repository** or **Clinical Workspace** view opens in the Data Explorer. The extension copies the file into the WORK library of the SAS session first, so a SAS session must be running. See [Positron SAS Extension Features](./positron.md) for more about the Data Explorer.

## Run clinical jobs

A clinical job is a `.cjob` file that lists SAS programs to run, in order, and the parameters they take. A job in the repository can also list the repository files it reads and where its outputs are checked in. SAS Clinical Acceleration runs the job on the server and writes a manifest (a `.cmnf` file) next to it. The manifest is the audit record of the run: which programs ran and how they ended, the parameter values, and every file the run read and wrote, with its version.

To run a job:

1. Right-click a `.cjob` file in the **Clinical Workspace** or **Clinical Repository** view and select **Run Clinical Job**. With a `.cjob` file open in the editor, you can also click **Run Clinical Job** in the editor title bar.
2. Enter a value for each parameter of the job. The prompts start with the default values of the job. For a file or folder parameter, pick the file or folder from the view the job is in.
3. A notification shows the state of the run. To cancel the run, click **Cancel** in the notification.

When the run ends, a notification says how it ended, with buttons to open the log, the results, and the manifest report. A job writes its log (`.log`), listing (`.lst`), and manifest next to the job file unless the job names other locations.

### Run a program as a clinical job

To run a single `.sas` program from your workspace as a clinical job, right-click it in the **Clinical Workspace** view and select **Run as Clinical Job**. With the program open in the editor, you can also select **Run as Clinical Job** from the **Run** menu in the editor title bar or from the context menu of the editor.

The first time, the extension creates a job with the name of the program next to it, such as `adsl.cjob` for `adsl.sas`, and runs it. Later runs reuse that job. Unsaved changes in the editor are saved first, because the job runs the file on the server. If a job of that name already exists and runs other programs, you can create a new job, such as `adsl-2.cjob`, or replace the existing one.

The job and its log, listing and manifest are written to your workspace. To keep a record in the repository, check in the job and the program, and run the job from the **Clinical Repository** view.

### Create and edit jobs

A `.cjob` file opens in the clinical job editor, a form with these sections:

- **General**: the description of the job.
- **Programs**: the programs the job runs, in order. Click **Add Program...** to pick a program, use the arrows to change the order, and click **Open** to open a program. Leave **Version** empty to run the latest version of a program.
- **Parameters**: the values asked for when the job runs. The programs see them as macro variables, so a name must be a valid SAS name. Each parameter has a type (text, masked text, number, date, file, or folder) and an optional default.
- **Output locations**: the folders for the log, the results, and the manifest. `./` is the folder of the job.
- **Repository runs**: the repository files and folders the job reads, and how its outputs are checked in. These settings apply only when the job runs from the **Clinical Repository** view.

Paths of programs and output locations are stored relative to the job, as SAS Clinical Acceleration stores them. The editor checks the job as you edit it and lists problems, such as a job without programs or an invalid parameter name, above the form.

Save the job as you save any file. Undo and redo work as in a text editor. Click **Run** to save and run the job, or **Open as JSON** to edit the file as text.

To create a job, right-click a folder in the **Clinical Workspace** view, select **New Clinical Job...**, and enter a name. The job opens in the editor.

Jobs in the **Clinical Repository** view open read-only. To change one, copy it or check it out to your workspace.

### The Clinical Jobs view

The **Clinical Jobs** view lists your runs, newest first, with their state. Runs that have not ended update on their own while the view is visible. Click **Load more...** at the end of the list for older runs.

Expand a run to see its manifest:

- **Programs**: each program with its result (such as successful, warnings, or errors) and run time.
- **Parameters**: the values the run used.
- **Inputs** and **Outputs**: the files the run read and wrote. Hover over a file to see its path, version, size and checksum (MD5, repository files only).
- **Logs** and **Results**: the log and listing of the run.
- **Check-in failures**: outputs of a repository job that were not checked in.

Click a file to open it. A versioned repository file opens at the version the run used.

Right-click a run for more actions:

- **Show Manifest Report** and **Export Manifest...**: show or save the manifest report, described in the next section.
- **Open Log** and **Open Results**: open the log or the results of the run.
- **Open Job**: open the job file.
- **Run Again**: run the job again with the same parameter values, without prompts.
- **Cancel Run**: cancel a run that has not ended.
- **Copy Run ID**: copy the ID of the run, for example for an administrator.
- **Remove from List**: hide the run in Positron. You can select several runs and remove them together.

To hide every finished run, click **Clear Finished Runs** in the title bar of the view. Runs that are still going stay in the list. Hidden runs are hidden only in Positron, for your user on that server: the run history on the server, with its manifests, stays as it is. To see hidden runs again, click **Show Hidden Runs** in the title bar; they are marked as hidden, and **Restore to List** brings one back. **Restore All Hidden Runs** is in the **...** menu of the view.

:::info note

A run of a repository job checks its outputs in to the repository. If an output file is checked out, or you lack write permission for its folder, the run ends with a check-in error, and **Check-in failures** lists the files. The outputs of a workspace job stay in your workspace.

:::

### Schedule jobs

A schedule runs a job at set times, with set parameter values, under your user. To create one:

1. Right-click a `.cjob` file in the **Clinical Workspace** or **Clinical Repository** view and select **New Schedule...**. You can also click **Schedule...** in the clinical job editor, or **New Schedule** (the plus sign) in the title bar of the **Clinical Job Schedules** view and pick the job.
2. Enter a name for the schedule.
3. Select when the job runs, and answer the questions for that choice:
   - **Once** or **On several dates**: the dates and the time of day.
   - **Every few minutes** or **Hourly**: the interval, and for hourly runs the minute of the hour.
   - **Daily** or **Weekly**: the interval in days or weeks, the days of the week for weekly runs, and the time of day.
   - **Monthly** or **Yearly**: the month for yearly runs, either a day of the month (such as the 15th) or a weekday (such as the first Monday), and the time of day. Monthly runs also take an interval in months.
4. For repeated runs, enter the first day and when the schedule ends: never, on a date, or after a number of runs.
5. Confirm the time zone. It defaults to the time zone of your computer.
6. Enter the parameter values of the job.

A notification shows the next run. The **Clinical Job Schedules** view lists your schedules with when they run. Expand a schedule to see its job, its parameter values, and its next runs, as the server calculates them.

Right-click a schedule for more actions:

- **Run Now**: run the job now with the parameter values of the schedule. The run appears in the **Clinical Jobs** view.
- **Edit Schedule...**: change the name, the times, the time zone, or the parameter values. The questions start with the current values.
- **Disable Schedule** and **Enable Schedule**: stop and resume the runs without deleting the schedule.
- **Delete Schedule...**: delete the schedule. The job itself is kept.
- **Copy Schedule ID**: copy the ID of the schedule.

A schedule whose job was deleted, or that you can no longer read, is marked with a warning.

The view lists the schedules that run as you. To see the schedules of all users that the server shows you, click **Show All Users' Schedules** in the title bar. Other users' schedules are marked with their owner, and you can only copy their ID. Click **Show My Schedules** to go back.

### The manifest report

The manifest report shows the manifest of a run as one page, for review or for a quality check. It lists the job, how the run ended, who ran it and when, the parameter values, the programs with their results and run times, and each input and output file with its version, size, modification time, and MD5 checksum. For a repository job, it also shows how outputs are checked in and which outputs failed to check in.

To show the report, do one of the following:

- Click **Show Manifest Report** on a run in the **Clinical Jobs** view.
- Click **Show Manifest** in the notification at the end of a run.
- Right-click a `.cmnf` file in the **Clinical Workspace** or **Clinical Repository** view and select **Show Manifest Report**.

In Positron, the report opens in the Viewer, where Posit Assistant can read it. Click a path in the report to open that file. A versioned repository file opens at the version the run used. Ask the Assistant, for example, which version of a dataset a run read.

To save the report, select **Export Manifest...** in the same places. Save it as an `.html` file for the report, or as a `.json` file for the manifest as the server returns it. The paths in an exported report are not links.

:::info note

The server returns the manifest of a run only while its `.cmnf` file is unchanged. The next run of the same job overwrites that file, so the report of the earlier run is no longer available. Export the report of a run to keep it.

:::

## Permissions and errors

The extension reads your permissions from the server and shows only the actions you can use. If it cannot read them, it shows all actions and the server decides.

:::info note

A server can still refuse an action, such as a check-out without write permission or a versioning change without the privilege. This is the server enforcing its rules. The **SAS Clinical Repository** output channel lists the message from the server. **Clinical Repository Properties** shows your permissions on the selected item. Ask a SAS Clinical Acceleration administrator for the missing permission.

:::

## Limitations

- The views use the active SAS Viya profile. Switch profiles to work with another server.
- The views do not detect changes made by other users or other applications. Click **Refresh** to see them.
- You cannot search the repository, restore deleted items, or change permissions. Use SAS Clinical Acceleration for those tasks.
