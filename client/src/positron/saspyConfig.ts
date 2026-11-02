// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Type-only imports: components/profile pulls in the VS Code API at load time,
// which this module must not need (it is unit-tested without VS Code).
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
      // as this profile does (#91).
      const lines = [
        `# saspy configuration for profile "${name}" (SAS Viya, HTTP access method)`,
        `import os`,
        ``,
        `SAS_config_names = [${py(cfg)}]`,
        ``,
        `${cfg} = {`,
        `    'url': ${py(profile.endpoint)},`,
        `    'context': ${py(profile.context || DEFAULT_COMPUTE_CONTEXT)},`,
        `    # Sign in with a SAS Viya access token from the environment. Do not`,
        `    # put tokens, passwords or client secrets in this file. To get a`,
        `    # token, sign in with the SAS Viya CLI (\`sas-viya auth login\`; the`,
        `    # token is in ~/.sas/credentials.json) or ask your SAS administrator,`,
        `    # then set ${SASPY_TOKEN_ENV} (on Posit Connect, as an environment`,
        `    # variable of the content). Tokens expire, so renew it when needed.`,
        `    # Without a token, saspy asks for a user ID and password.`,
        `    'authtoken': os.environ.get(${py(SASPY_TOKEN_ENV)}),`,
        `}`,
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
