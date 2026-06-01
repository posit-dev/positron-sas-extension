// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Disposable } from "vscode";
import type { PositronApi, PlotRenderSettings } from "./positron-types";

/**
 * Provides SAS outputs (plots, graphs, tables) to Positron's Plots pane
 */
export class PositronPlotsProvider implements Disposable {
  private _api: PositronApi;
  private _disposables: Disposable[] = [];
  private _currentRenderSettings: PlotRenderSettings | undefined;

  constructor(api: PositronApi) {
    this._api = api;
    this.initialize();
  }

  /**
   * Initialize the plots provider
   */
  private async initialize(): Promise<void> {
    // Get initial plot render settings
    this._currentRenderSettings = await this._api.window.getPlotsRenderSettings();

    // Listen for changes to plot render settings
    const settingsDisposable = this._api.window.onDidChangePlotsRenderSettings(
      (settings) => {
        this._currentRenderSettings = settings;
        console.log("Plot render settings changed:", settings);
      },
    );
    this._disposables.push(settingsDisposable);
  }

  /**
   * Send HTML output to the Plots pane
   * This should be called when SAS generates HTML output (graphs, plots, tables)
   */
  async sendHTMLOutput(html: string, title?: string): Promise<void> {
    // In Positron, plots are typically sent through the runtime message system
    // The LanguageRuntimeSession already handles this in emitOutputMessage
    // This method can be used for additional plot-specific handling if needed
    console.log(`Sending HTML output to Plots pane: ${title || "Untitled"}`);
  }

  /**
   * Send image output to the Plots pane
   */
  async sendImageOutput(
    imageData: Buffer,
    mimeType: string,
    title?: string,
  ): Promise<void> {
    console.log(`Sending image output to Plots pane: ${title || "Untitled"}`);
    // Images would be sent through the runtime message system as well
  }

  /**
   * Clear all plots
   */
  async clearPlots(): Promise<void> {
    console.log("Clearing plots");
    // This would typically be handled by Positron's plot pane interface
  }

  /**
   * Get current render settings
   */
  getRenderSettings(): PlotRenderSettings | undefined {
    return this._currentRenderSettings;
  }

  /**
   * Dispose the plots provider
   */
  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
