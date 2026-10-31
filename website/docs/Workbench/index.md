---
sidebar_position: 1
---

# Choose How to Work with SAS

Posit Workbench offers several ways to work with SAS. They differ in where SAS runs and in what you see while you work. Start with where your SAS is, then pick the option that fits.

For what each option needs on the administrator side, see [Requirements by Option](./requirements.md).

## Your SAS Runs on a SAS Server

Your organization runs SAS on its own servers, and you connect to them from a Workbench session.

- **SAS Viya from Positron.** Run SAS code in a Positron console on SAS Viya compute. You can browse libraries and SAS server files, view tables in the Data Explorer, and open SAS Content and the Clinical Repository. Set up a [SAS Viya connection profile](../Configurations/Profiles/viya.md).
- **A SAS 9.4 server from Positron.** Run SAS code in a Positron console on a SAS 9.4 server over SSH. Set up an [SSH connection profile](../Configurations/Profiles/sas9ssh.md).
- **SAS from R or Python code.** Call SAS from your own R or Python code with saspy, swat (the R and Python client for SAS Cloud Analytic Services), or sasctl. Workbench can sign you in to SAS Viya and keep your access token current.

## SAS Runs in Your Workbench Session

Your Workbench administrator offers a session image with SAS Analytics Pro, so SAS runs inside your own session. You do not need a separate SAS server.

- **SAS Studio.** Use the SAS Studio web interface in a Workbench session. See [SAS Studio Sessions](./sasStudio.md).
- **SAS in Positron or VS Code.** Start a Positron or VS Code session from the SAS Analytics Pro image and run SAS in the SAS console or the terminal. See [SAS in Positron and VS Code Sessions](./sasInSession.md).

## You Want to Share Results

- **Posit Connect.** Publish apps, reports, and Quarto documents that call SAS Viya. Each viewer can use their own SAS Viya access, or the content can use a shared account.
