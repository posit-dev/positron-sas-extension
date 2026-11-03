---
sidebar_position: 4
---

# Remote SAS over SSH

Positron connects to a SAS 9.4 server, or to a standalone SAS Analytics Pro server, over SSH. SAS runs on that server, and the session sends code and receives the log and results.

## What You Get

- SAS in the Positron console, with the [Positron SAS extension features](../../Features/positron.md) that work over SSH
- Code and data that stay on the SAS server
- No SAS installation or license in Workbench

## Requirements

- Any Workbench release with Positron sessions
- The Positron SAS extension
- A SAS 9.4 or SAS Analytics Pro host that Workbench sessions can reach over SSH, with a user account for each SAS user
- SSH key authentication from the session to the SAS host

## Set Up

1. Make sure that sessions can reach the SAS host on its SSH port.
2. Each user creates an SSH key in their home directory, for example `~/.ssh/id_ed25519`, and adds the public key to their account on the SAS host.

## Use It

Add a profile to the Positron settings:

```json
"SAS.connectionProfiles": {
  "activeProfile": "sas-server",
  "profiles": {
    "sas-server": {
      "connectionType": "ssh",
      "host": "sas.example.com",
      "port": 22,
      "username": "jdoe",
      "saspath": "/opt/sas/SASHome/SASFoundation/9.4/sas",
      "privateKeyFilePath": "/home/jdoe/.ssh/id_ed25519"
    }
  }
}
```

For SAS Analytics Pro, `saspath` is `/opt/sas/viya/home/SASFoundation/sas`. Then choose **SAS (sas-server)** in the interpreter picker. For all profile settings, see the [SSH connection profile](../../Configurations/Profiles/sas9ssh.md).

## Limitations

- The SAS server's file system and libraries are browsed through SAS code, not as files in Positron's Explorer.
- The console cannot interrupt a running submission. It stays busy until the code finishes, and a message offers to restart the session, which stops SAS on the server.

## Why Not the SAS Compute Server REST Endpoint

SAS Analytics Pro also runs a SAS Compute Server with a REST API on port 8592. The VS Code that ships in SAS Analytics Pro connects to it with a REST profile on `localhost`. Posit does not recommend this endpoint for Positron:

- The Compute Server only runs when the full SAS Analytics Pro startup runs, as in SAS Studio sessions. It needs root and SAS services, which Positron sessions do not start.
- The endpoint has no authentication. Anyone who can reach the port runs SAS code as the account of the Compute Server, so it must not be exposed on a network.
- Workbench does not publish the port, so other sessions cannot reach it.

Use SSH for a remote SAS Analytics Pro server, and the local connection for SAS in the session.
