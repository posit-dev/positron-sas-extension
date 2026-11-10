// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Type-only imports: components/profile pulls in the VS Code API at load time,
// which this module must not need (it is unit-tested without VS Code).
import * as fs from "fs";
import * as path from "path";

import type { ConnectionType, Profile } from "../components/profile";

// ConnectionType values; the enum itself is only imported as a type (see above).
/* eslint-disable @typescript-eslint/consistent-type-assertions */
const REST = "rest" as ConnectionType.Rest;
const SSH = "ssh" as ConnectionType.SSH;
const IOM = "iom" as ConnectionType.IOM;
const COM = "com" as ConnectionType.COM;
const STDIO = "stdio" as ConnectionType.Stdio;
/* eslint-enable @typescript-eslint/consistent-type-assertions */

// Same as DEFAULT_COMPUTE_CONTEXT in components/profile.
const DEFAULT_COMPUTE_CONTEXT = "SAS Job Execution compute context";

/** Environment variable the SAS Viya configuration reads the token from. */
export const SASPY_TOKEN_ENV = "SAS_VIYA_TOKEN";

/** Environment variable with the ID of the Posit Workbench OAuth integration. */
export const SASPY_INTEGRATION_ENV = "SAS_VIYA_INTEGRATION_ID";

/**
 * saspy reads each configuration from a Python variable of that name, so
 * turn the profile name into a Python identifier.
 */
export function saspyConfigName(profileName: string): string {
  const name = profileName.replace(/\W/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `sas_${name}`;
}

/** A single-quoted Python string literal. */
function py(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A double-quoted R string literal (for the names in the R example). */
function rq(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The saspy configuration (sascfg_personal.py) for a connection profile. It
 * never contains secrets: SAS Viya reads its token from the environment.
 */
export function profileToSaspyConfig(name: string, profile: Profile): string {
  const cfg = saspyConfigName(name);
  const header = (kind: string) => [
    `# saspy configuration for profile "${name}" (${kind})`,
    `SAS_config_names = [${py(cfg)}]`,
    ``,
  ];
  switch (profile.connectionType) {
    case REST: {
      // saspy's HTTP access method talks to the SAS Viya Compute service,
      // as this profile does (#91). The token comes from outside the file,
      // and is looked up for every SASsession because tokens expire.
      const lines = [
        `# saspy configuration for profile "${name}" (SAS Viya, HTTP access method)`,
        `import json as _json`,
        `import os as _os`,
        `import time as _time`,
        ``,
        `SAS_config_names = [${py(cfg)}]`,
        ``,
        `_VIYA_URL = ${py(profile.endpoint)}`,
        ``,
        `def _viya_token():`,
        `    # Do not put tokens, passwords or client secrets in this file. The`,
        `    # token comes from the first of these that has one:`,
        `    # 1. the ${SASPY_TOKEN_ENV} environment variable (for example on Posit`,
        `    #    Connect, or from \`sas-viya auth login\`, with the token in`,
        `    #    ~/.sas/credentials.json)`,
        `    token = _os.environ.get(${py(SASPY_TOKEN_ENV)})`,
        `    if token:`,
        `        return token`,
        `    # 2. a variable on the Python main module, which R code can set with`,
        `    #    reticulate::py_set_attr(reticulate::import_main(), ${rq(SASPY_TOKEN_ENV)}, token)`,
        `    try:`,
        `        import __main__`,
        `        token = getattr(__main__, ${py(SASPY_TOKEN_ENV)}, None)`,
        `        if token:`,
        `            return token`,
        `    except ImportError:`,
        `        pass`,
        `    # 3. the Posit Workbench OAuth integration for SAS Viya (needs the`,
        `    #    posit-sdk package, and the integration ID from Managed Credentials)`,
        `    integration = _os.environ.get(${py(SASPY_INTEGRATION_ENV)}) or ${py(profile.workbenchIntegration ?? "")}`,
        `    if integration:`,
        `        try:`,
        `            from posit.workbench import Client`,
        `            creds = Client().oauth.get_credentials(audience=integration)`,
        `            if creds and creds.get('access_token'):`,
        `                return creds['access_token']`,
        `        except Exception:`,
        `            pass`,
        `    # 4. the file that the command "SAS: Save Viya Token for saspy" writes`,
        `    #    from the extension's own sign-in`,
        `    try:`,
        `        with open(_os.path.join(_os.path.expanduser('~'), '.positron-sas', 'viya-token.json')) as f:`,
        `            saved = _json.load(f)`,
        `        same_server = saved.get('endpoint', '').rstrip('/') == _VIYA_URL.rstrip('/')`,
        `        fresh = saved.get('expires_at', _time.time() + 60) > _time.time() + 30`,
        `        if same_server and fresh and saved.get('access_token'):`,
        `            return saved['access_token']`,
        `    except Exception:`,
        `        pass`,
        `    # Without a token, saspy asks for a user ID and password.`,
        `    return None`,
        ``,
        `def __getattr__(name):`,
        `    # saspy looks the definition up by name for each SASsession`,
        `    if name == ${py(cfg)}:`,
        `        return {`,
        `            'url': _VIYA_URL,`,
        `            'context': ${py(profile.context || DEFAULT_COMPUTE_CONTEXT)},`,
        `            'authtoken': _viya_token(),`,
        `        }`,
        `    raise AttributeError(name)`,
      ];
      return lines.join("\n");
    }
    case SSH: {
      const lines = [
        ...header("SSH"),
        `${cfg} = {`,
        `    'saspath': ${py(profile.saspath)},`,
        `    'ssh': '/usr/bin/ssh',`,
        `    'host': ${py(profile.host)},`,
        `    'port': ${profile.port},`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    case IOM: {
      const lines = [
        ...header("IOM"),
        `${cfg} = {`,
        `    'java': '/usr/bin/java',  # adjust path to your Java installation`,
        `    'iomhost': ${py(profile.host)},`,
        `    'iomport': ${profile.port},`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    case COM: {
      const lines = [
        ...header("COM / local Windows"),
        `${cfg} = {`,
        `    'provider': 'sas.workspace',`,
        `    'host': ${py(profile.host || "localhost")},`,
        `}`,
      ];
      return lines.join("\n");
    }
    case STDIO: {
      // saspy's STDIO access method starts the local SAS directly, like this profile.
      const lines = [
        ...header("local SAS, STDIO"),
        `${cfg} = {`,
        `    'saspath': ${py(profile.saspath)},`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    default:
      return `# Unknown connection type for profile "${name}"`;
  }
}

/** The file name saspy looks for in the working directory. */
export const SASPY_CONFIG_FILE = "sascfg_personal.py";

export type SaspyWriteResult =
  | { status: "written" | "unchanged"; path: string }
  | { status: "exists"; path: string };

/**
 * Write the configuration as sascfg_personal.py into a directory. An existing
 * file with other content is left alone unless `overwrite` is set, so callers
 * can ask the user first.
 */
export function writeSaspyConfig(
  dir: string,
  config: string,
  overwrite = false,
): SaspyWriteResult {
  const file = path.join(dir, SASPY_CONFIG_FILE);
  const text = config.endsWith("\n") ? config : `${config}\n`;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === text) {
      return { status: "unchanged", path: file };
    }
    if (!overwrite) {
      return { status: "exists", path: file };
    }
  }
  fs.writeFileSync(file, text, "utf8");
  return { status: "written", path: file };
}
