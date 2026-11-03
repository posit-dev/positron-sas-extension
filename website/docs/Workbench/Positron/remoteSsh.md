---
sidebar_position: 3
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
