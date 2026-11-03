---
sidebar_position: 2
---

# Requirements by Scenario

This page lists what each scenario and variant needs.

Workbench sessions run on Linux, so the extension's Windows-only connection types (SAS 9.4 local through COM, and IOM) are not part of any scenario.

| Scenario and variant | Workbench | Editor | SAS | Other setup |
| --- | --- | --- | --- | --- |
| Positron, SAS installed with Workbench | Any release with Positron sessions | Positron with the Positron SAS extension; 0.5.0 or later for automatic SAS 9.4 profiles | SAS installed and licensed on the Workbench host or in the session image | None in Workbench |
| Positron, remote SAS over SSH | Any release with Positron sessions | Positron with the Positron SAS extension | SAS 9.4 or SAS Analytics Pro reachable over SSH | SSH key access from sessions to the SAS host |
| Positron, remote SAS Viya | Any release with Positron sessions | Positron with the Positron SAS extension; 0.5.0 or later for sign-in through Workbench | SAS Viya | A Workbench custom OAuth integration for SAS Viya (as in [SAS Viya with OAuth Tokens](./Code/viyaOauth.md)), or a SAS Logon OAuth client for the extension's own sign-in |
| Code, SAS Viya with OAuth tokens | The User OAuth Provider; Workbench 2026.01.0 or later for the Python SDK | RStudio Pro, Positron Pro, or VS Code sessions (not JupyterLab) | SAS Viya | A SAS Logon OAuth client for Workbench, and one for Connect if content runs there; Connect OAuth integrations (license feature) |
| Code, local SAS | Any release | Any | SAS installed and licensed where the code runs | saspy configured for local execution |

## Verified Configuration

The Positron features were verified with this configuration:

- Posit Workbench on Amazon Elastic Kubernetes Service (EKS)
- Positron 2026.11.0 with the Positron SAS extension 0.5.0
- SAS Viya, Posit Connect, and Keycloak for single sign-on, with user accounts and home directories shared between Workbench and SAS Viya
