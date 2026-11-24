# Copyright © 2026, Posit Software, PBC. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Loaded after itc.ps1 when PowerShell runs on the SAS server and the
# extension runs on another machine (over SSH). Files go to the extension
# as base64 on stdout, as the extension can't read the server's disk.

$global:ResultsBase64StartTag = "<ResultsBase64>"
$global:ResultsBase64EndTag = "</ResultsBase64>"
# Characters per line of base64 output.
$global:Base64LineLength = 65536

function ReadServerFile([object]$runner, [string]$filePath) {
  $fileRef = ""
  $objFile = $runner.objSAS.FileService.AssignFileref("", "DISK", $filePath, "", [ref] $fileRef)
  $objStream = $objFile.OpenBinaryStream(1)
  [Byte[]] $bytes = 0x0
  $buffer = New-Object System.IO.MemoryStream
  try {
    do {
      $objStream.Read(8192, [ref] $bytes)
      $buffer.Write($bytes, 0, $bytes.Length)
    } while ($bytes.Length -ge 8192)
  } finally {
    $objStream.Close()
    $runner.objSAS.FileService.DeassignFileref($objFile.FilerefName)
  }
  return , $buffer.ToArray()
}

# Writes a results file between the base64 tags, then the results-fetched
# line code. A file that can't be read is sent empty, so the run ends.
function FetchResultsFileBase64([object]$runner, [string]$filePath) {
  Write-Host $global:ResultsBase64StartTag
  try {
    $base64 = [Convert]::ToBase64String((ReadServerFile $runner $filePath))
    for ($i = 0; $i -lt $base64.Length; $i += $global:Base64LineLength) {
      Write-Host $base64.Substring($i, [Math]::Min($global:Base64LineLength, $base64.Length - $i))
    }
  } catch {
  }
  Write-Host $global:ResultsBase64EndTag
  Write-Host "$($global:env.LineCodes.ResultsFetchedCode)"
}

# Writes a file's content as {success, data} JSON, data being base64.
function FetchFileContentBase64([object]$runner, [string]$filePath) {
  try {
    $data = [Convert]::ToBase64String((ReadServerFile $runner $filePath))
    Write-Host (@{success = $true; data = $data } | ConvertTo-Json -Compress)
  } catch {
    Write-Host (@{success = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
}
