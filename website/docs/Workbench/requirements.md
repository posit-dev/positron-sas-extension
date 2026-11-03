---
sidebar_position: 2
---

# Requirements by Scenario

This page lists what each scenario and variant needs. Rows marked "Proof of concept" depend on a Workbench build that is not part of a Workbench release.

Workbench sessions run on Linux, so the extension's Windows-only connection types (SAS 9.4 local through COM, and IOM) are not part of any scenario.

Wherever a row lists the SAS Analytics Pro image, it means the unmodified image from SAS. Posit does not require any changes to the image.

| Scenario and variant | Status | Workbench | Editor | SAS | Other setup |
| --- | --- | --- | --- | --- | --- |
| Positron, local SAS in the SAS Analytics Pro container | Proof of concept | A build with SAS Studio support, with `ide-session-license=1`; Kubernetes Job Launcher | Positron with the Positron SAS extension 0.4.0 or later | Unmodified SAS Analytics Pro image and license | License in a Kubernetes secret; the image allowed for Positron sessions; `job.tpl` starts the session container as root |
| Positron, SAS installed with Workbench | Supported | Any release with Positron sessions | Positron with the Positron SAS extension; 0.5.0 or later for automatic SAS 9.4 profiles | SAS installed and licensed on the Workbench host or in the session image | None in Workbench |
| Positron, remote SAS over SSH | Supported | Any release with Positron sessions | Positron with the Positron SAS extension | SAS 9.4 or SAS Analytics Pro reachable over SSH | SSH key access from sessions to the SAS host |
| Positron, remote SAS Viya | Supported | Any release with Positron sessions | Positron with the Positron SAS extension; 0.5.0 or later for sign-in through Workbench | SAS Viya | A Workbench custom OAuth integration for SAS Viya (as in [SAS Viya with OAuth Tokens](./Code/viyaOauth.md)), or a SAS Logon OAuth client for the extension's own sign-in |
| Code, SAS Viya with OAuth tokens | Supported | The User OAuth Provider; Workbench 2026.01.0 or later for the Python SDK | RStudio Pro, Positron Pro, or VS Code sessions (not JupyterLab) | SAS Viya | A SAS Logon OAuth client for Workbench, and one for Connect if content runs there; Connect OAuth integrations (license feature) |
| Code, local SAS | Supported | Any release | Any | SAS installed and licensed where the code runs | saspy configured for local execution |

## Verified Configuration

The proof-of-concept row and the Positron features were verified with this configuration:

- Posit Workbench build `2026.11.0-daily+185.pro12` with SAS Studio support, on Amazon Elastic Kubernetes Service (EKS)
- Unmodified SAS Analytics Pro image 2026.10
- Positron 2026.11.0 with the Positron SAS extension 0.5.0

The same deployment runs SAS Viya, Posit Connect, and Keycloak for single sign-on, and shares user accounts and home directories between Workbench and SAS Viya.
