---
sidebar_position: 4
---

# SAS in Positron and VS Code Sessions

Users can start a Positron or VS Code session from the SAS Analytics Pro image and run SAS inside it. The session runs as the user, not as root, and starts no SAS services. Workbench provides the license, and SAS is available in the SAS console and in the terminal.

## What You Get

- **Positron SAS console:** with the Positron SAS extension, a **SAS (local)** runtime appears in the interpreter picker with no setup. It runs SAS on the session's own SAS installation through the [stdio connection](../Configurations/Profiles/sas9stdio.md), with the Viewer, Plots pane, Connections pane, and Data Explorer.
- **Terminal:** SAS runs from the terminal by its path in the image, as in any SAS Analytics Pro container:

  ```sh
  /opt/sas/viya/home/SASFoundation/sas -nodms     # line mode
  /opt/sas/viya/home/SASFoundation/sas prog.sas   # batch
  ```

- **Multithreading:** SAS sets `CPUCOUNT` from the session's CPU limit, so thread-enabled procedures use the CPUs chosen when starting the session.

## Requirements

- The Workbench build with SAS Studio support (see [SAS Studio Sessions](./sasStudio.md)), with `ide-session-license=1`
- A SAS Analytics Pro image and license, set up as for SAS Studio sessions
- For the SAS console: the Positron SAS extension 0.4.0 or later

## Set Up

1. Turn on licensing for Positron and VS Code sessions in `/etc/rstudio/sas-studio.conf`. The image must be listed in `container-images`:

   ```ini
   container-images=REGISTRY/sas/apro:2026.10
   license-secret=sas-license
   ide-session-license=1
   ```

2. Allow the same image for Positron and VS Code sessions with `container-images` in `/etc/rstudio/launcher.kubernetes.profiles.conf`.

3. If Workbench creates container users (`launcher-sessions-create-container-user=1` in `useradd` mode), start the session container of these pods as root in `job.tpl`. The image's default user is `sas`, and Workbench needs root to create the user before it switches to it. Replace the `securityContext` of the `rs-launcher-container` with:

   ```yaml
   {{- $containerSecurityContext := deepCopy ($templateData.pod.containerSecurityContext | default dict) }}
   {{- if and (contains "/sas/apro:" .Job.container.image) (not (has "rstudio-sas-studio-session" .Job.tags)) }}
     {{- $_ := set $containerSecurityContext "runAsUser" 0 }}
     {{- $_ := set $containerSecurityContext "runAsGroup" 0 }}
     {{- $_ := set $containerSecurityContext "runAsNonRoot" false }}
   {{- end }}
   {{- with $containerSecurityContext }}
   securityContext:
     {{- toYaml . | nindent 12 }}
   {{- end }}
   ```

:::warning

Set root on the container, not on the pod. A pod-level `runAsUser` also applies to the init container, and the kubelet then writes projected service account tokens as files that only root can read. The session user then cannot use workload identity, for example AWS Identity and Access Management (IAM) roles for service accounts, which Posit Assistant can use for Amazon Bedrock.

:::

## How Licensing Works

When a user starts a Positron or VS Code session from one of the SAS images, Workbench adds the license secret to that session's container. At session start, Workbench writes the license to a private file and sets `SASV9_OPTIONS`, which SAS reads at startup, to pass the license file and a SASUSER library in `~/sasuser.viya`. Sessions on other images do not receive the license. The session log shows `SAS license configured` when the setup succeeds.

## Use It

1. On the Workbench home page, choose **New Session**, select **Positron** or **VS Code**, and pick the SAS Analytics Pro image.
2. In Positron, choose **SAS (local)** in the interpreter picker, or open a `.sas` file to start the SAS console.
3. To limit the threads SAS uses, set `options cpucount=1;` in your program, or `nthreads=` on the `PERFORMANCE` statement of a high-performance procedure.

## Limitations

- SAS Studio and the SAS extension's SAS Viya features (SAS Content, server files, Clinical Repository) are not available, because no SAS Viya is involved.
- If a shell profile replaces `SASV9_OPTIONS`, SAS started from that shell fails with a SETINIT expiration error. Append to `SASV9_OPTIONS` instead.
- Interrupting a running submission in the SAS console is not supported for stdio connections.
- The session user can read the license file. Only enable `ide-session-license` for users entitled to the license.
