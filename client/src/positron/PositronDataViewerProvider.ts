// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Disposable } from "vscode";
import type { PositronApi, LanguageRuntimeSession } from "./positron-types";
import { RuntimeClientType } from "./positron-types";
import { v4 as uuidv4 } from "uuid";

/**
 * Provides SAS dataset viewing through Positron's Data Explorer
 */
export class PositronDataViewerProvider implements Disposable {
  private _api: PositronApi;
  private _disposables: Disposable[] = [];
  private _activeViewers = new Map<string, DataViewerInfo>();

  constructor(api: PositronApi) {
    this._api = api;
  }

  /**
   * Open a SAS dataset in Positron's data viewer
   * @param library The SAS library name
   * @param table The table/dataset name
   * @param sessionId The active runtime session ID
   */
  async viewDataset(
    library: string,
    table: string,
    sessionId: string,
  ): Promise<void> {
    const viewerId = uuidv4();
    const title = `${library}.${table}`;

    // Store viewer info
    this._activeViewers.set(viewerId, {
      id: viewerId,
      library,
      table,
      sessionId,
      title,
    });

    // Get the active session
    const session = await this._api.runtime.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check if session supports createClient method
    if (!this.isFullSession(session)) {
      throw new Error("Session does not support data viewer clients");
    }

    try {
      // Create a Data Explorer client for this dataset
      await session.createClient(
        viewerId,
        RuntimeClientType.DataExplorer,
        {
          title,
          variable_path: [library, table],
          // Additional params that Positron might use
          library_name: library,
          table_name: table,
        },
        {
          // Metadata about the data source
          source: "SAS",
          connection_type: "SAS",
        },
      );

      console.log(`Data viewer opened for ${title} (viewer ID: ${viewerId})`);
    } catch (error) {
      this._activeViewers.delete(viewerId);
      throw new Error(
        `Failed to open data viewer for ${title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Close a data viewer
   */
  closeViewer(viewerId: string): void {
    const viewer = this._activeViewers.get(viewerId);
    if (!viewer) {
      return;
    }

    // Get session and remove client
    this._api.runtime.getSession(viewer.sessionId).then((session) => {
      if (session && this.isFullSession(session)) {
        session.removeClient(viewerId);
      }
    });

    this._activeViewers.delete(viewerId);
  }

  /**
   * Type guard to check if session has full LanguageRuntimeSession methods
   */
  private isFullSession(
    session: unknown,
  ): session is LanguageRuntimeSession {
    return (
      typeof session === "object" &&
      session !== null &&
      "createClient" in session &&
      "removeClient" in session &&
      "sessionId" in session
    );
  }

  /**
   * Get active viewers
   */
  getActiveViewers(): DataViewerInfo[] {
    return Array.from(this._activeViewers.values());
  }

  /**
   * Close all viewers for a specific session
   */
  closeSessionViewers(sessionId: string): void {
    for (const [viewerId, viewer] of this._activeViewers.entries()) {
      if (viewer.sessionId === sessionId) {
        this.closeViewer(viewerId);
      }
    }
  }

  /**
   * Dispose the data viewer provider
   */
  dispose(): void {
    // Close all active viewers
    for (const viewerId of this._activeViewers.keys()) {
      this.closeViewer(viewerId);
    }
    this._activeViewers.clear();

    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}

interface DataViewerInfo {
  id: string;
  library: string;
  table: string;
  sessionId: string;
  title: string;
}
