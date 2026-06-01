// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter to use positron-supervisor with SAS session
 *
 * This is a PROOF-OF-CONCEPT to bridge between:
 * - Positron Supervisor (expects Jupyter kernel)
 * - Our SAS session (REST/SSH/IOM/COM connections)
 */

import { getSession } from "../connection";
import type { Session } from "../connection/session";
import { ProfileConfig } from "../components/profile";

/**
 * Types from positron-supervisor API
 *
 * These match the types from positron-supervisor extension
 */

/** State information for a Jupyter session */
export interface JupyterSessionState {
  /** The Jupyter session identifier */
  sessionId: string;
  /** The log file the kernel is writing to */
  logFile: string;
  /** The profile file the kernel is writing to */
  profileFile?: string;
  /** The connection file specifying ZeroMQ ports, signing keys, etc. */
  connectionFile: string;
  /** The ID of the kernel's process, or 0 if not running */
  processId: number;
}

/** A Jupyter session */
export interface JupyterSession {
  readonly state: JupyterSessionState;
}

/** Interface for interacting with a Jupyter kernel */
export interface JupyterKernel {
  connectToSession(session: JupyterSession): Promise<void>;
  log(msg: string): void;
}

/**
 * Custom kernel starter that uses our existing SAS session
 * instead of launching a real Jupyter kernel process
 */
function createSASKernelStarter(profileName: string) {
  return async (session: JupyterSession, kernel: JupyterKernel): Promise<void> => {
    console.log(`[SupervisorAdapter] Starting SAS kernel adapter for profile: ${profileName}...`);
    kernel.log(`Starting SAS kernel adapter for profile: ${profileName}...`);

    try {
      // Set the active profile before getting the session
      console.log(`[SupervisorAdapter] Setting active profile to: ${profileName}`);
      const profileConfig = new ProfileConfig();
      await profileConfig.updateActiveProfileSetting(profileName);
      console.log(`[SupervisorAdapter] Active profile set successfully`);
      kernel.log(`Active profile set to: ${profileName}`);

      // Get our existing SAS session (will use the active profile we just set)
      console.log(`[SupervisorAdapter] Getting SAS session...`);
      const sasSession: Session = getSession();
      console.log(`[SupervisorAdapter] SAS session obtained:`, !!sasSession);
      kernel.log("SAS session obtained");

      // Setup the session
      console.log(`[SupervisorAdapter] Setting up SAS session...`);
      await sasSession.setup(true);
      console.log(`[SupervisorAdapter] SAS session setup complete`);
      kernel.log("SAS session setup complete");

      // TODO: Bridge between Jupyter protocol and SAS session
      // This is where we'd need to:
      // 1. Listen for execute_request messages from supervisor
      // 2. Run code via sasSession.run()
      // 3. Send back stream/display_data messages
      // 4. Handle other Jupyter message types

      // For now, just connect to the session
      console.log(`[SupervisorAdapter] Connecting to Jupyter session...`);
      await kernel.connectToSession(session);
      console.log(`[SupervisorAdapter] SAS kernel adapter started successfully!`);
      kernel.log("SAS kernel adapter started successfully");

    } catch (error) {
      const errorMsg = `Failed to start SAS kernel: ${error}`;
      const errorStack = error instanceof Error ? error.stack : String(error);
      console.error(`[SupervisorAdapter] ${errorMsg}`);
      console.error(`[SupervisorAdapter] Stack:`, errorStack);
      kernel.log(errorMsg);
      kernel.log(`Error stack: ${errorStack}`);
      throw error;
    }
  };
}

/** Jupyter kernel specification */
export interface JupyterKernelSpec {
  /** Command used to start the kernel and command line arguments */
  argv: string[];
  /** The kernel's display name */
  display_name: string;
  /** The language the kernel executes */
  language: string;
  /** Interrupt mode (signal or message) */
  interrupt_mode?: "signal" | "message";
  /** Environment variables to set when starting the kernel */
  env?: NodeJS.ProcessEnv;
  /** The Jupyter protocol version to use */
  kernel_protocol_version: string;
  /** Optional preflight command to run before starting the kernel */
  startup_command?: string;
  /**
   * Optional function to start the kernel.
   * If provided, argv is ignored.
   */
  startKernel?: (session: JupyterSession, kernel: JupyterKernel) => Promise<void>;
}

/**
 * Create kernel spec for supervisor with custom startKernel
 */
export function createSASKernelSpec(profileName: string): JupyterKernelSpec {
  return {
    // Dummy argv - we'll use startKernel instead
    argv: ["/usr/bin/true"],
    display_name: `SAS (${profileName})`,
    language: "sas",
    kernel_protocol_version: "5.1",

    // Our custom start function - supervisor will call this instead of argv
    // Create a closure that captures the profile name
    startKernel: createSASKernelStarter(profileName),
  };
}
