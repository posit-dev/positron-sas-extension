---
sidebar_position: 2
---

# Requirements by Option

This page lists what each way of using SAS in Posit Workbench needs. Workbench sessions run on Linux, so the extension's Windows-only connection types (SAS 9.4 local and IOM) are not options here.

| Option                                           | Workbench                                                                           | Editor                                                                             | SAS                                 | Other setup                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| SAS Viya from Positron                           | Any release with Positron sessions                                                  | Positron with the Positron SAS extension                                           | SAS Viya                            | A SAS Logon OAuth client that allows the extension's sign-in                                                                               |
| SAS 9.4 server from Positron                     | Any release with Positron sessions                                                  | Positron with the Positron SAS extension                                           | SAS 9.4 server reachable over SSH   | SSH key access from sessions to the SAS server                                                                                             |
| SAS from R or Python code                        | Any release; SAS Viya sign-in uses the Workbench User OAuth Provider                | Any (RStudio, Positron, VS Code, JupyterLab)                                       | SAS Viya or SAS 9.4                 | For SAS Viya: a SAS Logon OAuth client for Workbench (scopes `openid sas-compute.user_impersonation`). The saspy, swat, or sasctl packages |
| [SAS Studio sessions](./sasStudio.md)            | A Workbench build with SAS Studio support, which is not part of a Workbench release | SAS Studio in the browser                                                          | SAS Analytics Pro image and license | Kubernetes Job Launcher. License in a Kubernetes secret. Launcher template runs SAS Studio pods as root                                    |
| [SAS in Positron and VS Code](./sasInSession.md) | The same Workbench build, with `ide-session-license=1`                              | Positron with the Positron SAS extension 0.4.0 or later (or any editor's terminal) | SAS Analytics Pro image and license | The SAS image allowed for Positron and VS Code sessions. Launcher template starts the session container as root                            |
| Share results on Posit Connect                   | Not needed (Connect)                                                                | Any                                                                                | SAS Viya                            | Connect OAuth integrations (license feature). A SAS Logon OAuth client for Connect (scopes `openid sas-compute.user_impersonation`)        |

## Verified configuration

The two options that run SAS in the Workbench session were verified with this configuration:

- Posit Workbench build `2026.11.0-daily+185.pro12` with SAS Studio support, on Amazon Elastic Kubernetes Service (EKS)
- SAS Analytics Pro image 2026.10
- Positron 2026.11.0 with the Positron SAS extension 0.4.0

The same deployment also runs SAS Viya, Posit Connect, and Keycloak for single sign-on. It shares user accounts and home directories between Workbench and SAS Viya.
