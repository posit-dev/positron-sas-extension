---
sidebar_position: 4.5
---

# Background Jobs

With a SAS Viya connection, you can submit a SAS program as a background job, as you can with **Background Submit** in SAS Studio. The job runs on the SAS Viya server in a compute server of its own, so the SAS console stays free for other work. It keeps running when you close Positron, and its log and listing stay on the server for you to open later.

Use a background job for a long-running program that you don't need to watch, such as one that builds a set of analysis datasets overnight.

:::info Requirements

Background jobs need a SAS Viya connection to a server that runs the SAS Job Execution service. They are not available with SAS 9.4 or local SAS. If the server lacks the service, the command and the **Background Jobs** view don't appear.

:::

## Submit a background job

1. Open a SAS program in the editor. To submit only part of it, select the code.
2. Click the arrow next to the ![running person](../../../icons/light/submitSASCode.svg#gh-light-mode-only)![running person](../../../icons/dark/submitSASCode.svg#gh-dark-mode-only) icon in the upper right corner of the editor and select **Submit as Background Job**. You can also right-click in the editor, or run **SAS: Submit as Background Job** from the Command Palette.
3. A message confirms that the job is running. Click **Show Background Jobs** to see it in the **Background Jobs** view.

When the job ends, a message says how it ended, with buttons to open the log and the results. You get this message for jobs you submitted in the current Positron window.

Unsaved changes in the editor are submitted as they are; you don't need to save the file first.

### How a background job differs from a run in the console

A background job runs in a separate SAS session, not in the session of the SAS console:

- **It does not share WORK or librefs with the console.** Datasets in your console's WORK library, and librefs and macro variables you set there, are not available to the job. Assign any libraries the program needs in the program itself, and write results you want to keep to a permanent library.
- **Its results are the SAS listing, not HTML.** The job's output is the plain-text listing, which you open with **Open Results**. To get the HTML report in the **Viewer**, run the program in the console instead.
- **It starts a new compute server.** This takes a few seconds, so a short program finishes sooner in the console.

## The Background Jobs view

The **Background Jobs** view in the **SAS** view container lists the background jobs you submitted from Positron to the active SAS Viya server, newest first, with their state, run time, and start time. Hover over a job to see its details, such as the compute context it ran in and, for a failed job, the error.

The list comes from the server, so it also shows jobs you submitted before restarting Positron or from another Positron window. Jobs that have not ended update on their own while the view is visible. Click **Load more...** at the end of the list for older jobs.

Expand a finished job to see its **Log** and its **Listing**, and click one to open it. Right-click a job for more actions:

- **Open Log**: open the SAS log. Notes, warnings, and errors are colored as in the SAS log of the console, with a SAS color theme.
- **Open Results**: open the listing.
- **Open Result File...**: choose any file the job produced, such as the log as text.
- **Show Submitted Code**: open the code the job ran.
- **Run Again**: submit the same code again.
- **Cancel Background Job**: stop a job that is still running. The button is also shown next to a running job.
- **Copy Job ID**: copy the ID of the job, for example for an administrator.
- **Delete Background Job**: delete the job from the server. This deletes its log and listing too. You can select several jobs and delete them together.

Logs and listings open read-only. To keep one, save it with **File > Save As**.

## Where background jobs are stored

When you submit a whole program, the extension stores it as a SAS job in a **Positron Jobs** folder in your **My Folder** in SAS Content. Later submits of the same program reuse and update that SAS job instead of making a new one each time. If a SAS job of the same name is already in the folder, the new one gets a number, such as `adsl (2)`. Like any SAS job, it can be run from the SAS Job Execution web application or scheduled in SAS Environment Manager. You can delete these SAS jobs in SAS Content when you no longer need them.

A selection, or a program that has never been saved, is submitted once without a SAS job in SAS Content.

The server deletes a finished background job, with its log and listing, after the time set in `SAS.backgroundJobs.keepResultsFor`, seven days by default. The SAS jobs in the **Positron Jobs** folder are not deleted.

## Settings

| Setting | Description |
|---|---|
| `SAS.backgroundJobs.computeContext` | The SAS Viya compute context that background jobs run in. When empty, background jobs use the `context` of the active connection profile, or `SAS Job Execution compute context`, the same as runs in the console. If the context is not found on the server, you are asked to choose one. You can also choose one with **SAS: Choose Compute Context for Background Jobs...** in the Command Palette or in the **...** menu of the **Background Jobs** view. |
| `SAS.backgroundJobs.keepResultsFor` | How long the server keeps a finished background job, as an ISO-8601 duration, such as `P7D` (seven days, the default) or `PT12H` (twelve hours). When it expires, the server deletes the job together with its log and listing. |
