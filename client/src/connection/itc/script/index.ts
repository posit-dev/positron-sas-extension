// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import fs from "fs";
import path from "path";

type ScriptProperties = {
  interopLibraryFolderPath?: string;
  /** PowerShell runs on another machine, without the script's folder. */
  remote?: boolean;
};

const readScriptFile = (name: string): string =>
  fs.readFileSync(path.join(__dirname, name)).toString();

// itc.ps1 reads env.json from the current folder.
const ENV_JSON_LINE =
  '$global:env = (Get-Content -Path "$PWD\\\\env.json" -Raw) | ConvertFrom-Json';

export const getScript = ({
  interopLibraryFolderPath = "",
  remote = false,
}: ScriptProperties) => {
  if (!remote) {
    return `
Set-Location -Path "${__dirname}"
$global:interopLibraryFolderPath="${interopLibraryFolderPath}"

${readScriptFile("itc.ps1")}
`;
  }
  // On a remote machine, env.json is inlined, and itc.ps1 is followed by
  // the remote runner, which sends files over stdout.
  const itc = readScriptFile("itc.ps1");
  if (!itc.includes(ENV_JSON_LINE)) {
    throw new Error("itc.ps1 no longer loads env.json as expected");
  }
  return `
$global:interopLibraryFolderPath="${interopLibraryFolderPath}"
$global:env = @'
${readScriptFile("env.json")}
'@ | ConvertFrom-Json

${itc.replace(ENV_JSON_LINE, "")}

${readScriptFile("itcRemote.ps1")}
`;
};
