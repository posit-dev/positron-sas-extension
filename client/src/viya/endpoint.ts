// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { profileConfig } from "../commands/profile";
import { ConnectionType } from "../components/profile";

/** The Viya endpoint of the active profile, or undefined for non-REST ones. */
export function getActiveViyaEndpoint(): string | undefined {
  const detail = profileConfig.getActiveProfileDetail();
  const profile = detail?.profile;
  if (!profile || profile.connectionType !== ConnectionType.Rest) {
    return undefined;
  }
  return profile.endpoint || undefined;
}

/** The compute context named by the active Viya profile, if it sets one. */
export function getActiveViyaContext(): string | undefined {
  const detail = profileConfig.getActiveProfileDetail();
  const profile = detail?.profile;
  if (!profile || profile.connectionType !== ConnectionType.Rest) {
    return undefined;
  }
  return profile.context || undefined;
}
