// Copyright © 2022-2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import {
  AuthType,
  ConnectionType,
  ProfileConfig,
  ProfileDetail,
  ViyaProfile,
  toAutoExecLines,
} from "../components/profile";
import {
  createSession as createITCSession,
  getSession as getITCSession,
} from "./itc";
import { ITCProtocol } from "./itc/types";
import {
  Config as RestConfig,
  createSession as createRestSession,
  getSession as getRestSession,
} from "./rest";
import {
  Error2 as ComputeError,
  LogLine as ComputeLogLine,
  LogLineTypeEnum as ComputeLogLineTypeEnum,
} from "./rest/api/compute";
import { Session } from "./session";
import {
  createSession as createSSHSession,
  getSession as getSSHSession,
} from "./ssh";
import {
  createSession as createStdioSession,
  getSession as getStdioSession,
} from "./stdio";

let profileConfig: ProfileConfig;

export type ErrorRepresentation = ComputeError;
export type LogLine = ComputeLogLine;
export type LogLineTypeEnum = ComputeLogLineTypeEnum;
export type OnLogFn = (logs: LogLine[]) => void;

export interface RunResult {
  html5?: string;
  title?: string;
}

export interface BaseConfig {
  sasOptions?: string[];
  autoExecLines?: string[];
  sessionTags?: SessionTags;
}

/** Name, description and attributes recorded on a new SAS Viya compute session. */
export interface SessionTags {
  name?: string;
  description?: string;
  attributes?: { [key: string]: string };
}

let sessionTags: SessionTags | undefined;

/** Set the tags added to SAS Viya compute sessions created from now on. */
export function setSessionTags(tags: SessionTags | undefined): void {
  sessionTags = tags;
}

function getProfileConfig(): ProfileConfig {
  if (!profileConfig) {
    profileConfig = new ProfileConfig();
  }
  return profileConfig;
}

function validate(detail: ProfileDetail | undefined) {
  const validProfile = getProfileConfig().validateProfile(detail);

  if (validProfile.type === AuthType.Error) {
    throw new Error(validProfile.error);
  }
  return validProfile.profile;
}

function invalidConnectionType(): Error {
  return new Error(l10n.t("Invalid connectionType. Check Profile settings."));
}

/** The shared session of the active profile. */
export function getSession(): Session {
  // retrieve active & valid profile
  const profile = validate(getProfileConfig().getActiveProfileDetail());

  switch (profile?.connectionType) {
    case ConnectionType.Rest:
      return getRestSession(toRestConfig(profile));
    case ConnectionType.SSH:
      return getSSHSession(profile);
    case ConnectionType.Stdio:
      return getStdioSession(profile);
    case ConnectionType.COM:
      return getITCSession(profile, ITCProtocol.COM);
    case ConnectionType.IOM:
      return getITCSession(profile, ITCProtocol.IOMBridge);
    default:
      throw invalidConnectionType();
  }
}

/**
 * A new session of the named profile, separate from the shared session
 * returned by {@link getSession}. The caller owns and closes it.
 */
export function createSessionForProfile(name: string): Session {
  const profile = validate(getProfileConfig().getProfileDetail(name));

  switch (profile?.connectionType) {
    case ConnectionType.Rest:
      return createRestSession(toRestConfig(profile));
    case ConnectionType.SSH:
      return createSSHSession(profile);
    case ConnectionType.Stdio:
      return createStdioSession(profile);
    case ConnectionType.COM:
      return createITCSession(profile, ITCProtocol.COM);
    case ConnectionType.IOM:
      return createITCSession(profile, ITCProtocol.IOMBridge);
    default:
      throw invalidConnectionType();
  }
}

/**
 * Translates a {@link ViyaProfile} interface to a {@link RestConfig} interface.
 * @param profile an input {@link ViyaProfile} to translate.
 * @returns RestConfig instance derived from the input profile.
 */
function toRestConfig(profile: ViyaProfile): RestConfig {
  const mapped: RestConfig = profile;
  mapped.sessionTags = sessionTags;
  if (profile.autoExec) {
    mapped.autoExecLines = toAutoExecLines(profile.autoExec);
  }
  return mapped;
}
