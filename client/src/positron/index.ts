// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ExtensionContext, workspace, window } from "vscode";
import { SASLanguageRuntimeManager } from "./PositronLanguageRuntimeManager";
import { SASLanguageRuntimeManager_Supervisor } from "./PositronLanguageRuntimeManager_Supervisor";
import { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import { PositronPlotsProvider } from "./PositronPlotsProvider";
import type { SasClient } from "./sasClient";

// Import types only (not runtime code)
import type { PositronApi } from "./positron-types";

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
let plotsProvider: PositronPlotsProvider | undefined;

// Holds the active SASLanguageRuntimeSession for direct operations.
let activeSession: SASLanguageRuntimeSession | undefined;

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

  // Auto-start a Console session when a .sas file becomes the active editor
  // and no SAS Console session is already running.
  const ensureSasConsoleSession = async () => {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "sas") {
      return;
    }
    const sessions = await api.runtime.getActiveSessions();
    const hasConsole = sessions.some(
      (s) =>
        s.runtimeMetadata.languageId === "sas" &&
        s.metadata.sessionMode === "console",
    );
    if (hasConsole) {
      return;
    }
    const preferred = await api.runtime.getPreferredRuntime("sas");
    if (!preferred) {
      return;
    }
    Promise.resolve(
      api.runtime.startLanguageRuntime(
        preferred.runtimeId,
        preferred.runtimeShortName,
      ),
    ).catch((err: unknown) => {
      console.error("Failed to auto-start SAS Console session:", err);
    });
  };

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => {
      ensureSasConsoleSession().catch(() => {});
    }),
    api.runtime.onDidChangeForegroundSession(() => {
      ensureSasConsoleSession().catch(() => {});
    }),
  );

  // Run once immediately in case a .sas file is already open.
  ensureSasConsoleSession().catch(() => {});

  // Initialize Plots Provider for showing outputs
  plotsProvider = new PositronPlotsProvider(api);
  context.subscriptions.push(plotsProvider);

  console.log("Positron integration initialized successfully");
}

/**
 * Get the runtime manager instance
 */
export function getRuntimeManager(): SASLanguageRuntimeManager | SASLanguageRuntimeManager_Supervisor | undefined {
  return runtimeManager;
}

/**
 * Called by PositronLanguageRuntimeSession when a Console session starts or stops.
 * Placeholder for assistant integration (added in feature/assistant branch).
 */
export function setActiveAssistantClient(
  _client: SasClient | undefined,
  _profileName?: string,
): void {
  // No-op: assistant integration not present in this branch
}

/**
 * Called by PositronLanguageRuntimeSession when a Console session starts or stops.
 * Tracks the active session for direct operations.
 */
export function setActiveSession(session: SASLanguageRuntimeSession | undefined): void {
  activeSession = session;
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

  if (plotsProvider) {
    plotsProvider.dispose();
    plotsProvider = undefined;
  }

  runtimeManager = undefined;
  positronApi = undefined;

  console.log("Positron integration cleaned up");
}
