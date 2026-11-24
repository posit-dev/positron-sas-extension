// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Type-only import: components/profile pulls in the VS Code API at load
// time, and saspyConfig, which is unit-tested without VS Code, uses this.
import type { ConnectionType, Profile } from "../../components/profile";

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const COM = "com" as ConnectionType.COM;

/** The fields of an SSH profile that say which platform SAS runs on. */
interface SSHPlatformFields {
  connectionType?: string;
  platform?: "unix" | "windows";
  saspath?: string;
}

/**
 * Whether an SSH profile connects to SAS on Windows. The `platform` field
 * decides; without it, a Windows-style `saspath` (a drive letter, a
 * backslash or a `.exe` ending) does.
 */
export function isWindowsSSHProfile(profile: SSHPlatformFields): boolean {
  if (profile?.connectionType !== "ssh") {
    return false;
  }
  if (profile.platform) {
    return profile.platform === "windows";
  }
  const saspath = profile.saspath?.trim() ?? "";
  return (
    /^[A-Za-z]:[\\/]/.test(saspath) ||
    saspath.includes("\\") ||
    /\.exe$/i.test(saspath)
  );
}

/**
 * The connection type that picks the Libraries and Server Files views for
 * a profile. SAS on Windows over SSH runs the same PowerShell bridge as a
 * COM connection, so it gets the COM views.
 */
export function viewConnectionType(
  profile: Profile | undefined,
): ConnectionType | undefined {
  return isWindowsSSHProfile(profile) ? COM : profile?.connectionType;
}

/** SAS options that only work when SAS starts, which a COM session can't set. */
const STARTUP_ONLY_OPTIONS = new Set([
  "altlog",
  "altprint",
  "autoexec",
  "awstitle",
  "config",
  "dms",
  "dmsexp",
  "encoding",
  "icon",
  "initstmt",
  "log",
  "logparm",
  "memsize",
  "news",
  "print",
  "rsasuser",
  "sasinitialfolder",
  "sasuser",
  "set",
  "splash",
  "stdio",
  "sysin",
  "terminal",
  "termstmt",
  "unbuflog",
  "work",
]);

/**
 * Turns an SSH profile's `sasOptions` into the `name=value` options a COM
 * session sets after SAS starts. Startup-only options are dropped; a value
 * given as its own item (`["-linesize", "max"]`) joins its option.
 */
export function toWindowsSasOptions(sasOptions: string[] | undefined): {
  options: string[];
  dropped: string[];
} {
  const options: string[] = [];
  const dropped: string[] = [];
  const items = (sasOptions ?? [])
    .map((item) => item.trim())
    .filter((item) => item);
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    const next = items[i + 1];
    if (
      item.startsWith("-") &&
      !/[= ]/.test(item) &&
      next !== undefined &&
      !next.startsWith("-")
    ) {
      item = `${item}=${next}`;
      i++;
    }
    const name = item
      .replace(/^-/, "")
      .split(/[= ]/)[0]
      .toLowerCase()
      .replace(/^no/, "");
    if (STARTUP_ONLY_OPTIONS.has(name)) {
      dropped.push(item);
    } else {
      options.push(item.replace(/^-/, ""));
    }
  }
  return { options, dropped };
}
