// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Stub: full implementation added in feature/data-explorer branch

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";
import type { SasClient } from "./sasClient";

export class SasDataExplorer {
  readonly id = uuidv4();
  private _onDidEmitData = new EventEmitter<{ messageId: string; data: unknown }>();
  private _onDidEmitEvent = new EventEmitter<unknown>();
  readonly onDidEmitData = this._onDidEmitData.event;
  readonly onDidEmitEvent = this._onDidEmitEvent.event;

  constructor(
    _sasClient: SasClient,
    _lib: string,
    _mem: string,
  ) {}

  async warmUp(): Promise<void> {}
  sendMessage(_messageId: string, _message: Record<string, unknown>): void {}
  invalidateCache(): void {}

  dispose(): void {
    this._onDidEmitData.dispose();
    this._onDidEmitEvent.dispose();
  }
}
