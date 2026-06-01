// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * PROOF-OF-CONCEPT: Runtime Manager using positron-supervisor
 *
 * This shows how we could use the supervisor approach instead of
 * implementing LanguageRuntimeSession directly.
 */

import * as vscode from "vscode";
import type {
  LanguageRuntimeManager,
  LanguageRuntimeMetadata,
  RuntimeSessionMetadata,
  LanguageRuntimeSession,
} from "./positron-types";
import {
  LanguageRuntimeStartupBehavior,
  LanguageRuntimeSessionLocation,
  RuntimeOnlineState,
} from "./positron-types";
import { ProfileConfig } from "../components/profile";
import type { Profile } from "../components/profile";
import {
  createSASKernelSpec,
  type JupyterKernelSpec,
} from "./SupervisorAdapter";
import type { LanguageRuntimeDynState } from "./positron-types";

/**
 * A language runtime session that wraps a Jupyter kernel
 */
export interface JupyterLanguageRuntimeSession extends LanguageRuntimeSession {
  /** Log a message to the kernel's output channel */
  emitJupyterLog(message: string, logLevel?: number): void;

  /** Show an output channel */
  showOutput(channel?: unknown): void;

  /** List available output channels */
  listOutputChannels(): unknown[];

  /** Call a method on the kernel */
  callMethod(method: string, ...args: unknown[]): Promise<unknown>;

  /** Get the kernel log file path */
  getKernelLogFile(): string;
}

/**
 * Extra functionality for kernels
 */
export interface JupyterKernelExtra {
  attachOnStartup?: {
    init: (args: string[]) => void;
    attach: () => Promise<void>;
  };
  sleepOnStartup?: {
    init: (args: string[], delay: number) => void;
  };
}

/**
 * Supervisor API interface (from positron-supervisor extension)
 */
interface PositronSupervisorApi {
  createSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
    kernelSpec: JupyterKernelSpec,
    dynState: LanguageRuntimeDynState,
    extra?: JupyterKernelExtra,
  ): Promise<JupyterLanguageRuntimeSession>;

  validateSession(sessionId: string): Promise<boolean>;

  restoreSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
    dynState: LanguageRuntimeDynState,
  ): Promise<JupyterLanguageRuntimeSession>;
}

export class SASLanguageRuntimeManager_Supervisor implements LanguageRuntimeManager {
  private _profileConfig: ProfileConfig;
  private _supervisorApi?: PositronSupervisorApi;
  private _onDidDiscoverRuntime = new vscode.EventEmitter<LanguageRuntimeMetadata>();

  readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

  constructor() {
    this._profileConfig = new ProfileConfig();
  }

  /**
   * Trigger initial runtime discovery
   * This should be called after the manager is registered to populate the runtime list
   */
  async triggerInitialDiscovery(): Promise<void> {
    const profiles = this._profileConfig.getAllProfiles();

    for (const [profileName, profile] of Object.entries(profiles)) {
      const metadata = this.createRuntimeMetadata(profileName, profile);
      this._onDidDiscoverRuntime.fire(metadata);
    }
  }

  /**
   * Get the positron-supervisor extension API
   */
  private async getSupervisorApi(): Promise<PositronSupervisorApi> {
    if (this._supervisorApi) {
      return this._supervisorApi;
    }

    const ext = vscode.extensions.getExtension<PositronSupervisorApi>(
      "positron.positron-supervisor",
    );

    if (!ext) {
      throw new Error(
        "positron-supervisor extension not found. " +
        "This extension requires positron-supervisor to be installed."
      );
    }

    if (!ext.isActive) {
      await ext.activate();
    }

    this._supervisorApi = ext.exports;
    return this._supervisorApi;
  }

  /**
   * Discover SAS runtimes from connection profiles
   */
  async *discoverAllRuntimes(): AsyncGenerator<LanguageRuntimeMetadata> {
    const profiles = this._profileConfig.getAllProfiles();

    for (const [profileName, profile] of Object.entries(profiles)) {
      yield this.createRuntimeMetadata(profileName, profile);
    }
  }

  /**
   * Get recommended workspace runtime
   */
  async recommendedWorkspaceRuntime(): Promise<LanguageRuntimeMetadata | undefined> {
    const activeProfileName = this._profileConfig.getActiveProfile();
    if (!activeProfileName) {
      return undefined;
    }

    const profile = this._profileConfig.getProfileByName(activeProfileName);
    if (!profile) {
      return undefined;
    }

    return this.createRuntimeMetadata(activeProfileName, profile);
  }

  /**
   * Create a new SAS session using supervisor
   */
  async createSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
  ): Promise<LanguageRuntimeSession> {
    console.log("Creating SAS session via supervisor...");

    const profileName = this.getProfileName(runtimeMetadata);
    if (!profileName) {
      throw new Error("No profile found in runtime metadata");
    }

    // Create our custom kernel spec
    const kernelSpec = createSASKernelSpec(profileName);

    // Dynamic state for the session
    const dynState: LanguageRuntimeDynState & {
      inputPrompt: string;
      continuationPrompt: string;
      sessionName: string;
    } = {
      online_state: RuntimeOnlineState.Online,
      inputPrompt: "sas> ",
      continuationPrompt: "... ",
      sessionName: profileName,
    };

    // Let supervisor create and manage the session!
    const supervisor = await this.getSupervisorApi();
    const kernel = await supervisor.createSession(
      runtimeMetadata,
      sessionMetadata,
      kernelSpec,
      dynState,
    );

    console.log("Supervisor created session successfully");
    return kernel; // This is a JupyterLanguageRuntimeSession managed by supervisor
  }

  /**
   * Validate a session
   */
  async validateSession(sessionId: string): Promise<boolean> {
    const supervisor = await this.getSupervisorApi();
    return supervisor.validateSession(sessionId);
  }

  /**
   * Restore a session
   */
  async restoreSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
    sessionName: string,
  ): Promise<LanguageRuntimeSession> {
    const dynState: LanguageRuntimeDynState & {
      inputPrompt: string;
      continuationPrompt: string;
      sessionName: string;
    } = {
      online_state: RuntimeOnlineState.Online,
      inputPrompt: "sas> ",
      continuationPrompt: "... ",
      sessionName: sessionName,
    };

    const supervisor = await this.getSupervisorApi();
    return supervisor.restoreSession(runtimeMetadata, sessionMetadata, dynState);
  }

  /**
   * Helper: Create runtime metadata for a profile
   */
  private createRuntimeMetadata(
    profileName: string,
    profile: Profile,
  ): LanguageRuntimeMetadata {
    return {
      runtimeId: `sas-${profileName}`,
      runtimeName: `SAS (${profileName})`,
      runtimeShortName: profileName,
      runtimeVersion: "9.4+",
      runtimeSource: "SAS Extension",
      runtimePath: "", // Not used for remote connections
      languageName: "SAS",
      languageId: "sas",
      languageVersion: "9.4+",
      base64EncodedIconSvg: this.getSASIconSvg(),
      startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
      sessionLocation: this.getSessionLocation(profile),
      extraRuntimeData: {
        profile: profileName,
        connectionType: profile.connectionType,
      },
    };
  }

  /**
   * Helper: Get profile name from metadata
   */
  private getProfileName(metadata: LanguageRuntimeMetadata): string | undefined {
    if (
      metadata.extraRuntimeData &&
      typeof metadata.extraRuntimeData === "object" &&
      "profile" in metadata.extraRuntimeData
    ) {
      const profile = metadata.extraRuntimeData.profile;
      return typeof profile === "string" ? profile : undefined;
    }
    return undefined;
  }

  /**
   * Helper: Get session location based on profile type
   */
  private getSessionLocation(profile: Profile): LanguageRuntimeSessionLocation {
    if (profile.connectionType === "ssh") {
      return LanguageRuntimeSessionLocation.Machine;
    }
    return LanguageRuntimeSessionLocation.Workspace;
  }

  /**
   * Helper: Get SAS icon
   */
  private getSASIconSvg(): string {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="#0066CC"/>
        <text x="50" y="60" font-family="Arial" font-size="40" fill="white" text-anchor="middle" font-weight="bold">S</text>
      </svg>
    `;
    return Buffer.from(svg.trim()).toString("base64");
  }
}
