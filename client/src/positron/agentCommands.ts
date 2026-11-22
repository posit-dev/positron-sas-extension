// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, commands } from "vscode";

import { clipRunReply, errorText } from "./agentReply";
import {
  type BaseLanguageRuntimeSession,
  type LanguageRuntimeMetadata,
  LanguageRuntimeSessionMode,
  type PositronApi,
  RuntimeCodeExecutionMode,
} from "./positron-types";

/**
 * Commands that let external coding agents use the SAS console (#156).
 *
 * Positron's MCP server lists and runs only Jupyter kernels that its
 * supervisor manages, so a SAS console is invisible to its session tools.
 * It does offer agents the commands whose package.json entry has an `agent`
 * block (Positron 2026.11 and later), through list_positron_commands and
 * run_positron_command. These are those commands.
 */
export const AGENT_LIST_SESSIONS = "SAS.agent.listSessions";
export const AGENT_RUN_CODE = "SAS.agent.runCode";
export const AGENT_START_CONSOLE = "SAS.agent.startConsole";

export interface AgentSasSession {
  sessionId: string;
  displayName: string;
  profile?: string;
  connectionType?: string;
  foreground: boolean;
}

export interface AgentSasProfile {
  name: string;
  connectionType?: string;
  /** The profile a new console uses when the agent names none. */
  active: boolean;
}

export interface AgentStartReply extends AgentSasSession {
  /** False when a SAS console was already running and was returned instead. */
  started: boolean;
}

export interface AgentRunReply {
  sessionId: string;
  /** The SAS log as the console shows it. */
  log: string;
  /** The plain-text copy of the report, when the run made one. */
  result: string;
  /** Set when the run failed, e.g. the log has errors. */
  error?: string;
  /** True when log or result were shortened to fit the reply. */
  clipped: boolean;
}

const NO_CONSOLE =
  "No SAS console is running in Positron. Ask the user whether to start " +
  `one, then call ${AGENT_START_CONSOLE}, or ask the user to start it. ` +
  "Do not use saspy as a substitute: it would be a separate SAS session " +
  "without the user's WORK tables and macro variables.";

function extraData(
  runtime: LanguageRuntimeMetadata,
  key: string,
): string | undefined {
  const extra = runtime.extraRuntimeData;
  if (extra && typeof extra === "object" && key in extra) {
    const value: unknown = Reflect.get(extra, key);
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** The name Positron shows for the session, e.g. "SAS (Viya) 2". */
function displayName(session: BaseLanguageRuntimeSession): string {
  const dynState: unknown = Reflect.get(session, "dynState");
  if (dynState && typeof dynState === "object") {
    const name: unknown = Reflect.get(dynState, "sessionName");
    if (typeof name === "string" && name) {
      return name;
    }
  }
  return session.runtimeMetadata.runtimeName;
}

async function sasConsoles(
  api: PositronApi,
): Promise<{ sessions: BaseLanguageRuntimeSession[]; foregroundId?: string }> {
  const [all, foreground] = await Promise.all([
    api.runtime.getActiveSessions(),
    api.runtime.getForegroundSession(),
  ]);
  const sessions = all.filter(
    (s) =>
      s.runtimeMetadata.languageId === "sas" &&
      s.metadata.sessionMode === LanguageRuntimeSessionMode.Console,
  );
  return { sessions, foregroundId: foreground?.metadata.sessionId };
}

function sessionInfo(
  session: BaseLanguageRuntimeSession,
  foregroundId: string | undefined,
): AgentSasSession {
  return {
    sessionId: session.metadata.sessionId,
    displayName: displayName(session),
    profile: extraData(session.runtimeMetadata, "profile"),
    connectionType: extraData(session.runtimeMetadata, "connectionType"),
    foreground: session.metadata.sessionId === foregroundId,
  };
}

/** The SAS runtimes Positron knows, one per connection profile. */
async function sasRuntimes(
  api: PositronApi,
): Promise<LanguageRuntimeMetadata[]> {
  const all = await api.runtime.getRegisteredRuntimes();
  return all.filter((r) => r.languageId === "sas");
}

export async function listSasProfiles(
  api: PositronApi,
): Promise<AgentSasProfile[]> {
  const [runtimes, preferred] = await Promise.all([
    sasRuntimes(api),
    api.runtime.getPreferredRuntime("sas"),
  ]);
  return runtimes.map((r) => ({
    name: extraData(r, "profile") ?? r.runtimeShortName,
    connectionType: extraData(r, "connectionType"),
    active: r.runtimeId === preferred?.runtimeId,
  }));
}

export async function listSasSessions(
  api: PositronApi,
): Promise<{ sessions: AgentSasSession[]; profiles: AgentSasProfile[] }> {
  const [{ sessions, foregroundId }, profiles] = await Promise.all([
    sasConsoles(api),
    listSasProfiles(api),
  ]);
  return {
    sessions: sessions.map((s) => sessionInfo(s, foregroundId)),
    profiles,
  };
}

/**
 * Start a SAS console for an agent, unless one is running: then return the
 * foreground (or first) one. The console belongs to the user, like one they
 * start themselves. Starting may need the user, e.g. to sign in to SAS Viya.
 */
export async function startSasConsoleForAgent(
  api: PositronApi,
  profile?: unknown,
): Promise<AgentStartReply> {
  const { sessions, foregroundId } = await sasConsoles(api);
  if (sessions.length > 0) {
    const running =
      sessions.find((s) => s.metadata.sessionId === foregroundId) ??
      sessions[0];
    return { ...sessionInfo(running, foregroundId), started: false };
  }
  const runtimes = await sasRuntimes(api);
  let runtime: LanguageRuntimeMetadata | undefined;
  if (typeof profile === "string" && profile) {
    runtime = runtimes.find(
      (r) => (extraData(r, "profile") ?? r.runtimeShortName) === profile,
    );
    if (!runtime) {
      const names = runtimes.map(
        (r) => extraData(r, "profile") ?? r.runtimeShortName,
      );
      throw new Error(
        `There is no SAS connection profile '${profile}'. ` +
          (names.length
            ? `The profiles are: ${names.join(", ")}.`
            : "No SAS connection profile is set up; ask the user to add one."),
      );
    }
  } else {
    runtime = await api.runtime.getPreferredRuntime("sas");
  }
  if (!runtime) {
    throw new Error(
      "No SAS connection profile is set up, so no SAS console can start. " +
        "Ask the user to add a profile (SAS: Add New Connection Profile).",
    );
  }
  const session = await api.runtime.startLanguageRuntime(
    runtime.runtimeId,
    runtime.runtimeShortName,
  );
  const foreground = await api.runtime.getForegroundSession();
  return {
    ...sessionInfo(session, foreground?.metadata.sessionId),
    started: true,
  };
}

/** The console to run in: the one asked for, else the foreground or only one. */
async function pickSession(
  api: PositronApi,
  sessionId: unknown,
): Promise<string> {
  const { sessions, foregroundId } = await sasConsoles(api);
  if (sessions.length === 0) {
    throw new Error(NO_CONSOLE);
  }
  const ids = sessions.map((s) => s.metadata.sessionId);
  if (typeof sessionId === "string" && sessionId) {
    if (!ids.includes(sessionId)) {
      throw new Error(
        `No SAS console has the session ID '${sessionId}'. ` +
          `Call ${AGENT_LIST_SESSIONS} for the running ones.`,
      );
    }
    return sessionId;
  }
  if (foregroundId && ids.includes(foregroundId)) {
    return foregroundId;
  }
  if (ids.length === 1) {
    return ids[0];
  }
  throw new Error(
    `${ids.length} SAS consoles are running and none is in the foreground. ` +
      `Pass a sessionId from ${AGENT_LIST_SESSIONS}.`,
  );
}

export async function runSasCode(
  api: PositronApi,
  code: unknown,
  sessionId?: unknown,
): Promise<AgentRunReply> {
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("Argument 'code' must be the SAS code to run.");
  }
  const target = await pickSession(api, sessionId);
  const out: string[] = [];
  let result = "";
  let error: string | undefined;
  try {
    const value = await api.runtime.executeCode(
      "sas",
      code,
      false,
      true,
      RuntimeCodeExecutionMode.Interactive,
      undefined,
      {
        onOutput: (text) => out.push(text),
        onError: (text) => out.push(text),
      },
      target,
    );
    const plain = value?.["text/plain"];
    result = typeof plain === "string" ? plain : "";
  } catch (e) {
    error = errorText(e);
  }
  const clipped = clipRunReply(out.join(""), result);
  return {
    sessionId: target,
    log: clipped.log,
    result: clipped.result,
    ...(error ? { error } : {}),
    clipped: clipped.clipped,
  };
}

export function registerAgentCommands(api: PositronApi): Disposable {
  return Disposable.from(
    commands.registerCommand(AGENT_LIST_SESSIONS, () => listSasSessions(api)),
    commands.registerCommand(AGENT_START_CONSOLE, (profile?: unknown) =>
      startSasConsoleForAgent(api, profile),
    ),
    commands.registerCommand(
      AGENT_RUN_CODE,
      (code: unknown, sessionId?: unknown) => runSasCode(api, code, sessionId),
    ),
  );
}
