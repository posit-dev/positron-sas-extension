---
sidebar_position: 3
---

# SAS Studio Sessions

A SAS Studio session runs SAS Studio from the SAS Analytics Pro image as a Workbench session. Users open it from the Workbench home page like any other session and work in the SAS Studio web interface. SAS programs run as the user's own account.

## What You Get

- SAS Studio in the browser, from the Workbench home page
- Automatic sign-in: SAS Studio signs in as the Workbench user, so no second login screen appears
- SAS programs that run as the user's account, with the user's home directory
- Idle sessions that end after a configurable time

## Requirements

- A Workbench build with SAS Studio support, which is not part of a Workbench release
- The Kubernetes Job Launcher
- A SAS Analytics Pro container image that the cluster can pull
- A SAS Analytics Pro license (SETINIT)

## Set Up

1. Store the license in a Kubernetes secret in the sessions namespace. The key must be `SETINIT_TEXT`:

   ```sh
   kubectl create secret generic sas-license \
     --from-literal=SETINIT_TEXT="$(cat /path/to/setinit.txt)" \
     -n <sessions-namespace>
   ```

   Workbench adds the license only to SAS sessions, so you do not need to add it to the launcher templates.

2. Enable SAS Studio in `/etc/rstudio/sas-studio.conf`:

   ```ini
   enabled=1
   container-images=REGISTRY/sas/apro:2026.10
   default-container-image=REGISTRY/sas/apro:2026.10
   license-secret=sas-license
   session-timeout-kill-hours=24
   ```

3. Start SAS Studio pods as root in the launcher's `job.tpl`. The SAS Analytics Pro entrypoint needs root to apply the license and start its services. The default `job.tpl` drops the root user that Workbench requests, so add this block before the line that renders the pod `securityContext`:

   ```yaml
   {{- if has "rstudio-sas-studio-session" .Job.tags }}
     {{- $_ := set $securityContext "runAsUser" 0 }}
     {{- $_ := set $securityContext "runAsGroup" 0 }}
     {{- $_ := set $securityContext "runAsNonRoot" false }}
   {{- end }}
   ```

   With the `rstudio-workbench` Helm chart, pass the modified file through `launcher.extraTemplates`. Keep the chart's `job.tpl` otherwise unchanged.

## Use It

On the Workbench home page, choose **New Session**, select **SAS Studio**, and pick the SAS Analytics Pro image. The session opens when SAS Studio and the SAS Compute Server are ready, which takes about 40 seconds.

## Limitations

- SAS Studio sessions need the Kubernetes Job Launcher.
- SAS Studio sessions run as root. SAS programs still run as the user.
- The license file in the session is readable by the session user. Only offer SAS Studio to users entitled to the license.
