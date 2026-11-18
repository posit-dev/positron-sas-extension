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

A job whose program wrote a SAS warning, such as an unresolved macro reference, shows as **Completed with warnings**. A SAS error makes the job **Failed**.

The list comes from the server, so it also shows jobs you submitted before restarting Positron or from another Positron window. Jobs that have not ended update on their own while the view is visible. Click **Load more...** at the end of the list for older jobs.

Expand a finished job to see its **Log** and its **Listing**, and click one to open it. Right-click a job for more actions:

- **Open Log**: open the SAS log. Notes, warnings, and errors are colored as in the SAS log of the console, with a SAS color theme.
- **Open Results**: open the listing.
- **Open Result File...**: choose any file the job produced, such as the log as text.
- **Show Submitted Code**: open the code the job ran.
- **Run Again**: submit the same job again, with the same parameter values and in the same compute context.
- **Cancel Background Job**: stop a job that is still running. The button is also shown next to a running job.
- **Copy Job ID**: copy the ID of the job, for example for an administrator.
- **Delete Background Job**: delete the job from the server. This deletes its log and listing too. You can select several jobs and delete them together.

Logs and listings open read-only. To keep one, save it with **File > Save As**.

## Save a program as a SAS job

To keep a program as a named SAS job that you can run again with different values, save it as a SAS job:

1. Open the SAS program in the editor.
2. Click the arrow next to the running person icon and select **Save as SAS Job...**. You can also right-click in the editor, or run **SAS: Save as SAS Job...** from the Command Palette.
3. Enter a name for the SAS job.
4. Choose where to save it in SAS Content: **My Folder**, or **Another folder...** to enter the path of a folder, such as `/Public/Reports`. If the folder already has something of that name, you can replace that SAS job or save under a free name, such as `adsl (2)`.
5. If the program reads macro variables that it does not set itself, such as `&cutoff` in `where age > &cutoff;`, choose which of them become job parameters. For each, enter a default value, or leave it empty for none. A default that is a number makes a numeric parameter.

A message confirms where the SAS job was saved. Click **Run Now** to run it.

A SAS job is the whole program, even when part of it is selected. Like any SAS job, it can also be run from the SAS Job Execution web application and scheduled in SAS Environment Manager.

## The SAS Jobs view

The **SAS Jobs** view, below **Background Jobs**, lists your SAS jobs on the SAS Viya server, most recently changed first:

- the SAS jobs you saved with **Save as SAS Job...**,
- the SAS jobs you made in SAS Studio or elsewhere, and
- the SAS jobs that **Submit as Background Job** keeps for your programs in **Positron Jobs**, marked **from Submit**.

Hover over a SAS job to see its folder, its description, and its parameters with their types and defaults. Right-click a SAS job for these actions:

- **Run...**: run the SAS job as a background job. For each parameter you are asked for a value, starting from its default. A required parameter can't be left empty, and a numeric one takes a number. The button is also shown next to the SAS job.
- **Run with Defaults**: run it with the default values, without asking. If a required parameter has no default, you are asked anyway.
- **Show Code**: open the code of the SAS job, read-only.
- **Copy URI**: copy the URI of the SAS job, such as `/jobDefinitions/definitions/…`.
- **Delete SAS Job**: delete the SAS job from SAS Content. Background jobs already run from it, with their logs and listings, are kept. You can select several SAS jobs and delete them together.

A run is an ordinary background job: it shows in the **Background Jobs** view, and a message tells you when it ends.

Each parameter reaches the program as a macro variable. A parameter left empty is passed as an empty value, so `&name` still resolves. A SAS job that names its own compute context, as SAS jobs made in SAS Studio usually do, runs in that context; other SAS jobs run in the context set by `SAS.backgroundJobs.computeContext`.

## Where background jobs are stored

When you submit a whole program, the extension stores it as a SAS job in a **Positron Jobs** folder in your **My Folder** in SAS Content. Later submits of the same program reuse and update that SAS job instead of making a new one each time. If a SAS job of the same name is already in the folder, the new one gets a number, such as `adsl (2)`. Like any SAS job, it can be run from the SAS Job Execution web application or scheduled in SAS Environment Manager. You can delete these SAS jobs in SAS Content when you no longer need them.

A selection, or a program that has never been saved, is submitted once without a SAS job in SAS Content.

The server deletes a finished background job, with its log and listing, after the time set in `SAS.backgroundJobs.keepResultsFor`, seven days by default. The SAS jobs in the **Positron Jobs** folder are not deleted.

## Settings

| Setting | Description |
|---|---|
| `SAS.backgroundJobs.computeContext` | The SAS Viya compute context that background jobs run in. When empty, background jobs use the `context` of the active connection profile, or `SAS Job Execution compute context`, the same as runs in the console. If the context is not found on the server, you are asked to choose one. You can also choose one with **SAS: Choose Compute Context for Background Jobs...** in the Command Palette or in the **...** menu of the **Background Jobs** view. |
| `SAS.backgroundJobs.keepResultsFor` | How long the server keeps a finished background job, as an ISO-8601 duration, such as `P7D` (seven days, the default) or `PT12H` (twelve hours). When it expires, the server deletes the job together with its log and listing. |
