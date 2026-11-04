---
sidebar_position: 1
---

# SAS Extension for Positron

Welcome to the SAS Extension for Positron! The SAS extension is lightweight, runs anywhere, and allows you to integrate SAS with other languages.

While the VS Code Extension for SAS is fully functional in Positron, the Extension's UI is not aligned well with Positron. The Positron Extension for SAS extends the VS Code Extension for SAS by providing first class support for SAS to Positron.

- Ability to start SAS from the "Start Session" menu (the same as starting an R or Python session)
- See all your SAS data libraries in the Connection Pane of Positron
- Full integration into Data Explorer including code export functionality
- Open sas7bdat and SAS transport (.xpt) files listed in the file browser directly in Data Explorer
- LLM Integration with Posit(ron) Assistant for both coding assistance but also exploratory data analysis
- Export and summarize LLM chat as quarto document with full code included.
- Traceability of console code: every submission is tagged with the user and session in the SAS log (and on SAS Viya, in the compute session and job metadata). Set `SAS.audit.logFile` to also keep a local JSON Lines audit log
- SAS Clinical Acceleration: when the active SAS Viya server has SAS Clinical Acceleration, the SAS sidebar shows Clinical Repository, Clinical Workspace, Clinical Repository Properties, and Clinical Version History views. You can browse and open repository files, edit files in your own workspace, check files out and in, copy files to the workspace, delete, upload (optionally expanding a zip), download, enable versioning, browse and open versions, and compare files and versions. It uses the same SAS Viya sign-in and needs no extra setup

To run SAS in Posit Workbench, see [SAS with Posit Workbench](./Workbench/index.md). It covers running SAS in a Workbench session, on SAS Viya or a SAS server, and from R and Python code. The [Positron SAS Extension Features](./Features/positron.md) page describes the console, the Viewer, the Data Explorer, Posit Assistant, and the other Positron features in detail.

Most of the functionality of the VS Code Extension for SAS is retained. In particular it is very important to define SAS Connection profiles.

The SAS Extension for VS Code includes the following features:

- SAS syntax highlighting and help, code completion, and code snippets

- Profile configuration for connecting to SAS and running code

- Support for SAS Viya and SAS 9 connections

- Access to SAS Content and libraries

- Ability to create notebooks for SAS, SQL, Python, R, and other languages
