// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Stub: full implementation added in feature/file-browser branch

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";

export class SasServerFilesConnection {
  readonly id = uuidv4();
  private _onDidEmitData = new EventEmitter<{ messageId: string; data: unknown }>();
  readonly onDidEmitData = this._onDidEmitData.event;

  constructor(
    _sessionId: string,
    _name: string,
    _host: string,
    _rootPath?: string,
  ) {}

  sendMessage(_messageId: string, _message: Record<string, unknown>): void {}

  dispose(): void {
    this._onDidEmitData.dispose();
  }
}
