---
sidebar_position: 1
---

# SAS within Positron

Positron runs SAS next to R and Python. With the SAS extension, SAS gets its own console and the same Viewer, Plots pane, Connections pane, and Data Explorer as the other languages, and Posit Assistant can work with SAS code and results. For the full list, see [Positron SAS Extension Features](../../Features/positron.md).

SAS can run in the session itself or on a separate SAS server. The editor experience is the same. The difference is where SAS runs and how the extension connects to it. The connection types are the ones described in [Profile Definitions and Connection Types](../../Configurations/Profiles/index.md).

| Variant | Where SAS runs | Connection | Status |
| --- | --- | --- | --- |
| [SAS installed with Workbench](./localInstalled.md) | In the session, from a SAS installation on the Workbench host or in the session image | Local (stdio), profile added automatically for common paths | Supported |
| [Remote SAS over SSH](./remoteSsh.md) | On a SAS 9.4 or SAS Analytics Pro server | SSH, profile written by the user | Supported |
| [Remote SAS Viya](./remoteViya.md) | On SAS Viya compute | REST, profile written by the user, sign-in through Workbench | Supported |

## Choose a Variant

- **No SAS server available:** run SAS in the session, from a SAS installation that the administrator adds like R and Python.
- **An existing SAS 9.4 or SAS Analytics Pro server:** connect over SSH. Code and data stay on that server.
- **SAS Viya:** connect over REST, with the same Workbench sign-in to SAS Viya as code in sessions. This variant also gives access to SAS Content, SAS server files, and the Clinical Repository.
