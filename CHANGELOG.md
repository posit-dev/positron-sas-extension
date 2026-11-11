# Changelog

## 0.6.0 - 2026-11-11

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release adds clinical jobs to the SAS Clinical Acceleration support: running jobs and following their runs ([#113](https://github.com/posit-dev/positron-sas-extension/pull/113)), manifest reports with links to the files of a run ([#114](https://github.com/posit-dev/positron-sas-extension/pull/114), [#116](https://github.com/posit-dev/positron-sas-extension/pull/116)), Run as Clinical Job ([#115](https://github.com/posit-dev/positron-sas-extension/pull/115)), a job editor ([#117](https://github.com/posit-dev/positron-sas-extension/pull/117)), and schedules ([#118](https://github.com/posit-dev/positron-sas-extension/pull/118)). It also lets Posit Assistant write SAS reports as Quarto documents and exports the SAS connection for saspy ([#111](https://github.com/posit-dev/positron-sas-extension/pull/111), [#112](https://github.com/posit-dev/positron-sas-extension/pull/112)).

### Features

- New command **SAS: Export saspy Configuration**. It writes the active SAS connection profile as a saspy `sascfg_personal.py` next to the open `.qmd` file (or in the workspace folder), for sasquatch and saspy. SAS Viya profiles read their token from the `SAS_VIYA_TOKEN` environment variable, so no secret is written. Posit Assistant runs the same command when it sets up a SAS report
- New command **SAS: Save Viya Token for saspy**. It saves the access token of the extension's SAS Viya sign-in (including a Posit Workbench token) to `~/.positron-sas/viya-token.json`, readable only by the user, so a Quarto render with sasquatch can connect without a separate sign-in. The exported saspy configuration now looks up the token each time saspy connects: the `SAS_VIYA_TOKEN` environment variable, the Workbench OAuth integration (needs posit-sdk and the integration ID), then that file
- Posit Assistant: a new `sas-quarto-report` skill makes `/report` and other report requests about SAS work produce a Quarto document with `{sas}` chunks run through the sasquatch R package. Before, the Assistant asked whether to use R with haven or Python with pandas, because only Positron Assistant saw the sasquatch note. The skill also explains that the rendered report opens its own SAS session, so it must load data from permanent libraries or files and not from WORK tables of the console session
- Posit Assistant: the `sas-quarto-report` skill now requires a blank line after the last `*|` option line in every `{sas}` chunk (without it, knitr reads only the first option), lints the chunks before it renders, renders the report itself when the setup is complete, and says "done" only after a render succeeded. Otherwise it says "Written, not rendered" and why
- SAS Clinical Acceleration: run clinical jobs. Right-click a `.cjob` file in the **Clinical Workspace** or **Clinical Repository** view and select **Run Clinical Job**. The extension asks for the job's parameters, follows the run in a notification whose **Cancel** cancels it, and offers the run's log and results when it ends. Verified against a server for workspace jobs with text parameters. Repository jobs, date parameters and file or folder parameters use request shapes from the API documentation and are not yet verified against a server
- SAS Clinical Acceleration: new **Clinical Jobs** view with your clinical job runs and their live state. Expand a run to see its manifest, the audit record of the run: the programs with their result and run time, the parameter values, the input and output files with version and checksum, the logs and results, and outputs that were not checked in. A versioned repository file opens at the version the run used. Right-click a run to open its log, results or job, run it again with the same values, cancel it, or copy its ID. The view appears when the server runs SAS Clinical Job Management
- SAS Clinical Acceleration: **Show Manifest Report** shows the manifest of a clinical job run as a page in the Viewer, where Posit Assistant can read it: the job, how the run ended, who ran it and when, the parameter values, the programs with result and run time, and each input and output file with version, size, modification time and MD5 checksum, plus the check-in settings and failures of repository jobs. It is available on runs in the **Clinical Jobs** view, on `.cmnf` files, and in the notification at the end of a run. **Export Manifest...** saves the report as HTML or the manifest as JSON
- SAS Clinical Acceleration: **Run as Clinical Job** runs a `.sas` program from the **Clinical Workspace** as a clinical job, so the run gets a manifest. It is in the context menu of the program in the **Clinical Workspace** view and in the **Run** menu and context menu of the editor. The first run creates a job named after the program (`adsl.cjob` for `adsl.sas`) next to it, and later runs reuse it. Unsaved changes are saved first. If a job of that name runs other programs, you can create a new job (`adsl-2.cjob`) or replace it
- SAS Clinical Acceleration: in the manifest report, the paths of the job, programs, inputs, outputs, logs and results are links that open the file in Positron. A versioned repository file opens at the version the run used. The links work while the report is open in Positron; an exported report has plain paths
- SAS Clinical Acceleration: manifest (`.cmnf`) files, and clinical job (`.cjob`) files opened as text, are JSON documents, with JSON highlighting, folding and formatting
- SAS Clinical Acceleration: clinical jobs (`.cjob`) open in a new clinical job editor, a form for the description, the programs and their order and versions, the parameters with type and default, the output locations, and the inputs and check-in of repository runs. It checks the job as you edit it, saves like any file, and has **Run** and **Open as JSON** buttons. **New Clinical Job...** on a **Clinical Workspace** folder creates a job and opens it. Repository jobs open read-only. **Reopen Editor With...** shows a job as JSON
- SAS Clinical Acceleration: schedule clinical jobs. **New Schedule...** on a `.cjob` file (in the **Clinical Workspace** and **Clinical Repository** views, the job editor, and the new **Clinical Job Schedules** view) asks when the job runs: once, on several dates, every few minutes, hourly, daily, weekly, monthly or yearly (by day number or by weekday, such as the first Monday), with a first day, an end, the time zone and the parameter values. The **Clinical Job Schedules** view lists your schedules with their timing, job, parameter values and next runs, and offers **Run Now**, **Edit Schedule...**, **Disable** and **Enable Schedule**, and **Delete Schedule...**. The service supports this although its public API documentation only describes reading schedules

### Bug Fixes

- Positron: HTML results no longer fail to appear when the Viewer is used right after a window opens. The Viewer serves HTML files through Positron's built-in proxy extension, and until that extension had started, the report stayed blank without an error. The extension now starts the proxy first, and if the Viewer still does not show the report, it shows the HTML directly
- **SAS: Export saspy Configuration** no longer shows a modal "already exists, replace it?" dialog, which blocked Posit Assistant for as long as nobody answered it. When `sascfg_personal.py` exists with other content, the command keeps the old file as `sascfg_personal.py.old-<timestamp>`, writes the new one, and shows a notification with the backup path. The command's result also returns `backupPath`

## 0.5.3 - 2026-11-09

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release gives the SAS Clinical Acceleration views their own activity bar icon ([#108](https://github.com/posit-dev/positron-sas-extension/pull/108)) and removes the sign-in confirmation dialog for SAS Viya in Posit Workbench ([#107](https://github.com/posit-dev/positron-sas-extension/pull/107)).

### Features

- SAS Clinical Acceleration: the four Clinical Acceleration views now have their own **Clinical Acceleration** icon in the activity bar instead of sharing the **SAS** sidebar with SAS Content and SAS Server. The icon appears only when the server has Clinical Acceleration. **Clinical Repository Properties** and **Clinical Version History** start collapsed

### Bug Fixes

- SAS Viya: signing in no longer shows an "extension wants to sign in" confirmation dialog when a session is already available, such as the Posit Workbench token that the extension picks up automatically. The dialog appeared on every fresh Posit Workbench session until the extension was on the account's allow-list. The extension now uses an available session directly and starts the interactive sign-in only when there is none

## 0.5.2 - 2026-11-05

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release adds a Clinical Workspace to the SAS Clinical Acceleration support, with check in, versioning and compare ([#103](https://github.com/posit-dev/positron-sas-extension/pull/103)), and it keeps an idle SAS Viya console from losing its SAS session ([#105](https://github.com/posit-dev/positron-sas-extension/pull/105)).

### Features

- SAS Clinical Acceleration: new **Clinical Workspace** view with your own workspace on the server. Files open for editing and are saved to the workspace when you save the editor. You can create, rename, delete, upload (optionally expanding a zip), and download files and folders, copy paths, and compare files with repository files and versions. Verified against the SAS Clinical Acceleration extension's requests and unit tests, not yet against a server with write access
- SAS Clinical Acceleration: **Check In** from the workspace asks only what applies to the selected files (whether to version new and unversioned files, **Major** or **Minor** for versioned files, and a comment). **Undo Check out** is available in the workspace too
- SAS Clinical Acceleration: **Copy to Workspace** copies the latest version of a file or folder, or the structure of a folder, from the repository to the workspace. **Copy to Workspace** in the **Clinical Version History** view copies one version. `.sas` files in the workspace run as usual, and `.sas7bdat` and `.xpt` files open in the Data Explorer
- Posit Assistant: the new `sas-clinical-acceleration` skill describes the Clinical Acceleration views and the check-out and check-in workflow
- Docs: new page "SAS Clinical Acceleration"; README and the Features page no longer say that you need another tool to check files in
- Clinical Repository: new **Clinical Repository Properties** and **Clinical Version History** views show the details and the versions of the selected item. A version opens read-only and can be downloaded
- Clinical Repository: **Delete** (moves items to the recycle bin of the Clinical Repository), **Enable Versioning...** and **Disable Versioning...** for files, and **Select for Compare**, **Compare with Selected** and **Compare Selected** for repository files and file versions. Delete, versioning and compare are verified against the SAS Clinical Acceleration extension's requests and unit tests, not yet against a server with write access

### Bug Fixes

- SAS Viya: an idle console no longer loses its SAS session. The Viya server ends a compute session that gets no requests for its inactivity timeout, and the next submit then failed with a 404. The extension now contacts an idle session every 60 seconds (setting `SAS.session.keepAliveSeconds`, `0` turns it off) and stops after 8 hours without a submit. If the server has dropped the session anyway, the next submit starts a new one and says so in the log, because the WORK library and macro variables of the old session are gone. Verified against a real Viya server: both `GET .../state` and `GET .../sessions/{id}` reset the inactivity timer, a console left idle for more than 10 minutes still responded, and after the compute session was terminated the next submit started a new session. The server's default inactivity timeout is not known ([#105](https://github.com/posit-dev/positron-sas-extension/pull/105))
- Clinical Repository: Upload and Upload and Expand now send the file as `multipart/form-data`, as the Clinical Repository API specifies, and no longer version the upload by default. The version prompt is empty unless you enter a version (such as `1.0`, `MAJOR` or `MINOR`), because versioning needs a privilege that normal users often lack ([#73](https://github.com/posit-dev/positron-sas-extension/issues/73)). Verified against the API specification and unit tests, not yet against a server with write access
- Clinical Repository: after the sign-in token expires, the first request no longer fails with a 401. The request that triggers the refresh is now replayed with the new token instead of the old one ([#101](https://github.com/posit-dev/positron-sas-extension/pull/101))


## 0.5.1 - 2026-11-03

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release is mostly documentation: the site is now "SAS Extension for Positron Documentation" and covers running SAS in Posit Workbench ([#99](https://github.com/posit-dev/positron-sas-extension/pull/99)). The only change to the extension is an updated dependency.

### Bug Fixes

- Updated the katex dependency from 0.17 to 0.18.10 ([#97](https://github.com/posit-dev/positron-sas-extension/pull/97))
- Docs: new section "SAS with Posit Workbench" (SAS within Positron: local SAS, SAS over SSH, and SAS Viya with sign-in through Workbench; SAS in R and Python code with saspy and sasquatch) and a "Positron SAS Extension Features" page, with screenshots. The documentation of the SAS Extension for Visual Studio Code is kept and linked from the new pages
- Docs: the installation page describes installing the extension from the VSIX file of a GitHub release, in Positron and in Posit Workbench, and keeps the instructions for the SAS Extension for Visual Studio Code
- Docs: the site is renamed "SAS Extension for Positron Documentation", its GitHub and edit links point to posit-dev/positron-sas-extension, and the footer has the Posit copyright line for the Positron specific parts

## 0.5.0 - 2026-11-02

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release lets a SAS Viya profile sign in with the Posit Workbench OAuth token, so you sign in to SAS Viya once ([#93](https://github.com/posit-dev/positron-sas-extension/pull/93)). The `local` profile is now also added for SAS 9.4 installs ([#87](https://github.com/posit-dev/positron-sas-extension/pull/87)), and each SAS console starts the profile you picked, with its own SAS session ([#94](https://github.com/posit-dev/positron-sas-extension/pull/94)).

### Features

- Positron: the `local` stdio profile is now also added for SAS 9.4 installs. Besides the SAS Analytics Pro path, the extension looks in common SAS 9.4 Foundation locations (such as `/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8`) and for `sas` on `PATH`. For SAS 9.4 it uses the UTF-8 launcher `bin/sas_u8`, because the extension reads SAS output as UTF-8. The new `SAS.localSasPaths` machine setting lists extra launcher paths, checked first ([#87](https://github.com/posit-dev/positron-sas-extension/pull/87))
- stdio profiles now run their `autoExec` lines once, right after SAS starts ([#92](https://github.com/posit-dev/positron-sas-extension/issues/92))
- Posit Assistant: `sas_export_saspy_config` exports a SAS Viya profile as a saspy HTTP access method configuration (`url`, `context`, and an `authtoken` read from the `SAS_VIYA_TOKEN` environment variable) instead of an IOM configuration. The exported configuration never contains secrets, and profile names that are not Python identifiers are converted to valid configuration names ([#91](https://github.com/posit-dev/positron-sas-extension/issues/91))
- SAS Viya: in Posit Workbench, a SAS Viya profile signs in with the SAS Viya token from a Posit Workbench OAuth integration configured by your administrator, so you do not sign in to SAS Viya a second time. New profile settings `authentication` (`"auto"`, the default, `"workbench"`, or `"sasLogon"`) and `workbenchIntegration`. Without a matching integration, the extension signs in with SAS Logon as before ([#93](https://github.com/posit-dev/positron-sas-extension/pull/93))

### Bug Fixes

- Positron: starting the runtime "SAS (*profile*)" now connects with that profile, not with the active profile ([#88](https://github.com/posit-dev/positron-sas-extension/issues/88))
- Positron: each SAS console has its own SAS session. Before, consoles of the same connection type shared one SAS process or compute session, and shutting one down closed it for the others ([#89](https://github.com/posit-dev/positron-sas-extension/issues/89))
- Positron: interrupting an SSH or stdio session no longer marks the console idle while SAS keeps running the code. These connections cannot cancel a submission, so the console stays busy and a message offers to restart the session, which stops SAS. Restarting or reconnecting a stdio session now starts a new SAS process instead of reusing the one that is shutting down ([#90](https://github.com/posit-dev/positron-sas-extension/issues/90))
- In VS Code (outside Positron), `.sas7bdat` and `.xpt` files open in the default editor instead of a viewer that needs a Positron SAS session ([#92](https://github.com/posit-dev/positron-sas-extension/issues/92))
- Removed the "SAS: View Data" command, which was declared but did nothing; the `repository` and `bugs` links now point to posit-dev/positron-sas-extension ([#92](https://github.com/posit-dev/positron-sas-extension/issues/92))
- Docs: the stdio README and profile docs describe the actual SAS startup options and example file, `additional.md` uses the `saspath` key, and the capabilities matrix and connection type flowchart include SAS 9.4 (local - stdio) ([#92](https://github.com/posit-dev/positron-sas-extension/issues/92))

## 0.4.0 - 2026-10-31

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

This release adds local SAS: Positron can run a SAS installed on the same machine, such as SAS Analytics Pro in a Posit Workbench session, with no SAS servers and no SSH ([#82](https://github.com/posit-dev/positron-sas-extension/pull/82)).

### Features

- New `stdio` connection type for SAS installed on the same machine: the extension starts SAS directly, without SSH or SAS servers. Based on [sassoftware/vscode-sas-extension#1771](https://github.com/sassoftware/vscode-sas-extension/pull/1771) by Andreas Menrath
- Positron: when SAS is installed at `/opt/sas/viya/home/SASFoundation/sas`, as in SAS Analytics Pro images, a `local` stdio profile is added once, so SAS shows up in the console without setup. In Posit Workbench, SAS is licensed by the session
- Positron: stdio sessions get the Connections pane library browser and the Data Explorer, which run SAS code in the session

### Bug Fixes

- The connection type "SAS 9.4 (local)" is Windows-only (COM) and is now offered only on Windows. On other systems it could only fail with `write EPIPE`; choose "SAS 9.4 (local - stdio)" for a local SAS instead
- A stdio profile whose `saspath` is missing or not executable now fails with an error that names the path

## 0.3.1 - 2026-10-28

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

### Features

- Posit Assistant can now see SAS results [#74](https://github.com/posit-dev/positron-sas-extension/issues/74):
  - Graphs from console runs are drawn as PNG and also sent to the Plots pane, where the Assistant can look at them. A run with graphs ends with the Plots pane in front, as in R and Python; the full HTML report is in the Viewer
  - A plain-text copy of the output (titles and tables) goes to the Assistant with each run's result. The console only shows a short note
  - The HTML report now opens in the Viewer as a file, so the Assistant can read it and take screenshots of it, including for code you run yourself. Reading the Viewer needs Positron 2026.10 or later
  - A `sas-results` skill tells the Assistant where SAS output goes (log in the Console, reports in the Viewer, graphs in the Plots pane) and how to read it (Positron 2026.10 or later)

### Bug Fixes

- Positron: Run, Run Selection and Run Region in a `.sas` file now run the code in the SAS console, as Positron does for R and Python. Results open in the Viewer pane instead of a Result tab that split the editor area, and the log shows in the console [#77](https://github.com/posit-dev/positron-sas-extension/issues/77)
- The SAS console now shows the full SAS log of the code you run: the source, NOTEs (including `%put NOTE: ...` output), warnings and errors. Lines from the code Positron wraps around yours are left out. The same lines are added to the "SAS Log" output channel, without switching the panel away from the Console

## 0.3.0 - 2026-10-26

Still based on SAS Extension for VS Code 1.21.0 (tag v1.21.0).

### Features

- SAS Clinical Acceleration Repository view: it is detected automatically when the active profile is a SAS Viya profile whose server runs the Clinical Repository service, and it uses the existing SAS Viya sign-in. You can browse, open (read-only), create folders, rename, upload or upload and expand, download, copy paths, and check out / undo check out. Actions that change an item (check out, rename, new folder, upload) are offered only where you have write permission, so read-only files still show Copy Path and Download. Ported from SAS's Clinical Acceleration extension for VS Code [#60](https://github.com/posit-dev/positron-sas-extension/issues/60)
- Traceability of SAS console code, including code run by Positron Assistant [#58](https://github.com/posit-dev/positron-sas-extension/issues/58):
  - New setting `SAS.audit.logFile`: when set, every console submission (user, host, Positron and Posit Workbench session, profile, code) and its outcome are appended to that file as JSON Lines
  - Each submission carries a `/* positron: user=… session=… exec=… */` comment, so it can be traced in the SAS log
  - The macro variables `&POSIT_USER`, `&POSIT_SESSION` and `&POSIT_WORKBENCH_SESSION` are set at session start
  - SAS Viya compute sessions are named `Positron SAS (<user>)` and carry the user and session ids as attributes. Each console job is named `positron-console`, and its description holds the user, session and execution ids

### Bug Fixes

- Errors and warnings from the SAS log now show as squiggles in the editor and in the Problems pane when you run code from a `.sas` file into the Positron console (Run Selection or the statement at the cursor). Code typed into the console or generated by Positron Assistant shows them in the console only [#68](https://github.com/posit-dev/positron-sas-extension/issues/68)
- Data Explorer: SAS transport files (`.xpt`, XPORT v5 and v8/9, and PROC CPORT files) now open in the Data Explorer instead of as text. A file that holds several datasets asks which ones to open [#64](https://github.com/posit-dev/positron-sas-extension/issues/64)
- Opening a `.sas7bdat` file now reports a failed LIBNAME (for example, a path the SAS server can't see) instead of an empty Data Explorer
- `.sas7bdat` and `.xpt` files opened from the Clinical Repository or SAS Content views now load in the Data Explorer: they are copied into the session's WORK directory first, which also works when SAS runs in lockdown

## 0.2.1 - 2026-10-21

### Bug Fixes

- Data Explorer: column distributions (histograms for numeric columns, frequency bars for character columns) and character column statistics (unique and empty counts) are now shown for SAS tables [#55](https://github.com/posit-dev/positron-sas-extension/issues/55)
- Data Explorer: summary statistics and missing-value counts no longer fail for column names longer than about 26 characters
- Positron: the SAS sidebar no longer shows an empty Libraries view; libraries are listed in the Connections / Data Connections pane. SAS Content and SAS Server stay available [#54](https://github.com/posit-dev/positron-sas-extension/issues/54)

## 0.2.0 - 2026-10-18

### Features

- Positron 2026.10+: SAS libraries and SAS Server Files appear in the new Data Connections pane; Positron 2026.09 and earlier keep using the Connections pane [#47](https://github.com/posit-dev/positron-sas-extension/issues/47)
- "SAS Authentication" log channel for diagnosing SAS Viya sign-in
- Updated to SAS Extension for VS Code 1.21.0 (upstream main at commit 7d14ab4, tag v1.21.0)

### Bug Fixes

- Fix SAS syntax highlighting, completion and formatting: the language server crashed on startup because a bundled dependency was missing from the package [#46](https://github.com/posit-dev/positron-sas-extension/issues/46)
- Connections Pane now lists all tables of a library instead of only the first ~15; wide tables now list all columns [#45](https://github.com/posit-dev/positron-sas-extension/issues/45)
- SAS Viya sign-in: the OAuth callback URI now points at this extension instead of the upstream `sas.sas-lsp`, and the URI handler is registered before the browser opens
- Default formatter for SAS files now points to this extension (`posit.positron-sas`)
- The extension description was missing (misspelled `"description "` key in `package.json`)

## 0.1.0 - 2026-06-02

### Features

- Ability to start SAS from the "Start Session" menu (the same as starting an R or Python session) [PR#16](https://github.com/posit-dev/positron-sas-extension/pull/16]
- See all your SAS data libraries in the Connection Pane of Positron [PR#17](https://github.com/posit-dev/positron-sas-extension/pull/17)
- Full integration into Data Explorer including code export functionality [PR#18](https://github.com/posit-dev/positron-sas-extension/pull/18)
- Open sas7bdat files listed in the file browser directly in Data Explorer [PR#19)(https://github.com/posit-dev/positron-sas-extension/pull/19)
- LLM Integration with Posit(ron) Assistant for both coding assistance but also exploratory data analysis, export and summarize LLM chat as quarto document with full code included [PR#20](https://github.com/posit-dev/positron-sas-extension/pull/20)
- SAS Extension for VS Code version used: 1.19.1 (commit e954c7fa73cc4f5a7d7382b2779b3e6eeccfe656)
