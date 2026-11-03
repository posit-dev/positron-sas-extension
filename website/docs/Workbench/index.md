---
sidebar_position: 1
---

# SAS with Posit Workbench

Posit Workbench and Posit Connect support several ways to bring SAS into your data science work. They differ in how closely SAS works with R and Python: side by side as separate tools, together in one editor, or mixed in the same code.

This section builds on the rest of this documentation. The [Features](../Features/index.md) and [Configurations](../Configurations/index.md) sections describe the SAS Extension for Visual Studio Code, which the SAS Extension for Positron extends, and they still apply in Positron: connection profiles, SAS Viya and SAS 9.4 connections, SAS Content, libraries, and notebooks. The pages here add what is specific to Positron and to Posit Workbench: running SAS in the Positron console, the Positron panes, Posit Assistant, and how to set up each way of running SAS in Workbench.

| Scenario | What you get | Where SAS runs |
| --- | --- | --- |
| [SAS within Positron](./Positron/index.md) | SAS in the Positron console, next to R and Python, with Positron's Viewer, Plots pane, Connections pane, and Data Explorer | Locally in the session, or on a remote SAS server or SAS Viya |
| [SAS in your R and Python code](./Code/index.md) | SAS called from R or Python code, in Workbench sessions and in content on Posit Connect | SAS Viya, a SAS server, or a local SAS installation |

For what each scenario needs, see [Requirements by Scenario](./requirements.md). For the shared setup underneath all of them, such as single sign-on and shared home directories with SAS Viya, see [Across All Scenarios](./foundations.md).

## Which Scenario Fits

- **SAS programmers who want a modern editor:** SAS within Positron runs SAS with the same console, output, and data tools as R and Python, and with Posit Assistant. Start with [Positron SAS Extension Features](../Features/positron.md).
- **Teams that combine languages:** SAS in your R and Python code lets an R or Python program, a Quarto document, or a Shiny app run SAS code and use its results, and publish them to Posit Connect.

The scenarios combine well. For example, a team can develop SAS code in Positron and call it from a Quarto report that runs on Connect.

## Choose Where SAS Runs

Where SAS runs decides which connection profile you use and which features are available.

| If your SAS is... | Use | Page |
| --- | --- | --- |
| On SAS Viya | A SAS Viya (`rest`) profile, with sign-in through Workbench | [Remote SAS Viya](./Positron/remoteViya.md) |
| On a SAS 9.4 or SAS Analytics Pro server | An SSH profile | [Remote SAS over SSH](./Positron/remoteSsh.md) |
| Installed on the Workbench host or in the session image | The automatic `local` stdio profile | [Local SAS: SAS Installed with Workbench](./Positron/localInstalled.md) |

The [Capabilities by Connection Type](../matrix.md) table lists which features each connection type supports in VS Code. For Positron, see [Features by Connection Type](../Features/positron.md#features-by-connection-type).
