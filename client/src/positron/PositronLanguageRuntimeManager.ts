// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  LanguageRuntimeManager,
  LanguageRuntimeMetadata,
  RuntimeSessionMetadata,
  LanguageRuntimeSession,
} from "./positron-types";
import {
  LanguageRuntimeStartupBehavior,
  LanguageRuntimeSessionLocation,
} from "./positron-types";
import { EventEmitter } from "vscode";
import { ProfileConfig } from "../components/profile";
import type { Profile } from "../components/profile";
import { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";

export class SASLanguageRuntimeManager implements LanguageRuntimeManager {
  private _profileConfig: ProfileConfig;
  private _onDidDiscoverRuntime = new EventEmitter<LanguageRuntimeMetadata>();

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
      const metadata: LanguageRuntimeMetadata = {
        runtimeId: `sas-${profileName}`,
        runtimeName: `SAS (${profileName})`,
        runtimeShortName: profileName,
        runtimeVersion: "9.4+",
        runtimeSource: "SAS Extension",
        runtimePath: "",
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

      this._onDidDiscoverRuntime.fire(metadata);
    }
  }

  /**
   * Discover all available SAS runtimes based on configured profiles
   */
  async *discoverAllRuntimes(): AsyncGenerator<LanguageRuntimeMetadata> {
    const profiles = this._profileConfig.getAllProfiles();

    for (const [profileName, profile] of Object.entries(profiles)) {
      const metadata: LanguageRuntimeMetadata = {
        runtimeId: `sas-${profileName}`,
        runtimeName: `SAS (${profileName})`,
        runtimeShortName: profileName,
        runtimeVersion: "9.4+", // SAS version - could be extracted from profile if available
        runtimeSource: "SAS Extension",
        runtimePath: "", // Not applicable for SAS remote connections
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

      yield metadata;
      this._onDidDiscoverRuntime.fire(metadata);
    }
  }

  /**
   * Get the recommended workspace runtime
   */
  async recommendedWorkspaceRuntime(): Promise<
    LanguageRuntimeMetadata | undefined
  > {
    const activeProfileName = this._profileConfig.getActiveProfile();
    if (!activeProfileName) {
      return undefined;
    }

    const profile = this._profileConfig.getProfileByName(activeProfileName);
    if (!profile) {
      return undefined;
    }

    return {
      runtimeId: `sas-${activeProfileName}`,
      runtimeName: `SAS (${activeProfileName})`,
      runtimeShortName: activeProfileName,
      runtimeVersion: "9.4+",
      runtimeSource: "SAS Extension",
      runtimePath: "",
      languageName: "SAS",
      languageId: "sas",
      languageVersion: "9.4+",
      base64EncodedIconSvg: this.getSASIconSvg(),
      startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
      sessionLocation: this.getSessionLocation(profile),
      extraRuntimeData: {
        profile: activeProfileName,
        connectionType: profile.connectionType,
      },
    };
  }

  /**
   * Validate runtime metadata
   */
  async validateMetadata(
    metadata: LanguageRuntimeMetadata,
  ): Promise<LanguageRuntimeMetadata> {
    // Extract profile name from metadata
    const profileName = this.getProfileNameFromMetadata(metadata.extraRuntimeData);
    if (!profileName) {
      throw new Error("No profile specified in runtime metadata");
    }

    const profile = this._profileConfig.getProfileByName(profileName);
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found`);
    }

    // Validate the profile
    const validationResult = this._profileConfig.validateProfile({
      name: profileName,
      profile,
    });

    if (validationResult.type === "error") {
      throw new Error(validationResult.error);
    }

    return metadata;
  }

  /**
   * Create a new SAS session
   */
  async createSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
  ): Promise<LanguageRuntimeSession> {
    console.log("createSession called with:", {
      runtimeMetadata: runtimeMetadata ? "present" : "missing",
      sessionMetadata: sessionMetadata ? "present" : "missing",
      sessionId: sessionMetadata?.sessionId,
    });

    if (!sessionMetadata || !sessionMetadata.sessionId) {
      throw new Error("Invalid session metadata - sessionId is required");
    }

    const profileName = this.getProfileNameFromMetadata(runtimeMetadata.extraRuntimeData);
    if (!profileName) {
      throw new Error("No profile specified in runtime metadata");
    }

    console.log("Creating SAS session with metadata:", {
      sessionId: sessionMetadata.sessionId,
      sessionMode: sessionMetadata.sessionMode,
      profileName: profileName,
    });

    let session: LanguageRuntimeSession;
    try {
      session = new SASLanguageRuntimeSession(
        runtimeMetadata,
        sessionMetadata,
        profileName,
      );

      console.log("Session object created successfully");
      console.log("  - sessionId:", session.sessionId);
      console.log("  - sessionMode:", session.sessionMode);
      console.log("  - type:", typeof session);
      console.log("  - constructor:", session.constructor.name);
      console.log("  - has required properties:", {
        hasSessionId: 'sessionId' in session && session.sessionId !== undefined,
        hasSessionMode: 'sessionMode' in session && session.sessionMode !== undefined,
        hasStart: 'start' in session && typeof session.start === 'function',
        hasOnDidReceiveRuntimeMessage: 'onDidReceiveRuntimeMessage' in session,
        hasOnDidChangeRuntimeState: 'onDidChangeRuntimeState' in session,
        hasOnDidEndSession: 'onDidEndSession' in session,
      });
    } catch (error) {
      console.error("Failed to create session object:", error);
      throw error;
    }

    // Don't call start() here - Positron will call it when ready
    // This was causing start() to be called twice
    console.log("Returning session object to Positron (Positron will call start())");
    // Helper to check if object has metadata property
    function hasMetadataValue(obj: unknown): obj is { metadata: unknown } {
      return typeof obj === "object" && obj !== null && "metadata" in obj;
    }

    console.log("Session object properties before return:", {
      hasMetadata: hasMetadataValue(session),
      metadataValue: hasMetadataValue(session) ? session.metadata : undefined,
      sessionIdValue: session.sessionId,
      sessionModeValue: session.sessionMode,
      sessionIdIsGetter: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'sessionId')?.get !== undefined,
    });
    return session;
  }

  /**
   * SAS sessions are remote stateful processes that cannot be reconnected
   * after a page reload. Returning false tells Positron to discard any stored
   * session metadata cleanly rather than showing it as a terminated session.
   */
  async validateSession(_sessionId: string): Promise<boolean> {
    return false;
  }

  /**
   * Extract profile name from metadata extraRuntimeData
   */
  private getProfileNameFromMetadata(extraData: unknown): string | undefined {
    if (!extraData || typeof extraData !== "object") {
      return undefined;
    }
    if ("profile" in extraData) {
      const profile = extraData.profile;
      return typeof profile === "string" ? profile : undefined;
    }
    return undefined;
  }

  /**
   * Get SAS icon as base64-encoded SVG
   */
  private getSASIconSvg(): string {
    // Simple SAS logo placeholder - in production, use the actual SAS icon
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="#0066CC"/>
        <text x="50" y="60" font-family="Arial" font-size="40" fill="white" text-anchor="middle" font-weight="bold">S</text>
      </svg>
    `;
    return Buffer.from(svg.trim()).toString("base64");
  }

  /**
   * Determine session location based on profile type
   */
  private getSessionLocation(
    profile: Profile,
  ): LanguageRuntimeSessionLocation {
    // SSH connections run on remote machine
    if (profile.connectionType === "ssh") {
      return LanguageRuntimeSessionLocation.Machine;
    }
    // REST/Viya connections are workspace-based
    return LanguageRuntimeSessionLocation.Workspace;
  }
}
