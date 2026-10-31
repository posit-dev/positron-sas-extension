// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type {
  Disposable,
  ExtensionContext,
  LanguageModelToolInvocationOptions,
} from "vscode";
import { EventEmitter } from "vscode";

import { ConnectionType, ProfileConfig, type Profile } from "../components/profile";
import type { SasClient } from "./sasClient";

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

// ─── saspy config generation ──────────────────────────────────────────────────

function profileToSaspyConfig(name: string, profile: Profile): string {
  switch (profile.connectionType) {
    case ConnectionType.Rest: {
      const lines = [
        `# saspy configuration for profile "${name}" (SAS Viya)`,
        `SAS_config_names = ['${name}']`,
        ``,
        `${name} = {`,
        `    'java': '/usr/bin/java',  # adjust path to your Java installation`,
        `    'iomhost': '${new URL(profile.endpoint).hostname}',`,
        `    'iomport': 8591,`,
        `    'encoding': 'utf-8',`,
        `}`,
        ``,
        `# Note: SAS Viya connections typically use the HTTP access method.`,
        `# Alternative using HTTP transport:`,
        `# ${name} = {`,
        `#     'url': '${profile.endpoint}',`,
        `#     'context': '${profile.context || "SAS Job Execution compute context"}',`,
        `# }`,
      ];
      return lines.join("\n");
    }
    case ConnectionType.SSH: {
      const lines = [
        `# saspy configuration for profile "${name}" (SSH)`,
        `SAS_config_names = ['${name}']`,
        ``,
        `${name} = {`,
        `    'saspath': '${profile.saspath}',`,
        `    'ssh': '/usr/bin/ssh',`,
        `    'host': '${profile.host}',`,
        `    'port': ${profile.port},`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    case ConnectionType.IOM: {
      const lines = [
        `# saspy configuration for profile "${name}" (IOM)`,
        `SAS_config_names = ['${name}']`,
        ``,
        `${name} = {`,
        `    'java': '/usr/bin/java',  # adjust path to your Java installation`,
        `    'iomhost': '${profile.host}',`,
        `    'iomport': ${profile.port},`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    case ConnectionType.COM: {
      const lines = [
        `# saspy configuration for profile "${name}" (COM / local Windows)`,
        `SAS_config_names = ['${name}']`,
        ``,
        `${name} = {`,
        `    'provider': 'sas.workspace',`,
        `    'host': '${profile.host || "localhost"}',`,
        `}`,
      ];
      return lines.join("\n");
    }
    case ConnectionType.Stdio: {
      // saspy's STDIO access method starts the local SAS directly, like this profile.
      const lines = [
        `# saspy configuration for profile "${name}" (local SAS, STDIO)`,
        `SAS_config_names = ['${name}']`,
        ``,
        `${name} = {`,
        `    'saspath': '${profile.saspath}',`,
        `    'encoding': 'utf-8',`,
        `}`,
      ];
      return lines.join("\n");
    }
    default:
      return `# Unknown connection type for profile "${name}"`;
  }
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
      {
        label: "SAS Quarto Integration",
        modelDescription:
          `When the user asks to create a Quarto document (.qmd) with SAS code, use the ` +
          `sasquatch R package. sasquatch enables SAS code chunks in Quarto documents via saspy. ` +
          `Setup steps: (1) Install sasquatch: install.packages("sasquatch"), ` +
          `(2) Install saspy by running sasquatch::install_saspy() in R, ` +
          `(3) Call the sas_export_saspy_config tool to get the saspy configuration and save it ` +
          `as sascfg_personal.py in the working directory (not ~/.config/saspy) so the project ` +
          `is self-contained and deployable to Posit Connect, ` +
          `(4) In the .qmd file, add a setup chunk with library(sasquatch), ` +
          `(5) Use \`\`\`{sas} code chunks for SAS code. ` +
          `The sasquatch package handles the SAS session connection automatically.`,
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
