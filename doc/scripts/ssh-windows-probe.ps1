# Copyright © 2026, Posit Software, PBC. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Probe for SAS 9.4 on Windows over SSH (the "ssh" connection to a Windows
# server). It checks what the extension needs on the server and prints a
# report to send back. It changes nothing on the server: the test SAS session
# only writes to its own WORK library, which SAS deletes when it ends.
#
# Run it the way the extension runs its own script, from the machine where
# Positron runs, with the same SSH user and key as the connection profile:
#
#   ssh -i ~/.ssh/id_ed25519 user@sasserver 'cmd /d /c "chcp 65001 >NUL & powershell.exe -NonInteractive -NoProfile -Command -"' < ssh-windows-probe.ps1 > probe-report.txt 2>&1
#
# Running it in a Remote Desktop session doesn't show the same thing: Windows
# lets a desktop login do things it may refuse an SSH login.
#
# The report includes the user name, host name, SAS paths and SAS version.
# Read it before you send it on.
#
# The script is read line by line from stdin, as the extension sends its own,
# so it keeps "} catch {" and "} else {" on one line. PowerShell runs a
# statement that spans lines only once a blank line follows it, so each one
# ends with a blank line, and so does the script.

#region Settings: edit these if needed
# The folder with SASInterop.dll, if the probe doesn't find it.
$ProbeInteropPath = ""
# The SAS object spawner port, for "windowsProtocol": "iom".
$ProbeIomPort = 8591
# A network path SAS needs, such as \\fileserver\share\data, to check that
# the SSH login can read it. Leave empty to skip.
$ProbeNetworkPath = ""
# How long the SAS test may take before the probe gives up, in seconds.
$ProbeSasTimeout = 180
#endregion

$ErrorActionPreference = "Continue"
$ProbeStart = Get-Date
$ProbeFindings = New-Object System.Collections.ArrayList

function Say([string]$text) { Write-Output $text }
function Section([string]$title) { Write-Output ""; Write-Output "== $title" }
function Field([string]$name, $value) { Write-Output ("{0,-28} {1}" -f "${name}:", $value) }
function Finding([string]$text) { [void]$ProbeFindings.Add($text) }

Say "SAS on Windows over SSH: probe report"
Say "Probe version: 2 (positron-sas PR #192)"
Field "Started" ($ProbeStart.ToString("yyyy-MM-dd HH:mm:ss zzz"))

#region Windows and PowerShell
Section "Windows and PowerShell"
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  Field "Windows" "$($os.Caption) $($os.Version) build $($os.BuildNumber)"
} catch {
  Field "Windows" ([Environment]::OSVersion.VersionString)
}
Field "Computer" $env:COMPUTERNAME
Field "User" "$env:USERDOMAIN\$env:USERNAME"
Field "PowerShell" $PSVersionTable.PSVersion.ToString()
Field "64-bit process" ([Environment]::Is64BitProcess)
Field "Language mode" $ExecutionContext.SessionState.LanguageMode
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
  Finding "PowerShell runs in $($ExecutionContext.SessionState.LanguageMode) mode. The extension needs FullLanguage to load SASInterop.dll (Add-Type). Ask the Windows administrator about AppLocker or WDAC rules for SSH logins."
}
try { Field "Execution policy" (Get-ExecutionPolicy) } catch { Field "Execution policy" "unknown" }
Field "Console input encoding" ([Console]::InputEncoding.WebName)
Field "Console output encoding" ([Console]::OutputEncoding.WebName)
try {
  $acp = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -ErrorAction Stop).ACP
  Field "System code page (ACP)" $acp
} catch {
  Field "System code page (ACP)" "unknown"
}
try {
  $shell = (Get-ItemProperty "HKLM:\SOFTWARE\OpenSSH" -ErrorAction Stop).DefaultShell
  if (-not $shell) { $shell = "(not set: cmd.exe)" }
  Field "OpenSSH default shell" $shell
} catch {
  Field "OpenSSH default shell" "(not set: cmd.exe)"
}
try {
  $sshd = Get-Service sshd -ErrorAction Stop
  $sshdVersion = (Get-Item (Get-CimInstance Win32_Service -Filter "Name='sshd'").PathName.Trim('"')).VersionInfo.ProductVersion
  Field "OpenSSH server" "$($sshd.Status), version $sshdVersion"
} catch {
  Field "OpenSSH server" "not found as the sshd service"
}
#endregion

#region SSH login
Section "SSH login"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
Field "Authentication type" $identity.AuthenticationType
Field "Impersonation level" $identity.ImpersonationLevel
$groups = $identity.Groups | ForEach-Object { $sid = $_; try { $sid.Translate([Security.Principal.NTAccount]).Value } catch { $sid.Value } }
$logonGroups = @("NT AUTHORITY\INTERACTIVE", "NT AUTHORITY\NETWORK", "NT AUTHORITY\BATCH", "NT AUTHORITY\SERVICE", "NT AUTHORITY\REMOTE INTERACTIVE LOGON", "BUILTIN\Administrators")
foreach ($group in $logonGroups) {
  Field "Member of $group" ($groups -contains $group)
}
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Field "Elevated administrator" $isAdmin
if ($ProbeNetworkPath) {
  try {
    $canRead = Test-Path -Path $ProbeNetworkPath -ErrorAction Stop
    Field "Reads $ProbeNetworkPath" $canRead
    if (-not $canRead) {
      Finding "The SSH login can't read $ProbeNetworkPath. With key or agent authentication, Windows gives the login no network credentials. Use password authentication, or windowsProtocol iom."
    }
  } catch {
    Field "Reads $ProbeNetworkPath" "no: $($_.Exception.Message)"
    Finding "The SSH login can't read $ProbeNetworkPath ($($_.Exception.Message)). With key or agent authentication, Windows gives the login no network credentials. Use password authentication, or windowsProtocol iom."
  }
} else {
  Field "Network path check" "skipped (set `$ProbeNetworkPath)"
}
#endregion

#region SAS installation
Section "SAS installation"
foreach ($key in @("HKLM:\SOFTWARE\SAS Institute Inc.\The SAS System", "HKLM:\SOFTWARE\WOW6432Node\SAS Institute Inc.\The SAS System")) {
  if (Test-Path $key) {
    Get-ChildItem $key -ErrorAction SilentlyContinue | ForEach-Object {
      $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      $root = $props.DefaultRoot
      if (-not $root) { $root = $props.SASROOT }
      Field "SAS registry $($_.PSChildName)" "$key, root $root"
    }
  }
}
$workspaceClsid = "{440196D4-90F0-11D0-9F41-00A024BB830C}"
$sasExe = ""
foreach ($view in @("SOFTWARE\Classes", "SOFTWARE\WOW6432Node\Classes")) {
  $key = "HKLM:\$view\CLSID\$workspaceClsid\LocalServer32"
  if (Test-Path $key) {
    $server = (Get-ItemProperty $key).'(default)'
    Field "SAS.Workspace COM ($view)" $server
    if (-not $sasExe -and $server -match '^"?([^"]*?sas\.exe)') { $sasExe = $Matches[1] }
  } else {
    Field "SAS.Workspace COM ($view)" "not registered"
  }
}
if (-not (Test-Path "HKLM:\SOFTWARE\Classes\CLSID\$workspaceClsid") -and -not (Test-Path "HKLM:\SOFTWARE\WOW6432Node\Classes\CLSID\$workspaceClsid")) {
  Finding "SAS isn't registered as a COM server (SAS.Workspace), so windowsProtocol com can't start it. Ask the SAS administrator to register it (sas.exe /regserver), or use windowsProtocol iom."
}
foreach ($progId in @("SAS.IOMProvider", "SASObjectManager.ObjectKeeper", "ADODB.Connection")) {
  Field "COM class $progId" (Test-Path "HKLM:\SOFTWARE\Classes\$progId")
}
if (-not (Test-Path "HKLM:\SOFTWARE\Classes\SAS.IOMProvider")) {
  Finding "The SAS IOM Data Provider (SAS.IOMProvider) isn't registered for 64-bit programs. The extension opens it when it connects; without it, setup fails. It comes with the SAS Integration Technologies client."
}
try {
  $sasServices = Get-Service -ErrorAction Stop | Where-Object { $_.DisplayName -like "*SAS*" }
  foreach ($service in $sasServices) {
    Field "Service" "$($service.DisplayName) ($($service.Status))"
  }
  if (-not $sasServices) { Field "Service" "no SAS services" }
} catch {
  Field "Service" "can't list services"
}
#endregion

#region SAS Integration Technologies client
Section "SAS Integration Technologies client"
$candidates = New-Object System.Collections.ArrayList
if ($ProbeInteropPath) { [void]$candidates.Add(@("setting ProbeInteropPath", $ProbeInteropPath)) }
try {
  $registryPath = (Get-ItemProperty -ErrorAction Stop -Path "HKLM:\SOFTWARE\WOW6432Node\SAS Institute Inc.\Common Data\Shared Files\Integration Technologies").Path
  [void]$candidates.Add(@("registry", $registryPath))
} catch {
  Field "Registry entry" "not found (HKLM:\SOFTWARE\WOW6432Node\SAS Institute Inc.\Common Data\Shared Files\Integration Technologies)"
}
[void]$candidates.Add(@("default path", "C:\Program Files\SASHome\x86\Integration Technologies"))
# SASHome is the folder above SASFoundation\9.4\sas.exe.
if ($sasExe) {
  $sasHome = Split-Path (Split-Path (Split-Path $sasExe -Parent) -Parent) -Parent
  [void]$candidates.Add(@("next to sas.exe", (Join-Path $sasHome "x86\Integration Technologies")))
  [void]$candidates.Add(@("next to sas.exe", (Join-Path $sasHome "Integration Technologies")))
}
$interopDir = ""
foreach ($candidate in $candidates) {
  $dll = Join-Path $candidate[1] "SASInterop.dll"
  if (Test-Path $dll) {
    $version = (Get-Item $dll).VersionInfo.FileVersion
    Field "SASInterop.dll ($($candidate[0]))" "$dll, version $version"
    if (-not $interopDir) { $interopDir = $candidate[1] }
  } else {
    Field "SASInterop.dll ($($candidate[0]))" "not in $($candidate[1])"
  }
}
if (-not $interopDir) {
  try {
    $roots = @("C:\Program Files", "C:\Program Files (x86)", "D:\Program Files", "D:\Program Files (x86)", "D:\SASHome", "E:\Program Files") | Where-Object { Test-Path $_ }
    $found = Get-ChildItem -Path $roots -Filter SASInterop.dll -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 3
    foreach ($file in $found) { Field "Found elsewhere" $file.FullName }
    if ($found) {
      $interopDir = $found[0].DirectoryName
      Finding "The extension won't find SASInterop.dll by itself. Set `"interopLibraryFolderPath`": `"$($interopDir -replace '\\', '\\')`" in the connection profile."
    }
  } catch {
  }
}
$interopLoaded = $false
if ($interopDir) {
  try {
    Add-Type -Path (Join-Path $interopDir "SASInterop.dll")
    Add-Type -Path (Join-Path $interopDir "SASOManInterop.dll")
    $interopLoaded = $true
    Field "Load interop libraries" "ok"
  } catch {
    Field "Load interop libraries" "failed: $($_.Exception.Message)"
    Finding "PowerShell can't load the SAS interop libraries from $interopDir ($($_.Exception.Message))."
  }
} else {
  Field "Load interop libraries" "skipped: SASInterop.dll not found"
  Finding "SASInterop.dll wasn't found. The SAS Integration Technologies client must be installed on the server; if it is, set interopLibraryFolderPath in the profile (and `$ProbeInteropPath here)."
}
#endregion

#region SAS object spawner (for windowsProtocol iom)
Section "SAS object spawner (for windowsProtocol iom)"
$spawnerOpen = $false
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $connect = $client.BeginConnect("localhost", $ProbeIomPort, $null, $null)
  $spawnerOpen = $connect.AsyncWaitHandle.WaitOne(3000) -and $client.Connected
  $client.Close()
} catch {
}
Field "localhost:$ProbeIomPort" $(if ($spawnerOpen) { "accepts connections" } else { "no answer" })
#endregion

#region SAS session over COM (windowsProtocol com, the default)
Section "SAS session over COM (windowsProtocol com, the default)"
$sasTest = {
  param([string]$interopDir)
  $result = [ordered]@{}
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    Add-Type -Path (Join-Path $interopDir "SASInterop.dll")
    Add-Type -Path (Join-Path $interopDir "SASOManInterop.dll")
    # As in the extension's Setup (itc.ps1).
    $factory = New-Object -TypeName SASObjectManager.ObjectFactoryMulti2Class
    $factory.ApplicationName = "SAS Extension for Positron (probe)"
    $serverDef = New-Object -TypeName SASObjectManager.ServerDefClass
    $serverDef.MachineDNSName = "localhost"
    $serverDef.Port = 0
    $serverDef.Protocol = 0
    $serverDef.ExtraNameValuePairs = "LOCALE=en_US"
    $serverDef.ClassIdentifier = "440196d4-90f0-11d0-9f41-00a024bb830c"
    $sas = $factory.CreateObjectByServer("ITC Local", $true, $serverDef, "", "")
    $result.StartSeconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1)
    $result.Step = "data provider"
    $keeper = New-Object -ComObject SASObjectManager.ObjectKeeper
    $keeper.AddObject(1, "WorkspaceObject", $sas)
    $data = New-Object -ComObject ADODB.Connection
    $data.Provider = "sas.IOMProvider"
    $data.Properties("Data Source") = "iom-id://" + $sas.UniqueIdentifier
    $data.Open()
    $result.DataProvider = "ok"
    $result.Step = "WORK library"
    $mask = ($false, $false, $false, $true, $false)
    [ref]$engineName = [string[]]@()
    [ref]$engineAttrs = New-Object 'int[,]' 0, 0
    [ref]$libraryAttrs = [int[]]@()
    [ref]$physicalName = [string[]]::new(1)
    [ref]$propertyNames = New-Object 'string[,]' 0, 0
    [ref]$propertyValues = New-Object 'string[,]' 0, 0
    $sas.DataService.UseLibref("work").LevelInfo([bool[]]$mask, $engineName, $engineAttrs, $libraryAttrs, $physicalName, $propertyNames, $propertyValues)
    $work = $physicalName.Value[0]
    $result.Work = $work
    $result.Step = "running code"
    $code = @"
%put PROBE_VERSION=&sysvlong4;
%put PROBE_ENCODING=&sysencoding;
%put PROBE_HOST=&syshostname;
%put PROBE_USER=&sysuserid;
%put PROBE_LOCALE=%sysfunc(getoption(locale));
%put PROBE_SITE=&syssite;
ods html5(id=vscode) path="$work" body="probe.htm";
proc print data=sashelp.class(obs=2); run;
ods html5(id=vscode) close;
"@
    $sas.LanguageService.Submit($code)
    $log = ""
    do {
      $chunk = $sas.LanguageService.FlushLog(32768)
      $log += $chunk
    } while ($chunk.Length -gt 0)
    foreach ($name in @("VERSION", "ENCODING", "HOST", "USER", "LOCALE", "SITE")) {
      if ($log -match "(?m)^PROBE_${name}=(.*)$") { $result["Sas$name"] = $Matches[1].Trim() }
    }
    $result.LogErrors = ([regex]::Matches($log, "(?m)^ERROR")).Count
    $result.Step = "reading results"
    # As in itcRemote.ps1: read the file through SAS and send it as base64.
    $fileRef = ""
    $file = $sas.FileService.AssignFileref("", "DISK", (Join-Path $work "probe.htm"), "", [ref]$fileRef)
    $stream = $file.OpenBinaryStream(1)
    [Byte[]]$bytes = 0x0
    $buffer = New-Object System.IO.MemoryStream
    do {
      $stream.Read(8192, [ref]$bytes)
      $buffer.Write($bytes, 0, $bytes.Length)
    } while ($bytes.Length -ge 8192)
    $stream.Close()
    $sas.FileService.DeassignFileref($file.FilerefName)
    $html = [Text.Encoding]::UTF8.GetString($buffer.ToArray())
    $result.ResultsBytes = $buffer.Length
    $result.ResultsBase64Chars = [Convert]::ToBase64String($buffer.ToArray()).Length
    $result.ResultsHaveTable = $html -match 'id="IDX'
    $result.Step = "closing"
    $data.Close()
    $keeper.RemoveObject($sas)
    $sas.Close()
    $result.Step = "done"
    $result.Ok = $true
  } catch {
    $result.Ok = $false
    $result.Error = $_.Exception.Message
    $result.HResult = "0x{0:X8}" -f $_.Exception.HResult
    if ($_.Exception.InnerException) {
      $result.InnerError = $_.Exception.InnerException.Message
    }
  }
  $result.Seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1)
  $result
}

$comResult = $null
if ($interopLoaded) {
  Say "Starting a SAS session through COM; this takes up to $ProbeSasTimeout seconds..."
  # The test runs in a separate PowerShell process, so a hang can't block the probe.
  try {
    $job = Start-Job -ScriptBlock $sasTest -ArgumentList $interopDir
    if (Wait-Job $job -Timeout $ProbeSasTimeout) {
      # Only the result; COM calls can leave other output.
      $comResult = Receive-Job $job | Select-Object -Last 1
    } else {
      Stop-Job $job
      Field "Result" "no answer after $ProbeSasTimeout seconds"
      Finding "Starting SAS through COM didn't finish in $ProbeSasTimeout seconds. Check for a sas.exe process left running under this user."
    }
    Remove-Job $job -Force
  } catch {
    Field "Background job" "can't start one ($($_.Exception.Message)); testing in this process"
    $comResult = & $sasTest $interopDir | Select-Object -Last 1
  }
} else {
  Field "Result" "skipped: interop libraries not loaded"
}
if ($comResult) {
  foreach ($key in $comResult.Keys) { Field $key $comResult[$key] }
  if ($comResult.Ok) {
    Finding "COM works: the extension's default (windowsProtocol com) should connect."
    if ($comResult.SasENCODING -and $comResult.SasENCODING -notmatch "utf-?8") {
      Finding "The SAS session encoding is $($comResult.SasENCODING). Code and log text go through COM as Unicode, so that's fine for the console; datasets keep $($comResult.SasENCODING)."
    }
  } elseif ($comResult.HResult -eq "0x80070005" -or $comResult.Error -match "denied") {
    Finding "Windows denied starting SAS through COM for this SSH login (access denied, at step '$($comResult.Step)'). Either the Windows administrator allows it (DCOM launch and activation permissions of the SAS COM server), or use windowsProtocol iom$(if ($spawnerOpen) { ', as the spawner answers on port ' + $ProbeIomPort } else { ', which needs a running SAS object spawner' })."
  } else {
    Finding "Starting SAS through COM failed at step '$($comResult.Step)': $($comResult.Error)"
  }
}
#endregion

#region Summary
Section "Summary"
if ($spawnerOpen) {
  Finding "A SAS object spawner answers on localhost:$ProbeIomPort, so windowsProtocol iom (with your SAS password) is an option."
}

foreach ($finding in $ProbeFindings) { Say "- $finding" }
Field "Finished" ((Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz"))
Field "Took seconds" ([Math]::Round(((Get-Date) - $ProbeStart).TotalSeconds, 1))
#endregion

# Blank lines: PowerShell runs the statements above only once one follows.

