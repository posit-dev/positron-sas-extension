// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as os from "os";

import type { SessionTags } from "../connection";

/**
 * Who is running a SAS console session, and where. Recorded in the audit log
 * and attached to the SAS session so submitted code can be traced back to a
 * user and a Positron / Posit Workbench session.
 */
export interface SessionIdentity {
  osUser: string;
  host: string;
  positronSessionId: string;
  profile: string;
  connectionType: string;
  /** Set when running inside Posit Workbench. */
  workbenchServerUrl?: string;
  workbenchSessionId?: string;
  /** The SAS-side account (Viya user or profile username), when known. */
  sasUser?: string;
}

// Posit Workbench sets RS_SERVER_URL in every session; Positron itself uses
// it to detect Workbench. The session id variable differs between releases,
// so take the first one that is set.
const WORKBENCH_SESSION_ID_VARS = [
  "RS_SESSION_ID",
  "RSTUDIO_SESSION_ID",
  "POSIT_SESSION_ID",
];

export function getWorkbenchInfo(env: NodeJS.ProcessEnv = process.env): {
  serverUrl?: string;
  sessionId?: string;
} {
  if (!env.RS_SERVER_URL) {
    return {};
  }
  const idVar = WORKBENCH_SESSION_ID_VARS.find((name) => env[name]);
  return {
    serverUrl: env.RS_SERVER_URL,
    sessionId: idVar ? env[idVar] : undefined,
  };
}

export function getSessionIdentity(
  positronSessionId: string,
  profile: string,
  connectionType: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionIdentity {
  let osUser = env.USER || env.USERNAME || "";
  try {
    osUser = os.userInfo().username;
  } catch {
    // Keep the environment value: userInfo() throws without a passwd entry.
  }
  const workbench = getWorkbenchInfo(env);
  return {
    osUser,
    host: os.hostname(),
    positronSessionId,
    profile,
    connectionType,
    workbenchServerUrl: workbench.serverUrl,
    workbenchSessionId: workbench.sessionId,
  };
}

/**
 * Restrict a value to characters that are safe inside a SAS comment and a
 * %let statement, so no quoting or macro-quoting is needed.
 */
export function sasSafe(value: string | undefined): string {
  return (value ?? "").replace(/[^\w.@:/-]/g, "_");
}

/** Tags for the SAS Viya compute session request. */
export function buildSessionTags(identity: SessionIdentity): SessionTags {
  const attributes: { [key: string]: string } = {
    client: "posit.positron-sas",
    osUser: identity.osUser,
    host: identity.host,
    positronSessionId: identity.positronSessionId,
  };
  if (identity.workbenchSessionId) {
    attributes.workbenchSessionId = identity.workbenchSessionId;
  }
  if (identity.workbenchServerUrl) {
    attributes.workbenchServerUrl = identity.workbenchServerUrl;
  }
  const where = identity.workbenchServerUrl ? "Posit Workbench" : "Positron";
  return {
    name: `Positron SAS (${identity.osUser})`,
    description: `${where} session ${identity.positronSessionId} on ${identity.host}`,
    attributes,
  };
}

/** Tags for one SAS Viya compute job (one console submission). */
export function buildJobTags(
  identity: SessionIdentity,
  executionId: string,
): { name: string; description: string } {
  return {
    name: "positron-console",
    description: `user=${identity.osUser} session=${identity.positronSessionId} exec=${executionId}`,
  };
}

/**
 * SAS code that records the identity in global macro variables, so programs
 * and autoexecs can reference &POSIT_USER and &POSIT_SESSION.
 */
export function buildIdentityMacroCode(identity: SessionIdentity): string {
  return [
    "%global POSIT_USER POSIT_SESSION POSIT_WORKBENCH_SESSION;",
    `%let POSIT_USER=${sasSafe(identity.osUser)};`,
    `%let POSIT_SESSION=${sasSafe(identity.positronSessionId)};`,
    `%let POSIT_WORKBENCH_SESSION=${sasSafe(identity.workbenchSessionId)};`,
  ].join(" ");
}

/**
 * A one-line SAS comment identifying a console submission. It lands in the
 * SAS log (the console runs with OPTIONS SOURCE), which SAS Viya keeps with
 * the job.
 */
export function buildSubmissionComment(
  identity: SessionIdentity,
  executionId: string,
): string {
  return `/* positron: user=${sasSafe(identity.osUser)} session=${sasSafe(identity.positronSessionId)} exec=${sasSafe(executionId)} */`;
}

/**
 * Put the submission comment on the first line of `code`. It never adds a
 * line, so log line numbers still map back to the submitted source.
 */
export function tagCode(code: string, comment: string): string {
  return `${comment} ${code}`;
}
