// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter, ExtensionContext, commands, workspace, window } from "vscode";
import { SASLanguageRuntimeManager } from "./PositronLanguageRuntimeManager";
import { SASLanguageRuntimeManager_Supervisor } from "./PositronLanguageRuntimeManager_Supervisor";
import { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import {
  compareActiveDataset,
  compareDatasetFileWithSelected,
  compareDatasetFiles,
  compareDatasets,
  selectDatasetFileForCompare,
} from "./compareDatasets";
import { evaluateMacroExpression } from "./macroExpression";
import {
  CHOOSE_LOG_OUTPUT,
  CHOOSE_LOG_OUTPUT_FILTERED,
  chooseConsoleLogOutput,
  trackConsoleLogFilter,
} from "./consoleLogFilter";
import { PositronConnectionsProvider } from "./PositronConnectionsProvider";
import { PositronPlotsProvider } from "./PositronPlotsProvider";
import { registerAssistantIntegration } from "./sasAssistant";
import { registerAgentCommands } from "./agentCommands";
import { registerQuartoSasCells } from "./quartoSasCells";
import type { SasWorkspaceContextProvider } from "./sasAssistant";
import { PositronDataViewerProvider } from "./PositronDataViewerProvider";
import {
  showDatasetFileProperties,
  showDatasetProperties,
} from "./datasetDetails";
import {
  openDataFileWithSas,
  registerDataFileRedirect,
} from "./dataFileEditorFallback";
import { supportsTableSections } from "./datasetProperties";
import type { SasClient } from "./sasClient";
import {
  SasDataConnectionsDriver,
  isDataConnectionsPaneActive,
} from "./sasDataConnections";

// Import types only (not runtime code)
import type { PositronApi } from "./positron-types";
import {
  CHOOSE_COMPUTE_CONTEXT,
  chooseConsoleComputeContext,
  updateComputeContextKey,
} from "./consoleComputeContext";

/**
 * Set to true to test the supervisor approach (requires positron-supervisor extension)
 * Set to false to use the direct LanguageRuntimeSession implementation
 */
const USE_SUPERVISOR_APPROACH = false;

// Global Positron API function (injected by Positron runtime)
declare global {
  function acquirePositronApi(): PositronApi | undefined;
}

let positronApi: PositronApi | undefined;
let runtimeManager: SASLanguageRuntimeManager | SASLanguageRuntimeManager_Supervisor | undefined;
let connectionsProvider: PositronConnectionsProvider | undefined;
let plotsProvider: PositronPlotsProvider | undefined;
let dataViewerProvider: PositronDataViewerProvider | undefined;
let dataConnectionsDriver: SasDataConnectionsDriver | undefined;
let assistantSessionProvider: SasWorkspaceContextProvider | undefined;

// Holds the SasClient of the active console session for LM tool access.
let activeAssistantClient: SasClient | undefined;

// Holds the active SASLanguageRuntimeSession for direct operations.
let activeSession: SASLanguageRuntimeSession | undefined;
const activeSessionChanged = new EventEmitter<
  SASLanguageRuntimeSession | undefined
>();

// Running SAS console sessions by session ID, so the active session can
// follow the foreground console.
const consoleSessions = new Map<string, SASLanguageRuntimeSession>();

/**
 * Safely try to acquire the Positron API
 * This checks for the global acquirePositronApi function
 */
function tryAcquirePositronApi(): PositronApi | undefined {
  try {
    // Check if the global function exists
    if (typeof acquirePositronApi === "function") {
      return acquirePositronApi();
    }
  } catch (error) {
    console.log("Not running in Positron:", error);
  }
  return undefined;
}

/**
 * Check if the extension is running in Positron
 */
export function isPositron(): boolean {
  if (positronApi === undefined) {
    positronApi = tryAcquirePositronApi();
  }
  return positronApi !== undefined;
}

/**
 * Get the Positron API instance
 */
export function getPositronApi(): PositronApi | undefined {
  if (positronApi === undefined) {
    positronApi = tryAcquirePositronApi();
  }
  return positronApi;
}

/**
 * Initialize Positron-specific functionality
 * This should be called during extension activation if running in Positron
 */
export async function initializePositronIntegration(
  context: ExtensionContext,
): Promise<void> {
  const api = getPositronApi();
  if (!api) {
    return;
  }

  console.log("Initializing Positron integration for SAS extension");
  console.log(`Using ${USE_SUPERVISOR_APPROACH ? "SUPERVISOR" : "DIRECT"} approach`);

  // Register SAS Language Runtime Manager
  runtimeManager = USE_SUPERVISOR_APPROACH
    ? new SASLanguageRuntimeManager_Supervisor()
    : new SASLanguageRuntimeManager();
  const runtimeDisposable = api.runtime.registerLanguageRuntimeManager(
    "sas",
    runtimeManager,
  );
  context.subscriptions.push(runtimeDisposable);

  // Trigger initial runtime discovery so profiles appear immediately in Start Session
  await runtimeManager.triggerInitialDiscovery();
  console.log("SAS runtimes discovered and registered");

  // Listen for profile configuration changes and re-trigger discovery
  const configWatcher = workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("SAS.connectionProfiles")) {
      console.log("SAS profiles changed, re-discovering runtimes");
      runtimeManager.triggerInitialDiscovery();
    }
  });
  context.subscriptions.push(configWatcher);

  // Log filter button in the Console title bar, shown for SAS consoles.
  context.subscriptions.push(
    commands.registerCommand(CHOOSE_LOG_OUTPUT, chooseConsoleLogOutput),
    commands.registerCommand(CHOOSE_LOG_OUTPUT_FILTERED, chooseConsoleLogOutput),
    trackConsoleLogFilter(),
    // Compute context button, shown for SAS consoles on SAS Viya.
    commands.registerCommand(CHOOSE_COMPUTE_CONTEXT, () =>
      chooseConsoleComputeContext(getPositronApi(), (id) =>
        consoleSessions.get(id),
      ),
    ),
  );

  // Compare Datasets (PROC COMPARE), from the Command Palette, the Data
  // Explorer title bar, the Explorer, and the Clinical Repository (#140).
  context.subscriptions.push(
    commands.registerCommand("SAS.compareDatasets", () => compareDatasets()),
    commands.registerCommand("SAS.compareDatasets.active", compareActiveDataset),
    commands.registerCommand("SAS.compareDatasets.files", compareDatasetFiles),
    commands.registerCommand(
      "SAS.compareDatasets.selectFile",
      selectDatasetFileForCompare,
    ),
    commands.registerCommand(
      "SAS.compareDatasets.withSelectedFile",
      compareDatasetFileWithSelected,
    ),
    // Macro expression quick view, as in SAS Enterprise Guide (#158).
    commands.registerCommand("SAS.evaluateMacroExpression", evaluateMacroExpression),
    // Dataset properties, like SAS Studio's table properties.
    commands.registerCommand("SAS.datasetProperties", showDatasetProperties),
    commands.registerCommand(
      "SAS.datasetProperties.file",
      showDatasetFileProperties,
    ),
  );

  // Positron 2026.12 opens .sas7bdat and .xpt files itself; where it can't,
  // they open in the extension's viewers (#141).
  registerDataFileRedirect(context);
  context.subscriptions.push(
    commands.registerCommand("SAS.openDataFileWithSas", openDataFileWithSas),
  );

  // Run {sas} chunks of Quarto documents in the SAS console. The Quarto
  // extension only runs R, Python, Julia and C# cells.
  context.subscriptions.push(registerQuartoSasCells());

  // Auto-start a Console session when a .sas file becomes the active editor
  // and no SAS Console session is already running.
  const ensureSasConsoleSession = async () => {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "sas") {
      return;
    }
    startSasConsole().catch((err: unknown) => {
      console.error("Failed to auto-start SAS Console session:", err);
    });
  };

  // `SAS.consoleForeground`: the console in front is a SAS console, so the
  // Console title bar shows the SAS log filter button.
  const updateSasConsoleContext = async () => {
    const session = await api.runtime.getForegroundSession();
    await commands.executeCommand(
      "setContext",
      "SAS.consoleForeground",
      session?.runtimeMetadata.languageId === "sas",
    );
    // `SAS.consoleComputeContext`: it is a SAS Viya console, so the title bar
    // also shows the compute context button.
    await updateComputeContextKey(api);
  };

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => {
      ensureSasConsoleSession().catch(() => {});
    }),
    api.runtime.onDidChangeForegroundSession((sessionId) => {
      if (sessionId) {
        consoleSessions.get(sessionId)?.activate();
      }
      updateSasConsoleContext().catch(() => {});
      ensureSasConsoleSession().catch(() => {});
    }),
  );
  updateSasConsoleContext().catch(() => {});

  // Run once immediately in case a .sas file is already open.
  ensureSasConsoleSession().catch(() => {});

  // Positron 2026.10+ replaces the Connections pane with the Data Connections
  // pane, which disposes session connection comms. Register a driver there
  // instead; sessions then add themselves as sources (see openConnection).
  // Positron reads this setting once at startup, so we do the same.
  if (
    isDataConnectionsPaneActive(
      api,
      workspace.getConfiguration().get<boolean>("dataConnections.enabled"),
    )
  ) {
    dataConnectionsDriver = new SasDataConnectionsDriver(
      supportsTableSections(api.version),
    );
    context.subscriptions.push(
      dataConnectionsDriver,
      api.dataConnections!.registerDriver(dataConnectionsDriver),
    );
  }

  // Initialize Connections Provider for showing libraries in Connections pane
  connectionsProvider = new PositronConnectionsProvider(api);
  await connectionsProvider.initialize();
  context.subscriptions.push(connectionsProvider);

  // Initialize Plots Provider for showing outputs
  plotsProvider = new PositronPlotsProvider(api);
  context.subscriptions.push(plotsProvider);

  // Register Positron Assistant tools and session context provider.
  const assistant = registerAssistantIntegration(context, () => activeAssistantClient);
  assistantSessionProvider = assistant.sessionProvider;
  // Teach Posit Assistant where SAS output goes, e.g. reading SAS reports
  // in the Viewer (#74). Skill roots exist in Positron 2026.10 and later.
  if (typeof api.ai?.registerAgentSkillRoot === "function") {
    context.subscriptions.push(
      api.ai.registerAgentSkillRoot(context.asAbsolutePath("assistant-skills")),
    );
  }
  // Commands external coding agents run through Positron's MCP server, which
  // doesn't list the SAS console as a session (#156).
  context.subscriptions.push(registerAgentCommands(api));
  // Initialize Data Viewer Provider for showing datasets
  dataViewerProvider = new PositronDataViewerProvider(api);
  context.subscriptions.push(dataViewerProvider);

  console.log("Positron integration initialized successfully");
}

/**
 * The Data Connections driver, or undefined when the legacy Connections pane
 * is in use (Positron 2026.09 and earlier, or dataConnections.enabled off).
 */
export function getDataConnectionsDriver(): SasDataConnectionsDriver | undefined {
  return dataConnectionsDriver;
}

/**
 * Get the runtime manager instance
 */
export function getRuntimeManager(): SASLanguageRuntimeManager | SASLanguageRuntimeManager_Supervisor | undefined {
  return runtimeManager;
}

/**
 * Get the data viewer provider instance
 */
export function getDataViewerProvider(): PositronDataViewerProvider | undefined {
  return dataViewerProvider;
}

/**
 * Called by PositronLanguageRuntimeSession when a Console session starts or stops.
 * Updates the active SasClient available to LM tools and the context provider.
 */
export function setActiveAssistantClient(
  client: SasClient | undefined,
  profileName?: string,
): void {
  activeAssistantClient = client;
  assistantSessionProvider?.updateSession(
    client && profileName ? { profileName, isActive: true } : undefined,
  );
}

/**
 * Called by PositronLanguageRuntimeSession when a Console session starts or stops.
 * Tracks the active session for direct operations.
 */
export function setActiveSession(session: SASLanguageRuntimeSession | undefined): void {
  activeSession = session;
  activeSessionChanged.fire(session);
}

/**
 * Start a SAS console with the preferred SAS runtime, unless one is running.
 * False when there is no SAS runtime to start (no connection profile).
 */
export async function startSasConsole(): Promise<boolean> {
  const api = getPositronApi();
  if (!api) {
    return false;
  }
  const sessions = await api.runtime.getActiveSessions();
  const hasConsole = sessions.some(
    (s) =>
      s.runtimeMetadata.languageId === "sas" &&
      s.metadata.sessionMode === "console",
  );
  if (hasConsole) {
    return true;
  }
  const preferred = await api.runtime.getPreferredRuntime("sas");
  if (!preferred) {
    return false;
  }
  await api.runtime.startLanguageRuntime(
    preferred.runtimeId,
    preferred.runtimeShortName,
  );
  return true;
}

/**
 * The active SAS session, once there is one; undefined after `timeoutMs`
 * without one (sign-in can take a while).
 */
export function waitForActiveSession(
  timeoutMs = 300_000,
): Promise<SASLanguageRuntimeSession | undefined> {
  if (activeSession) {
    return Promise.resolve(activeSession);
  }
  return new Promise((resolve) => {
    const done = (session: SASLanguageRuntimeSession | undefined) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(session);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    const listener = activeSessionChanged.event((session) => {
      if (session) {
        done(session);
      }
    });
  });
}

/** Called when a SAS console session starts. */
export function registerConsoleSession(session: SASLanguageRuntimeSession): void {
  consoleSessions.set(session.sessionId, session);
}

/**
 * Called when a SAS console session stops. Clears the active session only if
 * it is this one, so stopping one console leaves another console active.
 */
export function unregisterConsoleSession(session: SASLanguageRuntimeSession): void {
  if (consoleSessions.get(session.sessionId) === session) {
    consoleSessions.delete(session.sessionId);
  }
  if (activeSession === session) {
    setActiveSession(undefined);
    setActiveAssistantClient(undefined);
  }
}

/**
 * Get the active SAS runtime session
 */
export function getActiveSession(): SASLanguageRuntimeSession | undefined {
  return activeSession;
}

/**
 * Cleanup Positron integration on extension deactivation
 */
export async function cleanupPositronIntegration(): Promise<void> {
  console.log("Cleaning up Positron integration...");

  const api = getPositronApi();
  if (api) {
    try {
      const activeSessions = await api.runtime.getActiveSessions();
      for (const session of activeSessions) {
        if ('sessionId' in session && typeof session.sessionId === 'string') {
          if (session.sessionId.startsWith('sas-')) {
            try {
              await api.runtime.deleteSession(session.sessionId);
            } catch (error) {
              console.error(`Failed to close session ${session.sessionId}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error cleaning up sessions:", error);
    }
  }

  if (connectionsProvider) {
    connectionsProvider.dispose();
    connectionsProvider = undefined;
  }

  if (plotsProvider) {
    plotsProvider.dispose();
    plotsProvider = undefined;
  }

  if (dataViewerProvider) {
    dataViewerProvider.dispose();
    dataViewerProvider = undefined;
  }

  dataConnectionsDriver = undefined;
  runtimeManager = undefined;
  positronApi = undefined;

  console.log("Positron integration cleaned up");
}
