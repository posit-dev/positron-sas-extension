// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, commands } from "vscode";

import { clipRunReply, errorText } from "./agentReply";
import {
  type BaseLanguageRuntimeSession,
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

export interface AgentSasSession {
  sessionId: string;
  displayName: string;
  profile?: string;
  connectionType?: string;
  foreground: boolean;
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
  "No SAS console is running in Positron. Ask the user to start one " +
  "(the session picker, or Start New Session), then try again. " +
  "Do not use saspy as a substitute: it would be a separate SAS session " +
  "without the user's WORK tables and macro variables.";

function extraData(
  session: BaseLanguageRuntimeSession,
  key: string,
): string | undefined {
  const extra = session.runtimeMetadata.extraRuntimeData;
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

export async function listSasSessions(
  api: PositronApi,
): Promise<AgentSasSession[]> {
  const { sessions, foregroundId } = await sasConsoles(api);
  return sessions.map((s) => ({
    sessionId: s.metadata.sessionId,
    displayName: displayName(s),
    profile: extraData(s, "profile"),
    connectionType: extraData(s, "connectionType"),
    foreground: s.metadata.sessionId === foregroundId,
  }));
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
    commands.registerCommand(
      AGENT_RUN_CODE,
      (code: unknown, sessionId?: unknown) => runSasCode(api, code, sessionId),
    ),
  );
}
