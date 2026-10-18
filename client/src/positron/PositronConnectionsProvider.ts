// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  ConnectionsDriver,
  ConnectionsDriverMetadata,
  ConnectionsInput,
  PositronApi,
} from "./positron-types";
import { Disposable } from "vscode";
import { ProfileConfig } from "../components/profile";
import { SAS_ICON_SVG } from "./sasDataConnections";

/**
 * Provides SAS libraries as connections in Positron's Connections pane
 */
export class PositronConnectionsProvider implements Disposable {
  private _api: PositronApi;
  private _disposables: Disposable[] = [];
  private _profileConfig: ProfileConfig;
  private _driver: ConnectionsDriver | undefined;

  constructor(api: PositronApi) {
    this._api = api;
    this._profileConfig = new ProfileConfig();
  }

  /**
   * Initialize the connections provider
   */
  async initialize(): Promise<void> {
    // Create the SAS connections driver
    this._driver = this.createSASConnectionDriver();

    // Register the driver
    const disposable = this._api.connections.registerConnectionDriver(
      this._driver,
    );
    this._disposables.push(disposable);
  }

  /**
   * Create the SAS connections driver
   */
  private createSASConnectionDriver(): ConnectionsDriver {
    const profiles = this._profileConfig.getAllProfiles();
    const profileNames = Object.keys(profiles);

    const metadata: ConnectionsDriverMetadata = {
      languageId: "sas",
      name: "SAS",
      base64EncodedIconSvg: this.getSASIconSvg(),
      inputs: [
        {
          id: "profile",
          label: "Profile",
          type: "option",
          required: true,
          options: profileNames.map((name) => ({
            label: name,
            value: name,
          })),
        },
      ],
    };

    const driver: ConnectionsDriver = {
      driverId: "sas-driver",
      metadata,

      /**
       * Generate SAS code to establish a connection
       */
      generateCode(inputs: Array<ConnectionsInput>): string {
        const profileInput = inputs.find((i) => i.id === "profile");
        const profileName = profileInput?.value;

        if (!profileName) {
          return "/* No profile selected */";
        }

        return `/* Connect to SAS using profile: ${profileName} */
/* Connection will be established automatically when code is executed */`;
      },

      /**
       * Connect using the generated code
       */
      async connect(_code: string): Promise<void> {
        // Connection is established through the runtime session
        // when code is executed, so nothing to do here
        console.log("SAS connection established via runtime");
      },

      /**
       * Check if dependencies are installed
       */
      async checkDependencies(): Promise<boolean> {
        // SAS extension manages its own dependencies
        return true;
      },

      /**
       * Install dependencies (not applicable for SAS)
       */
      async installDependencies(): Promise<boolean> {
        return true;
      },
    };

    return driver;
  }

  /**
   * Update connections when libraries change
   * This should be called when the library navigator refreshes
   */
  async updateConnections(libraries: Array<{ name: string; tables?: unknown[] }>): Promise<void> {
    // In a full implementation, this would update the connections pane
    // with the current library information
    console.log(`Updated connections with ${libraries.length} libraries`);
  }

  /**
   * Get SAS icon as base64-encoded SVG
   */
  private getSASIconSvg(): string {
    return Buffer.from(SAS_ICON_SVG).toString("base64");
  }

  /**
   * Dispose the connections provider
   */
  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
