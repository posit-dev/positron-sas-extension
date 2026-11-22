---
sidebar_position: 5
---

# SAS 9.4 (local - stdio) Connection Profile

The SAS 9.4 (local - stdio) connection type allows you to run SAS locally on your machine using standard input/output pipes (stdin/stdout/stderr) instead of SSH. This connection type provides the same interactive SAS session semantics as the SSH connection type but without network overhead.

## When to Use Stdio

Use the stdio connection type when:

- SAS is installed locally on the same machine as VS Code
- You want to avoid SSH connection overhead
- You're working on a single-user development machine

## Requirements

- SAS 9.4 must be installed locally on your machine (or inside Docker container)
- The SAS executable must be accessible via a fully qualified path
- Your operating system must be Linux (other OS were not tested)

## Positron and Posit Workbench

In Positron, when SAS is installed locally, the extension adds a `local` stdio profile once, so SAS appears in the console's interpreter list without any setup. It looks for the SAS launcher in these places, in order, and uses the first executable one:

1. The paths in the `SAS.localSasPaths` setting, if any
2. `/opt/sas/viya/home/SASFoundation/sas` (SAS Analytics Pro images)
3. `/opt/sas/viya/home/SASFoundation/bin/sas_u8` (SAS Viya-based installations without the `sas` script)
4. Common SAS 9.4 Foundation locations, each with the `sas` script first and then the UTF-8 launcher `bin/sas_u8`:
   - `/opt/sas/SASHome/SASFoundation/9.4`
   - `/usr/local/SASHome/SASFoundation/9.4`
   - `/opt/sasinside/SASHome/SASFoundation/9.4`
   - `/opt/SASHome/SASFoundation/9.4`
5. `sas` on `PATH`

For SAS 9.4 the extension prefers the `sas` script in `SASFoundation/9.4`, which starts SAS in the encoding your site configured, and uses `bin/sas_u8` only when there is no script. See [Session Encoding](#session-encoding). To use another launcher, such as `bin/sas_u8` at a site whose `sas` script starts a LATIN1 session, list it in `SAS.localSasPaths` or set `saspath` in the profile.

A deleted profile is not added again unless there are no connection profiles at all. To add it on request, run **SAS: Add Local SAS Profile** from the Command Palette. The **SAS Local Profile** channel in the **Output** pane shows where the extension looked and why it added a profile or did not.

If SAS is installed elsewhere, list its launcher in `SAS.localSasPaths` (a machine setting, fully qualified paths):

```json
{
  "SAS.localSasPaths": ["/data/SASHome/SASFoundation/9.4/bin/sas_u8"]
}
```

The profile is not added if a stdio profile already exists. It becomes the active profile only if none is set. If you delete it, it is not added again.

If the extension cannot save the profile to `settings.json`, for example because Posit Workbench writes `settings.json` at the same moment when a session starts, it tries again several times over about 15 seconds. If every attempt fails, a warning offers **Retry**: if `settings.json` shows unsaved changes, save or revert it first. A profile that could not be saved is added again at the next start. Version 0.6.2 or later is needed for this; with earlier versions, the profile could be lost on the first start in a SAS Analytics Pro image.

In a Posit Workbench session started from a SAS Analytics Pro image, Workbench licenses SAS for the session through the `SASV9_OPTIONS` environment variable. The stdio session inherits it, so no license options are needed in the profile.

In Positron, a stdio session supports the SAS console, the Viewer and Plots panes, browsing libraries in the Connections pane, and the Data Explorer. The SAS Content and SAS Server views are not available. Use Positron's Explorer for local files.

## Profile Anatomy

A SAS 9.4 (local - stdio) connection profile includes the following parameters:

`"connectionType": "stdio"`

| Name      | Description                  | Additional Notes                                             |
| --------- | ---------------------------- | ------------------------------------------------------------ |
| `saspath` | Path to local SAS Executable | Must be a fully qualified path on your local machine to SAS. |

## Example Configuration

To create a stdio connection profile, add an entry to your VS Code settings:

```json
{
  "SAS.connectionProfiles": {
    "profiles": {
      "local_sas": {
        "connectionType": "stdio",
        "saspath": "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8"
      }
    },
    "activeProfile": "local_sas"
  }
}
```

### With Additional SAS Options

You can include SAS startup options in your profile:

```json
{
  "SAS.connectionProfiles": {
    "profiles": {
      "local_sas_custom": {
        "connectionType": "stdio",
        "saspath": "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8",
        "sasOptions": ["-memsize", "2G", "-work", "/tmp/saswork"]
      }
    },
    "activeProfile": "local_sas_custom"
  }
}
```

The extension starts SAS with `-nodms -noterminal -nosyntaxcheck -linesize max`, followed by your `sasOptions`. With `-linesize max`, SAS doesn't wrap log lines, so the console can hide the code the extension adds around each submission. A `-linesize` in `sasOptions` comes later and takes precedence.

### With AutoExec

You can configure AutoExec lines to run automatically when the session starts. They run once, right after SAS starts and before any code you submit. See [SAS Autoexec Settings](./additional.md#sas-autoexec-settings):

```json
{
  "SAS.connectionProfiles": {
    "profiles": {
      "local_sas_autoexec": {
        "connectionType": "stdio",
        "saspath": "/usr/local/SASHome/SASFoundation/9.4/bin/sas_u8",
        "autoExec": [
          {
            "type": "line",
            "line": "options pagesize=max;"
          },
          {
            "type": "file",
            "filePath": "/home/user/my_autoexec.sas"
          }
        ]
      }
    },
    "activeProfile": "local_sas_autoexec"
  }
}
```

## How It Works

The stdio connection type:

1. Spawns a local SAS process
2. Opens stdin, stdout, and stderr pipes to communicate with SAS
3. Maintains a persistent SAS session across multiple code submissions
4. Streams logs in real-time. Outputs are directly opened from filesystem

This provides identical behavior to the SSH connection type, but without requiring a remote server or SSH authentication.

## Interrupting Running Code

A stdio session cannot cancel code that is running. In Positron, when you interrupt the console, SAS keeps running the code and the console stays busy until it finishes. A message offers to restart the session instead, which ends the SAS process. Restarting loses the session's WORK tables, macro variables, and librefs.

## Common SAS Executable Paths

The location of the SAS executable varies by installation. Common paths include:

### Linux/Unix

```
/opt/sasinside/SASHome/SASFoundation/9.4/sas    # the site's encoding
/opt/sasinside/SASHome/SASFoundation/9.4/bin/sas_u8    # UTF-8
/usr/local/SASHome/SASFoundation/9.4/bin/sas_en    # LATIN1
/opt/sas/viya/home/SASFoundation/sas    # SAS Analytics Pro
/opt/sas/viya/home/SASFoundation/bin/sas_u8    # SAS Viya-based, without the sas script
```

Check with your SAS administrator or installation documentation for the exact path on your system.

## Session Encoding

The extension asks SAS for its session encoding (`&SYSENCODING`) when the session starts, and from then on reads the SAS log and results and writes your code in that encoding. Any SAS launcher works: the UTF-8 launcher `bin/sas_u8`, the site's `sas` script, or a launcher for another encoding, such as `bin/sas_en` (LATIN1). You can also choose the encoding with `-encoding` in `sasOptions`, for example `"sasOptions": ["-encoding", "wlatin1"]`.

Use the encoding your site's data is stored in. A UTF-8 session can read WLATIN1 or LATIN1 datasets only through CEDA: it can't update them in place, and long character values can be truncated when SAS transcodes them. A session in the data's encoding avoids that.

In a session that isn't UTF-8, characters your code uses that the encoding doesn't have, such as `€` in a LATIN1 session, are sent to SAS as `?`, and the log shows a warning. If SAS doesn't report its encoding within 30 seconds, or reports one the extension doesn't know, the extension uses UTF-8 and writes a warning to the log. Version 1.3.0 or later is needed for sessions that aren't UTF-8; earlier versions read all SAS output as UTF-8.

## Comparison with SSH Connection

| Feature                    | SSH Connection | Stdio Connection |
| -------------------------- | -------------- | ---------------- |
| Session persistence        | ✅             | ✅               |
| Incremental code execution | ✅             | ✅               |
| Real-time log streaming    | ✅             | ✅               |
| ODS output                 | ✅             | ✅               |
| Requires remote server     | ✅             | ❌               |
| Requires authentication    | ✅             | ❌               |
| Network overhead           | ✅             | ❌               |
| Local SAS installation     | ❌             | ✅               |

## Troubleshooting

### Connection Fails to Start

If the SAS process fails to start, verify:

1. The `saspath` is correct and points to a valid SAS executable
2. You have execute permissions on the SAS executable
3. SAS is properly licensed on your local machine

### Session Behaves Unexpectedly

- Check that your SAS options are valid
- Review the SAS log for error messages
- Ensure your WORK directory has sufficient space
- Verify that AutoExec files (if specified) are accessible and valid

## See Also

- [Add New Connection Profile](./index.md#add-new-connection-profile)
- [SAS 9.4 (remote - SSH) Connection Profile](./sas9ssh.md)
- [Managing Connection Profiles](./index.md)

The stdio connection type was contributed upstream by Andreas Menrath in [sassoftware/vscode-sas-extension#1771](https://github.com/sassoftware/vscode-sas-extension/pull/1771).
