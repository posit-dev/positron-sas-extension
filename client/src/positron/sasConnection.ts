// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "vscode";
import { v4 as uuidv4 } from "uuid";
import type { SasClient } from "./sasClient";

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function isPathEntry(e: unknown): e is { name: string; kind: string } {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  const r = toRecord(e);
  return typeof r.name === "string" && typeof r.kind === "string";
}

function toPathArray(value: unknown): Array<{ name: string; kind: string }> {
  return Array.isArray(value) ? value.filter(isPathEntry) : [];
}

export interface ConnectionEmitData {
  messageId: string;
  data: object;
}

/**
 * Handles the Positron Connections Pane comm for a single SAS session.
 *
 * Translates JSON-RPC requests (list_objects, list_fields, etc.) into SAS
 * queries executed via the SasClient, and emits JSON-RPC responses via the
 * onDidEmitData event for the session to forward as comm_data messages.
 */
export class SasConnection {
  readonly id = uuidv4();

  private readonly emitter = new EventEmitter<ConnectionEmitData>();
  readonly onDidEmitData = this.emitter.event;

  constructor(
    private readonly client: SasClient,
    readonly name: string,
    private readonly profileName: string,
    private readonly profileHost: string,
    private readonly onPreviewTable: (lib: string, mem: string) => void,
  ) {}

  sendMessage(messageId: string, message: Record<string, unknown>): void {
    this.dispatch(message)
      .then((result) => {
        this.emitter.fire({
          messageId,
          data: { jsonrpc: "2.0", result },
        });
      })
      .catch((err: unknown) => {
        this.emitter.fire({
          messageId,
          data: {
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        });
      });
  }

  private async dispatch(message: Record<string, unknown>): Promise<unknown> {
    const method = String(message.method ?? "");
    const params = toRecord(message.params);
    const rawPath = params.path;
    const path = toPathArray(rawPath);

    switch (method) {
      case "list_objects":
        return this.listObjects(path);
      case "list_fields":
        return this.listFields(path);
      case "contains_data":
        return this.containsData(path);
      case "get_icon":
        return "";
      case "preview_object":
        this.previewObject(path);
        return null;
      case "get_metadata":
        return {
          name: this.name,
          language_id: "sas",
          host: this.profileHost,
          type: "SAS",
          code: `/* SAS profile: ${this.profileName} */`,
        };
      default:
        throw new Error(`Unknown connections method: ${method}`);
    }
  }

  private async listObjects(
    path: Array<{ name: string; kind: string }>,
  ): Promise<Array<{ name: string; kind: string; has_children?: boolean }>> {
    if (path.length === 0) {
      const names = await this.client.getLibraryList();
      return names.map((name) => ({ name, kind: "schema" }));
    }

    if (path.length === 1 && path[0].kind === "schema") {
      const members = await this.client.getLibraryMembers(path[0].name);
      return members.map((m) => ({
        name: m.name,
        kind: m.type === "VIEW" ? "view" : "table",
      }));
    }

    return [];
  }

  private containsData(
    path: Array<{ name: string; kind: string }>,
  ): boolean {
    if (path.length === 2) {
      const kind = path[1].kind;
      return kind === "table" || kind === "view";
    }
    return false;
  }

  private previewObject(path: Array<{ name: string; kind: string }>): void {
    if (path.length === 2 && (path[1].kind === "table" || path[1].kind === "view")) {
      this.onPreviewTable(path[0].name, path[1].name);
    }
  }

  private async listFields(
    path: Array<{ name: string; kind: string }>,
  ): Promise<Array<{ name: string; dtype: string }>> {
    if (path.length === 2 && path[0].kind === "schema") {
      const cols = await this.client.getDatasetColumns(path[0].name, path[1].name);
      return cols.map((c) => ({ name: c.name, dtype: c.type }));
    }
    return [];
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
