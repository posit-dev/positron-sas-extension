# SAS Extension for Positron

Welcome to the SAS Extension for Positron! The SAS extension is lightweight, runs anywhere, and allows you to integrate SAS with other languages.

While the SAS Extension for Visual Studio Code is fully functional in Positron, its UI is not aligned well with Positron. The SAS Extension for Positron extends the SAS Extension for Visual Studio Code by providing first class support for SAS to Positron.

- Ability to start SAS from the "Start Session" menu (the same as starting an R or Python session)
- See all your SAS data libraries in the Connection Pane of Positron
- Full integration into Data Explorer including code export functionality
- Open sas7bdat and SAS transport (.xpt) files listed in the file browser directly in Data Explorer
- LLM Integration with Posit(ron) Assistant for both coding assistance but also exploratory data analysis
- Export and summarize LLM chat as quarto document with full code included.
- Traceability of console code: every submission is tagged with the user and session in the SAS log (and on SAS Viya, in the compute session and job metadata). Set `SAS.audit.logFile` to also keep a local JSON Lines audit log
- SAS Clinical Acceleration: when the active SAS Viya server has SAS Clinical Acceleration, the Clinical Acceleration sidebar shows Clinical Repository, Clinical Workspace, Clinical Repository Properties, Clinical Version History, Clinical Jobs, and Clinical Job Schedules views. You can browse and open repository files, edit files in your own workspace, check files out and in, copy files to the workspace, delete, upload (optionally expanding a zip), download, enable versioning, browse and open versions, and compare files and versions. When the server also runs SAS Clinical Job Management, you can run clinical jobs and review each run's manifest (the programs, parameters, inputs and outputs of the run) in the Clinical Jobs view, and create and manage schedules that run jobs at set times. It uses the same SAS Viya sign-in and needs no extra setup
- SAS Life Science Analytics Framework (LSAF): when the `SAS.lsaf.url` setting points to an LSAF server, the LSAF sidebar shows Repository, Workspace, and Jobs views. You can browse and open repository files and their versions, edit files in your workspace, check files out and in with a comment and version, add files to the repository, and run LSAF jobs, or a workspace program as a job, with each run's manifest and log at hand. It has its own sign-in and works with any SAS profile. Built from the LSAF REST API specification; not yet tested with a live LSAF server

Most of the functionality of the SAS Extension for Visual Studio Code is retained. In particular it is very important to define SAS Connection profiles.

The SAS Extension for Positron includes the following features:

- SAS syntax highlighting and help, code completion, and code snippets

- Profile configuration for connecting to SAS and running code

- Support for SAS Viya and SAS 9 connections

- Access to SAS Content and libraries

- Ability to create notebooks for SAS, SQL, Python, R, and other languages
