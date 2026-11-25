// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Type-only imports: components/profile pulls in the VS Code API at load time,
// which this module must not need (it is unit-tested without VS Code).
import * as fs from "fs";
import * as path from "path";

import type { ConnectionType, Profile } from "../components/profile";
import { isWindowsSSHProfile } from "../connection/ssh/platform";

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
 * Compute context for tokens without a user, such as the token of a Posit
 * Connect "Service Account" OAuth integration (client credentials grant). SAS
 * Viya runs those only in a compute context with a service account
 * (runServerAs).
 */
export const CONNECT_COMPUTE_CONTEXT = "Posit Connect compute context";

/** Environment variable that overrides CONNECT_COMPUTE_CONTEXT. */
export const SASPY_CONNECT_CONTEXT_ENV = "SAS_VIYA_CONNECT_CONTEXT";

/**
 * Environment variable with the GUID of the Connect OAuth integration, needed
 * only when more than one integration is associated with the content.
 */
export const SASPY_CONNECT_INTEGRATION_ENV = "SAS_VIYA_CONNECT_INTEGRATION_ID";

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
        `_CONTEXT = ${py(profile.context || DEFAULT_COMPUTE_CONTEXT)}`,
        `# A token without a user (client credentials, such as a Posit Connect "Service`,
        `# Account" integration) runs only in a context with a service account (runServerAs).`,
        `_SERVICE_CONTEXT = _os.environ.get(${py(SASPY_CONNECT_CONTEXT_ENV)}) or ${py(CONNECT_COMPUTE_CONTEXT)}`,
        ``,
        `def _connect_token():`,
        `    # Exchange the content session token for the token of the OAuth`,
        `    # integration associated with the content (standard library only).`,
        `    session = None`,
        `    token_file = _os.environ.get('CONNECT_CONTENT_SESSION_TOKEN_FILE')`,
        `    if token_file:`,
        `        try:`,
        `            with open(token_file) as f:`,
        `                session = f.read().strip()`,
        `        except OSError:`,
        `            pass`,
        `    session = session or _os.environ.get('CONNECT_CONTENT_SESSION_TOKEN')`,
        `    if not session:`,
        `        return None`,
        `    import urllib.error, urllib.parse, urllib.request`,
        `    server = _os.environ.get('CONNECT_SERVER')`,
        `    if not server:`,
        `        raise RuntimeError('Running on Posit Connect, but CONNECT_SERVER is not set')`,
        `    data = {`,
        `        'grant_type': 'urn:ietf:params:oauth:grant-type:token-exchange',`,
        `        'subject_token_type': 'urn:posit:connect:content-session-token',`,
        `        'subject_token': session,`,
        `        'requested_token_type': 'urn:ietf:params:oauth:token-type:access_token',`,
        `    }`,
        `    if _os.environ.get(${py(SASPY_CONNECT_INTEGRATION_ENV)}):`,
        `        data['audience'] = _os.environ[${py(SASPY_CONNECT_INTEGRATION_ENV)}]`,
        `    headers = {'Accept': 'application/json'}`,
        `    if _os.environ.get('CONNECT_API_KEY'):`,
        `        headers['Authorization'] = 'Key ' + _os.environ['CONNECT_API_KEY']`,
        `    request = urllib.request.Request(`,
        `        server.rstrip('/') + '/__api__/v1/oauth/integrations/credentials',`,
        `        data=urllib.parse.urlencode(data).encode(), headers=headers)`,
        `    try:`,
        `        with urllib.request.urlopen(request, timeout=30) as response:`,
        `            return _json.load(response).get('access_token')`,
        `    except urllib.error.HTTPError as e:`,
        `        detail = e.read()[:300].decode(errors='replace')`,
        `        raise RuntimeError(`,
        `            'Posit Connect could not provide a SAS Viya token (HTTP %d: %s). In Connect, '`,
        `            'add the SAS Viya "Service Account" OAuth integration to this content '`,
        `            '(Access > Integrations).' % (e.code, detail)) from None`,
        ``,
        `def _is_client_token(token):`,
        `    # SAS Logon puts user_name into the tokens of users only.`,
        `    try:`,
        `        import base64`,
        `        payload = token.split('.')[1]`,
        `        claims = _json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))`,
        `        return 'user_name' not in claims`,
        `    except Exception:`,
        `        return False`,
        ``,
        `def _viya_token():`,
        `    # Do not put tokens, passwords or client secrets in this file. The`,
        `    # token comes from the first of these that has one:`,
        `    # 1. the ${SASPY_TOKEN_ENV} environment variable (for example from`,
        `    #    \`sas-viya auth login\`, with the token in ~/.sas/credentials.json)`,
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
        `    # 3. on Posit Connect, the SAS Viya "Service Account" OAuth integration`,
        `    #    added to the content (in Connect: Access > Integrations)`,
        `    token = _connect_token()`,
        `    if token:`,
        `        return token`,
        `    # 4. the Posit Workbench OAuth integration for SAS Viya (needs the`,
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
        `    # 5. the file that the command "SAS: Save Viya Token for saspy" writes`,
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
        `        token = _viya_token()`,
        `        return {`,
        `            'url': _VIYA_URL,`,
        `            'context': _SERVICE_CONTEXT if token and _is_client_token(token) else _CONTEXT,`,
        `            'authtoken': token,`,
        `        }`,
        `    raise AttributeError(name)`,
      ];
      return lines.join("\n");
    }
    case SSH: {
      if (isWindowsSSHProfile(profile)) {
        // saspy's SSH access method only reaches SAS on Linux. Its IOM access
        // method reaches SAS on Windows through the object spawner.
        const lines = [
          ...header("IOM, SAS on Windows"),
          `# saspy can't use SSH to reach SAS on Windows. This uses the SAS object`,
          `# spawner on the server instead, which saspy reaches with Java.`,
          `${cfg} = {`,
          `    'java': '/usr/bin/java',  # adjust path to your Java installation`,
          `    'iomhost': ${py(profile.host)},`,
          `    'iomport': ${profile.iomPort || 8591},`,
          `    'encoding': 'utf-8',`,
          `}`,
        ];
        return lines.join("\n");
      }
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

export interface SaspyWriteResult {
  status: "written" | "unchanged";
  path: string;
  /** Set when a different file was there: where its content was kept. */
  backupPath?: string;
}

/** `20260131-094501`, in local time, for backup file names. */
function backupTimestamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

/**
 * Copy `file` to `<file>.old-<timestamp>`. The name does not end in `.py`, so
 * Python never imports it. An existing backup is never overwritten: a clash
 * within the same second gets a counter.
 */
function backUpFile(file: string, date: Date): string {
  const base = `${file}.old-${backupTimestamp(date)}`;
  for (let n = 0; ; n++) {
    const target = n === 0 ? base : `${base}-${n}`;
    try {
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
  }
}

/**
 * Write the configuration as sascfg_personal.py into a directory. A file with
 * the same content is left alone. A file with other content is copied to
 * `sascfg_personal.py.old-<timestamp>` first and then replaced, so nothing is
 * lost and no one has to be asked (the caller may be an unattended assistant).
 */
export function writeSaspyConfig(
  dir: string,
  config: string,
  now: Date = new Date(),
): SaspyWriteResult {
  const file = path.join(dir, SASPY_CONFIG_FILE);
  const text = config.endsWith("\n") ? config : `${config}\n`;
  let backupPath: string | undefined;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === text) {
      return { status: "unchanged", path: file };
    }
    backupPath = backUpFile(file, now);
  }
  fs.writeFileSync(file, text, "utf8");
  return { status: "written", path: file, backupPath };
}
