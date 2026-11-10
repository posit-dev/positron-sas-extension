// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Hand the SAS Viya access token of the extension's sign-in to saspy. A
// Quarto render runs R and Python in another process and cannot reach the
// extension's session, so the extension writes the token to a file that only
// the user can read, and the saspy configuration reads it. This module does
// not use the vscode API, so it can be unit tested without a VS Code host.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** What the file holds. The saspy configuration reads these fields. */
export interface ViyaTokenFile {
  /** SAS Viya endpoint the token is for. The configuration checks it. */
  endpoint: string;
  access_token: string;
  /** Expiry as seconds since the epoch, when known. */
  expires_at?: number;
}

/** `~/.positron-sas/viya-token.json`. The saspy configuration uses the same path. */
export function viyaTokenFilePath(home: string = os.homedir()): string {
  return path.join(home, ".positron-sas", "viya-token.json");
}

/**
 * The `exp` claim of a JWT access token, in seconds since the epoch, or
 * undefined when the token is not a JWT or has no expiry.
 */
export function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (claims && typeof claims === "object" && "exp" in claims) {
      return typeof claims.exp === "number" ? claims.exp : undefined;
    }
  } catch {
    // Not a JWT.
  }
  return undefined;
}

/**
 * Write the token file: the folder is private to the user (0700) and so is the
 * file (0600). The write goes to a temporary file first, so a reader never sees
 * half a token.
 */
export function writeViyaTokenFile(
  file: string,
  endpoint: string,
  accessToken: string,
  expiresAt: number | undefined = jwtExpiry(accessToken),
): ViyaTokenFile {
  const content: ViyaTokenFile = {
    endpoint: endpoint.replace(/\/+$/, ""),
    access_token: accessToken,
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(content), { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  return content;
}
