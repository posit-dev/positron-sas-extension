// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Stub: full implementation added in feature/connections-pane branch

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";
import type { SasClient } from "./sasClient";

export class SasConnection {
  readonly id = uuidv4();
  private _onDidEmitData = new EventEmitter<{ messageId: string; data: unknown }>();
  readonly onDidEmitData = this._onDidEmitData.event;

  constructor(
    _sasClient: SasClient,
    private _name: string,
    private _profileName: string,
    private _host: string,
    private _onPreviewTable: (lib: string, mem: string) => void,
  ) {}

  sendMessage(_messageId: string, _message: Record<string, unknown>): void {}

  dispose(): void {
    this._onDidEmitData.dispose();
  }
}
