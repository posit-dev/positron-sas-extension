---
sidebar_position: 4
---

# SAS 9.4 (remote - SSH) Connection Profile

A SAS 9.4 (remote - SSH) connection works with SAS servers on UNIX, Linux and Windows. For a server on Windows, see [SAS 9.4 on Windows](#sas-94-on-windows). On UNIX and Linux, the SSH connection method uses SSH to authenticate to a SAS server and runs SAS code using [Interactive Line Mode](https://go.documentation.sas.com/doc/en/pgmsascdc/9.4_3.5/hostunx/n16ui9f6dacn8pn1t0y2hgxgi7wa.htm). Several authentication methods are available to create a secure connection to the SAS 9.4 server.

:::note

You can use the console log to help debug connection issues. For more information, see [How do I debug connection failures?](../../faq.md#how-do-i-debug-connection-failures)

:::

## Profile Anatomy

A SAS 9.4 (remote – SSH) connection profile includes the following parameters:

`"connectionType": "ssh"`

| Name                 | Description                          | Additional Notes                                                              |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `host`               | SSH Server Host                      | Appears when hovering over the status bar.                                    |
| `username`           | SSH Server Username                  | The username to establish the SSH connection to the server.                   |
| `port`               | SSH Server Port                      | The SSH port of the SSH server. The default value is 22.                      |
| `saspath`            | Path to SAS Executable on the server | Must be a fully qualified path on the SSH server to a SAS executable file.    |
| `privateKeyFilePath` | SSH Private Key File (optional)      | Must be a fully qualified path on the same machine that Positron is running on. |

The extension opens a shell on the server, turns off the terminal echo with `stty -echo`, and starts SAS with `-nodms -noterminal -nosyntaxcheck -linesize max`, followed by the `sasOptions` of the profile. With `-linesize max`, SAS doesn't wrap log lines, so the Positron console can hide the code the extension adds around each submission. A `-linesize` in `sasOptions` comes later and takes precedence.

## Authenticating to a SAS Server

The extension will attempt to authenticate to the SAS Server over ssh using the auth methods specified in the SSH Server configuration defined on the SAS Server. The extension currently supports using the SSH auth methods listed below:

- [Publickey](#publickey)
- [Password](#password)
- [Keyboard Interactive](#keyboard-interactive)

### Publickey

#### SSH Agent

When using publickey SSH authentication, The extension can be configured to use keys defined in the SSH Agent. The socket defined in the environment variable `SSH_AUTH_SOCK` is used to communicate with ssh-agent to authenticate the SSH session. The private key must be registered with the ssh-agent when using this method. The steps for configuring SSH follow. Follow the steps below to complete the setup.

##### Windows

1. Enable OpenSSH for Windows using these [instructions](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse?tabs=gui).

2. [Create an environment variable](https://phoenixnap.com/kb/windows-set-environment-variable) named SSH_AUTH_SOCK with value `//./pipe/openssh-ssh-agent`
   (Windows uses a named pipe for the auth sock).

   **Note**: An attempt to create the varible using Powershell command line did not register; suggest using these GUI instructions.

3. Ensure that the ssh-agent service is running and set the Startup type to Automatic using [these instructions](https://dev.to/aka_anoop/how-to-enable-openssh-agent-to-access-your-github-repositories-on-windows-powershell-1ab8)

4. [Generate ed25519 keys](https://medium.com/risan/upgrade-your-ssh-key-to-ed25519-c6e8d60d3c54) with the following command (email address is not binding; you can use any email address):

```sh
ssh-keygen -o -a 100 -t ed25519 -f ~/.ssh/id_ed25519 -C "youremail@company.com"
```

5. You are prompted to enter additional information. If you did not enter a path, a default path is provided for you. You can also specify a passphrase. If you do not specify a passphrase, your key is not password-protected. Press Enter to accept the default value for each prompt.
   - Enter a file in which to save the key (/c/Users/you/.ssh/id_ed25519):[Press enter]
   - Enter passphrase (empty for no passphrase): [Type a passphrase]
   - Enter same passphrase again: [Type passphrase again]

6. Define an entry in ~/.ssh/config using the following format:

```
Host host.machine.name
    AddKeysToAgent yes
    IdentityFile /path/to/private/key/with/passphrase
```

Note: if ~/.ssh/config does not exist, run the following Powershell command to create it: `Out-File -FilePath config`

7. Add the private key to ssh-agent: ssh-add /path/to/private/key/with/passphrase

8. In Positron, define a connection profile (see detailed instructions in the [Add New Connection Profile](./index.md#add-new-connection-profile) section). The connection for the remote server is stored in the settings.json file.

```json
"ssh_test": {
    "connectionType": "ssh",
    "host": "host.machine.name",
    "saspath": "/path/to/sas/executable",
    "username": "username",
    "port": 22
}
```

Note: the default path to the SAS executable (saspath) is /opt/sasinside/SASHome/SASFoundation/9.4/bin/sas_u8, the UTF-8 launcher. Any launcher works, such as the site's `sas` script in `SASFoundation/9.4` or `bin/sas_en`: the extension detects the session encoding (see [Session Encoding](./sas9stdio.md#session-encoding)). Check with your SAS administrator for the exact path.

9. Add the public part of the keypair to the SAS server. Add the contents of the key file to the ~/.ssh/authorized_keys file.

##### Mac

1. Start ssh-agent in the background:

```sh
eval "$(ssh-agent -s)"
```

2. Ensure that SSH_AUTH_SOCK has a value

```sh
echo $SSH_AUTH_SOCK
```

3. Define an entry in $HOME/.ssh/config of the form:

```
Host host.machine.name
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile /path/to/private/key/with/passphrase
```

4. Add the private key to ssh-agent: ssh-add /path/to/private/key/with/passphrase

5. Define a connection profile in settings.json for a remote server (see detailed instructions in the [Add New Connection Profile](./index.md#add-new-connection-profile) section):

```json
"ssh_test": {
    "connectionType": "ssh",
    "host": "host.machine.name",
    "saspath": "/path/to/sas/executable",
    "username": "username",
    "port": 22
}
```

6. Add the public part of the keypair to the SAS server. Add the contents of the key file to the ~/.ssh/authorized_keys file.

#### Private Key File Path

A private key can optionally be specified in the `privateKeyFilePath` field in the connection profile for SAS 9.4 (remote - SSH). This is useful for auth setups where the SSH Agent cannot be used. If a private key file contains a passphrase, the user will be prompted to enter it during each Session creation for which it is used.

```json
"ssh_test": {
    "connectionType": "ssh",
    "host": "host.machine.name",
    "saspath": "/path/to/sas/executable",
    "username": "username",
    "port": 22,
    "privateKeyFilePath": "/path/to/privatekey/file"
}
```

### Password

Enter the password using the secure input prompt during each Session creation. To authenticate without using a password, configure the extension using one of the Publickey setups.

### Keyboard Interactive

Enter the response to each question using the secure input prompts during each Session creation.

## Interrupting Running Code

An SSH session to SAS on UNIX or Linux cannot cancel code that is running. (With [SAS 9.4 on Windows](#sas-94-on-windows), interrupting cancels the run.) In Positron, when you interrupt the console, SAS keeps running the code and the console stays busy until it finishes. A message offers to restart the session instead, which ends the SAS session. Restarting loses the session's WORK tables, macro variables, and librefs.

## SAS 9.4 on Windows

SAS on Windows can't run in interactive line mode: it has no `-stdio` option, and `-nodms` isn't valid there. So for a server on Windows, the extension runs a PowerShell script on the server over SSH instead of starting `sas.exe` directly. The script starts a SAS session through SAS Integration Technologies, as the [SAS 9.4 (local)](./sas9local.md) connection does on a Windows desktop. Positron can run on Linux, macOS or Windows.

The SAS session keeps its WORK tables, macro variables and librefs between runs. The log, ODS results, interrupting a run (with **Interrupt** in the Positron console) and the **Libraries** and **Server Files** views work as with a local connection.

### Requirements on the server

- The OpenSSH server for Windows. See [Get started with OpenSSH for Windows](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse).
- Windows PowerShell 5.1, which comes with Windows Server 2016 and later.
- SAS 9.4 with the SAS Integration Technologies client, which the SAS installation for Windows normally includes. The script looks for `SASInterop.dll` in the location the SAS installation records in the registry, and in `C:\Program Files\SASHome\x86\Integration Technologies`. If it's somewhere else, set `interopLibraryFolderPath` to the folder on the server.

For key authentication, add your public key to `C:\Users\<username>\.ssh\authorized_keys` on the server. For an account in the Administrators group, Windows OpenSSH reads `C:\ProgramData\ssh\administrators_authorized_keys` instead.

### Profile

A `saspath` that looks like a Windows path, with a drive letter, a backslash or a `.exe` ending, makes the extension treat the server as Windows. The SAS session starts through SAS Integration Technologies, so `saspath` itself isn't used. Instead of a `saspath`, you can set `"platform": "windows"`.

```json
"sas-windows": {
    "connectionType": "ssh",
    "host": "sasserver.example.com",
    "username": "username",
    "port": 22,
    "saspath": "D:\\SASHome\\SASFoundation\\9.4\\sas.exe",
    "privateKeyFilePath": "/home/username/.ssh/id_ed25519"
}
```

| Name                       | Description                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`                 | `"windows"` or `"unix"`. Overrides the detection from `saspath`.                                                                                              |
| `windowsProtocol`          | `"com"` (default) starts SAS as the SSH user. `"iom"` connects to the SAS object spawner on the server and asks for your password.                            |
| `iomPort`                  | The object spawner port, for `"iom"`. The default is 8591.                                                                                                    |
| `interopLibraryFolderPath` | The folder on the server with `SASInterop.dll`, if the script doesn't find it.                                                                                |
| `sasOptions`               | SAS system options, set after SAS starts. Options that only work when SAS starts, such as `-nosplash`, `-memsize` or `-encoding`, are ignored with a warning. |

### COM or IOM

The script can start SAS in two ways, set with `windowsProtocol`:

|                   | `"com"` (default)                                                                            | `"iom"`                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| How SAS starts    | The script starts `sas.exe` on the server through COM, as the SSH user                       | The script asks the SAS object spawner on the server for a workspace server session |
| Needs on Windows  | A DCOM permission for SSH logins to start SAS (see below)                                    | A SAS object spawner, as in a SAS 9.4 server deployment                             |
| Password          | Not asked                                                                                    | Asked when the session starts, for the spawner                                      |
| Network shares    | Only with SSH password authentication (see [When SAS doesn't start](#when-sas-doesnt-start)) | Yes: the spawner signs you in with your password                                    |
| SAS configuration | The SAS Foundation configuration (`sasv9.cfg`) and its autoexec                              | The workspace server's configuration and autoexec, as SAS Enterprise Guide uses     |

#### The DCOM permission COM needs

Windows only lets a user start a COM server, such as SAS, if the server's launch permissions allow it. An SSH login is a network logon: Windows puts it in the `NT AUTHORITY\NETWORK` group, not in `NT AUTHORITY\INTERACTIVE` as a desktop or Remote Desktop login. The default launch permissions allow Administrators, `INTERACTIVE` and `SYSTEM`, so the same user who can start SAS at the desktop gets `Access is denied` (`0x80070005`) over SSH. The probe script reports this as a failed COM test.

A Windows administrator can allow it for the users who need it:

1. On the SAS server, run `dcomcnfg` to open **Component Services**.
2. Go to **Component Services** > **Computers** > **My Computer** > **DCOM Config**. Find the SAS workspace server, whose application ID or class ID is `{440196D4-90F0-11D0-9F41-00A024BB830C}`. It runs `sas.exe -objectserver`.
3. Open its **Properties**, and on the **Security** tab, under **Launch and Activation Permissions**, choose **Customize** and **Edit**.
4. Add the users, or better a group of SAS users, and allow **Local Launch** and **Local Activation**.

If the SAS entry has no permissions of its own, it uses the computer's defaults: those are under **My Computer** > **Properties** > **COM Security** > **Launch and Activation Permissions** > **Edit Default**. Changing the SAS entry, rather than the defaults, affects SAS only. The machine-wide limits (**Edit Limits**) allow local launch and activation for everyone by default, so they normally need no change.

Then run the probe script again: the COM test reports `Ok: True`.

If the administrator would rather not change DCOM permissions, and the server runs a SAS object spawner (the probe reports whether `localhost:8591` accepts connections), set `"windowsProtocol": "iom"` instead.

### Check the server

The probe script [`ssh-windows-probe.ps1`](https://github.com/posit-dev/positron-sas-extension/blob/main/doc/scripts/ssh-windows-probe.ps1) checks what the connection needs on the server: PowerShell, the SAS Integration Technologies client, the SAS COM registration, a test SAS session over COM, the SAS object spawner, and, if you set `$ProbeNetworkPath` at the top of the script, a network share. It changes nothing on the server. Run it from the machine where Positron runs, with the same SSH user and key as your connection profile, the same way the extension runs its own script:

```sh
ssh -i ~/.ssh/id_ed25519 username@sasserver.example.com \
  'cmd /d /c "chcp 65001 >NUL & powershell.exe -NonInteractive -NoProfile -Command -"' \
  < ssh-windows-probe.ps1 > probe-report.txt 2>&1
```

The report ends with a summary of what works and what to change in the profile. It contains your user name, the host name and SAS paths, so read it before you share it.

### When SAS doesn't start

- **Access denied when SAS starts (`"com"`)**: Windows doesn't let SSH logins start SAS through COM by default. Ask your Windows administrator for [the DCOM permission](#the-dcom-permission-com-needs), or set `"windowsProtocol": "iom"` if the server runs a SAS object spawner.
- **Network shares**: with key or SSH agent authentication, Windows gives the SSH login no network credentials, so SAS can't read files on `\\server\share` paths. Use password authentication, or `"windowsProtocol": "iom"`, where the object spawner signs you in with your password.
- **`Unable to load required libraries`**: the script didn't find `SASInterop.dll`. Set `interopLibraryFolderPath`.
