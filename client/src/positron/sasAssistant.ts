// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type {
  Disposable,
  ExtensionContext,
  LanguageModelToolInvocationOptions,
} from "vscode";
import { EventEmitter } from "vscode";

import { ConnectionType, ProfileConfig } from "../components/profile";
import type { SasClient } from "./sasClient";
import { SASPY_TOKEN_ENV, profileToSaspyConfig } from "./saspyConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListTablesInput {
  library: string;
}

interface DescribeTableInput {
  library: string;
  table: string;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

async function listLibraries(client: SasClient): Promise<vscode.LanguageModelToolResult> {
  const libs = await client.getLibraryList();
  if (libs.length === 0) {
    return textResult("No SAS libraries are currently assigned in this session.");
  }
  return textResult(`Available SAS libraries:\n${libs.join("\n")}`);
}

async function listTables(
  client: SasClient,
  input: ListTablesInput,
): Promise<vscode.LanguageModelToolResult> {
  const members = await client.getLibraryMembers(input.library);
  if (members.length === 0) {
    return textResult(`Library ${input.library} has no datasets or views.`);
  }
  const lines = members.map(
    (m) => `${input.library}.${m.name} (${m.type.toLowerCase()})`,
  );
  return textResult(`Tables in ${input.library}:\n${lines.join("\n")}`);
}

async function describeTable(
  client: SasClient,
  input: DescribeTableInput,
): Promise<vscode.LanguageModelToolResult> {
  const [cols, rowCount] = await Promise.all([
    client.getDatasetColumns(input.library, input.table),
    client.getDatasetRowCount(input.library, input.table),
  ]);

  if (cols.length === 0) {
    return textResult(
      `Dataset ${input.library}.${input.table} not found or has no columns.`,
    );
  }

  const colLines = cols.map((c) => {
    const fmt = c.format ? `, format: ${c.format}` : "";
    return `  ${c.name} (${c.type}${c.length ? `, length: ${c.length}` : ""}${fmt})`;
  });

  return textResult(
    `${input.library}.${input.table}: ${rowCount} rows, ${cols.length} columns\n` +
      `Columns:\n${colLines.join("\n")}`,
  );
}

function exportSaspyConfig(): vscode.LanguageModelToolResult {
  const profileConfig = new ProfileConfig();
  const activeProfileName = profileConfig.getActiveProfile();

  if (!activeProfileName) {
    return textResult(
      "No active SAS profile is configured. Set up a profile in SAS.connectionProfiles first.",
    );
  }

  const profile = profileConfig.getProfileByName(activeProfileName);
  if (!profile) {
    return textResult(`Profile "${activeProfileName}" not found in settings.`);
  }

  const config = profileToSaspyConfig(activeProfileName, profile);
  const output = [
    `## saspy configuration (sascfg_personal.py)`,
    ``,
    config,
    ``,
    `## Setup instructions`,
    ``,
    `1. Install sasquatch: \`install.packages("sasquatch")\``,
    `2. Install saspy from R: \`sasquatch::install_saspy()\``,
    `3. Save the above config as \`sascfg_personal.py\` in the working directory`,
    `   (alongside the .qmd file, so it can be deployed to Posit Connect)`,
  ];
  if (profile.connectionType === ConnectionType.Rest) {
    output.push(
      `4. Before rendering, run the SAS.saveViyaTokenForSaspy command to save the token of`,
      `   the extension's sign-in for saspy, or set the ${SASPY_TOKEN_ENV} environment variable`,
      `   to a SAS Viya access token (see the comment in the config). Never write the token`,
      `   into the report or the config`,
    );
  }

  return textResult(output.join("\n"));
}

// ─── Session context provider ─────────────────────────────────────────────────

interface SasSessionInfo {
  profileName: string;
  isActive: boolean;
}

/**
 * Provides the active SAS session profile as workspace context so Positron
 * Assistant always knows which SAS server the user is connected to.
 */
export class SasWorkspaceContextProvider {
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeWorkspaceChatContext = this.changeEmitter.event;

  private sessionInfo: SasSessionInfo | undefined;

  updateSession(info: SasSessionInfo | undefined): void {
    this.sessionInfo = info;
    this.changeEmitter.fire();
  }

  // Positron calls `provideChatContext` on the registered provider
  provideChatContext() {
    return this.provideWorkspaceChatContext();
  }

  provideWorkspaceChatContext() {
    if (!this.sessionInfo?.isActive) {
      return [];
    }
    return [
      {
        label: "SAS Session",
        modelDescription:
          `The user has an active SAS session using profile "${this.sessionInfo.profileName}". ` +
          `Use the sas_list_libraries, sas_list_tables, and sas_describe_table tools to ` +
          `explore available data before generating SAS code.`,
        value: `Active SAS profile: ${this.sessionInfo.profileName}`,
      },
      // Posit Assistant does not read this provider. For it, the same guidance
      // lives in assistant-skills/sas-quarto-report; keep the two in step.
      {
        label: "SAS Quarto Integration",
        modelDescription:
          `When the user asks to create a Quarto document (.qmd) or report with SAS code, use the ` +
          `sasquatch R package; do not ask whether to use R/haven or Python/pandas. sasquatch enables SAS code chunks in Quarto documents via saspy. ` +
          `Setup steps: (1) Check that sasquatch is installed; if it is not, ask the user whether to install it with install.packages("sasquatch"), ` +
          `(2) Install saspy by running sasquatch::install_saspy() in R, ` +
          `(3) Export the saspy configuration without waiting to be asked: run the SAS.exportSaspyConfig command, or call the sas_export_saspy_config tool and save the result ` +
          `as sascfg_personal.py in the working directory (not ~/.config/saspy) so the project ` +
          `is self-contained and deployable to Posit Connect, ` +
          `(4) In the .qmd file, start with an {r} chunk that runs library(sasquatch) and sas_connect(). ` +
          `This first {r} chunk is required: without it Quarto picks the Jupyter engine and the {sas} chunks fail, ` +
          `(5) Use \`\`\`{sas} code chunks for SAS code. ` +
          `In a {sas} chunk, options are written \`*| label: name;\` (not \`#|\`), and one blank line must follow the last option line, ` +
          `before the first SAS statement, or only the first option is read. ` +
          `The rendered document opens its own SAS session through saspy, separate from the SAS console session, ` +
          `so WORK tables from the console do not exist there: load data from permanent libraries or files, ` +
          `or repeat the DATA steps that created the tables.`,
        value: "sasquatch + saspy available for Quarto rendering",
      },
    ];
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

function tryRegisterChatWorkspaceContextProvider(
  provider: SasWorkspaceContextProvider,
  disposables: Disposable[],
): void {
  const vscodeMod: Record<string, unknown> = Object.fromEntries(
    Object.entries(vscode),
  );
  const chat = vscodeMod.chat;
  if (typeof chat !== "object" || chat === null) {
    return;
  }
  const chatMod: Record<string, unknown> = Object.fromEntries(
    Object.entries(chat),
  );
  const register = chatMod.registerChatWorkspaceContextProvider;
  if (typeof register !== "function") {
    return;
  }
  const result: unknown = register.call(chat, "sas-session", provider);
  if (isDisposable(result)) {
    disposables.push(result);
  }
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return (
    value !== null &&
    typeof value === "object" &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

/**
 * Register LM tools and workspace context provider for Positron Assistant.
 *
 * @param context Extension context for lifecycle management.
 * @param getClient A function that returns the current SasClient, or undefined
 *   if no session is active. Called lazily on each tool invocation.
 * @param sessionContextProvider The provider instance to update when sessions
 *   start/stop (exported so the session can call updateSession).
 */
export function registerAssistantIntegration(
  context: ExtensionContext,
  getClient: () => SasClient | undefined,
): { dispose: () => void; sessionProvider: SasWorkspaceContextProvider } {
  const disposables: Disposable[] = [];
  const sessionProvider = new SasWorkspaceContextProvider();

  // ── LM Tools ────────────────────────────────────────────────────────────────

  disposables.push(
    vscode.lm.registerTool<Record<string, never>>("sas_list_libraries", {
      invoke: async () => {
        const client = getClient();
        if (!client) {
          return textResult("No active SAS session. Please start a SAS session first.");
        }
        return listLibraries(client);
      },
    }),
  );

  disposables.push(
    vscode.lm.registerTool<ListTablesInput>("sas_list_tables", {
      invoke: async (options: LanguageModelToolInvocationOptions<ListTablesInput>) => {
        const client = getClient();
        if (!client) {
          return textResult("No active SAS session. Please start a SAS session first.");
        }
        return listTables(client, options.input);
      },
    }),
  );

  disposables.push(
    vscode.lm.registerTool<DescribeTableInput>("sas_describe_table", {
      invoke: async (options: LanguageModelToolInvocationOptions<DescribeTableInput>) => {
        const client = getClient();
        if (!client) {
          return textResult("No active SAS session. Please start a SAS session first.");
        }
        return describeTable(client, options.input);
      },
    }),
  );

  disposables.push(
    vscode.lm.registerTool<Record<string, never>>("sas_export_saspy_config", {
      invoke: async () => exportSaspyConfig(),
    }),
  );

  // ── Workspace context provider (proposed API, guarded for safety) ─────────────
  // vscode.chat.registerChatWorkspaceContextProvider is a proposed API that may not
  // be present in all VS Code / Positron builds. Access it dynamically to avoid a
  // hard runtime dependency and type assertion errors.
  tryRegisterChatWorkspaceContextProvider(sessionProvider, disposables);

  disposables.push(sessionProvider);
  context.subscriptions.push(...disposables);

  return {
    dispose: () => disposables.forEach((d) => d.dispose()),
    sessionProvider,
  };
}
