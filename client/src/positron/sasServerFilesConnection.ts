// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter, window, workspace } from "vscode";
import { v4 as uuidv4 } from "uuid";

import { FileSystemApi } from "../connection/rest/api/compute";
import { getApiConfig } from "../connection/rest/common";

const SAS_FILE_SEPARATOR = "~fs~";

// Base64-encoded SVG icons from the extension's icons/dark/ directory.
// Used as data URIs in the Positron Connections Pane tree items.
const ICON_FOLDER =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDI3LjQuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkZvbGRlciIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeD0iMHB4IiB5PSIwcHgiCgkgd2lkdGg9IjE2cHgiIGhlaWdodD0iMTZweCIgdmlld0JveD0iMCAwIDE2IDE2IiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCAxNiAxNiIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+CjxwYXRoIGlkPSJpY29uQ29sb3IiIGZpbGw9IiMzM0EzRkYiIGQ9Ik0xNCw0SDhMNy4yMTMsMi40MjdDNy4wODMsMi4xNjUsNi44MTUsMiw2LjUyMywyaC00LjA2QzIuMTc4LDIsMS45MTksMi4xNjEsMS43OTIsMi40MTYKCUwxLjAwNSw0QzEuMDAyLDQuMDA3LDEsMTMsMSwxM2MwLDAuNTUsMC40NSwxLDEsMWgxMmMwLjU1LDAsMS0wLjQ1LDEtMVY1QzE1LDQuNDQ4LDE0LjU1Miw0LDE0LDR6IE0xNCwxM0gyVjZoMTJWMTN6Ii8+Cjwvc3ZnPgo=";
const ICON_SAS_PROGRAM =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDI2LjUuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IlNBU1Byb2dyYW1GaWxlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiCgkgeT0iMHB4IiB3aWR0aD0iMTZweCIgaGVpZ2h0PSIxNnB4IiB2aWV3Qm94PSIwIDAgMTYgMTYiIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDE2IDE2IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHBhdGggaWQ9Imljb25Db2xvciIgZmlsbD0iI0VCQ0Y1RCIgZD0iTTkuMDU4LDE0SDFjLTAuNTUsMC0xLTAuNDUtMS0xVjFjMC0wLjU1LDAuNDUtMSwxLTFoMTJjMC41NSwwLDEsMC40NSwxLDF2OC4wNTgKCWMtMC4yODYtMC4yOTMtMC42MjctMC41MjgtMS0wLjcwN1YxSDF2MTJoNy4zNTFDOC41MywxMy4zNzMsOC43NjUsMTMuNzE0LDkuMDU4LDE0eiBNMTEuNSwxNGMxLjM4MSwwLDIuNS0xLjExOSwyLjUtMi41CglTMTIuODgxLDksMTEuNSw5UzksMTAuMTE5LDksMTEuNVMxMC4xMTksMTQsMTEuNSwxNHogTTkuMjYxLDguODNjMC4zMjEtMC4yNjksMC42ODYtMC40ODEsMS4wOS0wLjYyMgoJYy0wLjAwNi0wLjAwNS0wLjAxLTAuMDExLTAuMDE3LTAuMDE2QzkuNzA0LDcuNzg2LDguODQyLDcuNjIzLDcuOTc3LDcuNjNsMC45ODEtMC45ODFDOS4yNSw2Ljg1Miw5LjU3NSw3LDkuOTcyLDcKCWMwLjU4NSwwLDEuMTg5LTAuMjYzLDEuODQzLTAuODA1YzAuMTAzLTAuMDg1LDAuMTY4LTAuMjA3LDAuMTgzLTAuMzQzYzAuMDE0LTAuMTM2LTAuMDIzLTAuMjctMC4xMDYtMC4zNzYKCWMtMC4xNzEtMC4yMi0wLjQ4Mi0wLjI1NC0wLjY5NS0wLjA4QzkuOTkxLDYuMzkyLDkuNTcsNS44NDUsOC43MTQsNS4xMTVDNy42NDYsNC4yMDIsNi4yMjMsMy4xNzcsMy41OTYsNS41ODMKCUMzLjQ5Niw1LjY3MywzLjQzOCw1Ljc5OSwzLjQyOSw1LjkzNWMtMC4wMDgsMC4xMzcsMC4wMzYsMC4yNjgsMC4xMjQsMC4zN0MzLjY0LDYuNDA3LDMuNzYsNi40NjgsMy44OTIsNi40NzYKCWMwLjEyOSwwLjAxMiwwLjI2LTAuMDM3LDAuMzU5LTAuMTI3YzEuMzctMS4yNTQsMi4yMDQtMS4zNzcsMi45MS0xLjA2N2wtMS42LDMuNDY3TDUuMDcsOS4zOTdMMy42MTcsOC40ODIKCUMzLjQwNCw4LjM1LDMuMTIsOC4zOTIsMi45NTcsOC41ODRMMi4xMTgsOS41ODFDMi4wMzEsOS42ODMsMS45OSw5LjgxNCwyLjAwMiw5Ljk0N2MwLjAxMiwwLjEzNSwwLjA3NiwwLjI1NiwwLjE4MSwwLjM0MgoJYzAuMjE1LDAuMTc2LDAuNTM0LDAuMTQ2LDAuNzEzLTAuMDY0TDMuNDUsOS41NjdsMS40NzIsMC45MjdjMC4wODEsMC4wNSwwLjE3NSwwLjA3OCwwLjI3MSwwLjA3OGMwLjE2MSwwLDAuMzA4LTAuMDczLDAuNDA1LTAuMgoJbDEuMTktMS41NjlDNy41NjcsOC42MjYsOC41MjUsOC41ODksOS4yNjEsOC44M3ogTTkuNSw0Ljg1N2MwLjU5MiwwLDEuMDcxLTAuNjQsMS4wNzEtMS40MjlDMTAuNTcxLDIuNjQsMTAuMDkyLDIsOS41LDIKCVM4LjQyOSwyLjY0LDguNDI5LDMuNDI5QzguNDI5LDQuMjE4LDguOTA4LDQuODU3LDkuNSw0Ljg1N3oiLz4KPC9zdmc+Cg==";
const ICON_SAS_DATASET =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDI2LjUuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IlNBU0RhdGFTZXQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHdpZHRoPSIxNnB4IiBoZWlnaHQ9IjE2cHgiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZW5hYmxlLWJhY2tncm91bmQ9Im5ldyAwIDAgMTYgMTYiIHhtbDpzcGFjZT0icHJlc2VydmUiPgo8cGF0aCBpZD0iaWNvbkNvbG9yIiBmaWxsPSIjRUJDRjVEIiBkPSJNOSw1SDdWNGgyVjV6IE0xMyw0aC0ydjFoMlY0eiBNMTEsOWgyVjhoLTJWOXogTTUsNEgzdjFoMlY0eiBNNSwxM3YtMUgzdjFINXogTTUsOVY4SDN2MUg1egoJIE0xNSwydjguMDU2Yy0wLjI4Ni0wLjI5My0wLjYyNi0wLjUyOC0xLTAuNzA2VjdIMnYzaDguMDU2Yy0wLjI5MywwLjI4Ni0wLjUyOCwwLjYyNi0wLjcwNiwxSDJ2M2g3LjM1CgljMC4xNzgsMC4zNzQsMC40MTMsMC43MTQsMC43MDYsMUgyYy0wLjU1LDAtMS0wLjQ1LTEtMVYyYzAtMC41NSwwLjQ1LTEsMS0xaDEyQzE0LjU1LDEsMTUsMS40NSwxNSwyeiBNMTQsM0gydjNoMTJWM3ogTTksMTN2LTFIN3YxCglIOXogTTksOVY4SDd2MUg5eiBNMTIuNSwxNWMxLjM4MSwwLDIuNS0xLjExOSwyLjUtMi41UzEzLjg4MSwxMCwxMi41LDEwUzEwLDExLjExOSwxMCwxMi41UzExLjExOSwxNSwxMi41LDE1eiIvPgo8L3N2Zz4K";

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

export interface ServerFileEntry {
  name: string;
  isDirectory: boolean;
}

export interface ServerFileProperties {
  size?: number;
  modified?: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  sas: "sas",
  py: "python",
  r: "r",
  json: "json",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  ts: "typescript",
  csv: "csv",
  txt: "plaintext",
  log: "log",
  lst: "plaintext",
};

export function guessLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}

/**
 * Browses the SAS Viya Compute file system of one session. Paths are given as
 * segments relative to the profile's file navigation root.
 */
export class ServerFilesBrowser {
  private readonly fileSystemApi: ReturnType<typeof FileSystemApi>;

  constructor(
    private readonly sessionId: string,
    private readonly fileNavigationRoot: string,
    private readonly fileNavigationCustomRootPath: string,
  ) {
    this.fileSystemApi = FileSystemApi(getApiConfig());
  }

  private toServerPath(segments: string[]): string {
    if (
      this.fileNavigationRoot === "CUSTOM" &&
      this.fileNavigationCustomRootPath
    ) {
      const rootSegments = this.fileNavigationCustomRootPath
        .split("/")
        .filter(Boolean);
      return [...rootSegments, ...segments].join(SAS_FILE_SEPARATOR);
    }
    return SAS_FILE_SEPARATOR + segments.join(SAS_FILE_SEPARATOR);
  }

  async listDirectory(segments: string[]): Promise<ServerFileEntry[]> {
    const response = await this.fileSystemApi.getDirectoryMembers({
      sessionId: this.sessionId,
      directoryPath: this.toServerPath(segments),
      limit: 1000,
      start: 0,
    });
    return (response.data?.items ?? []).map((item) => ({
      name: item.name ?? "unknown",
      isDirectory: !!item.isDirectory,
    }));
  }

  async readFile(segments: string[]): Promise<string> {
    const response = await this.fileSystemApi.getFileContentFromSystem({
      sessionId: this.sessionId,
      filePath: this.toServerPath(segments),
    });
    return typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data, null, 2);
  }

  async getProperties(segments: string[]): Promise<ServerFileProperties> {
    const response = await this.fileSystemApi.getFileorDirectoryProperties({
      sessionId: this.sessionId,
      fileOrDirectoryPath: this.toServerPath(segments),
    });
    const props = response.data;
    return {
      size: props.size,
      modified: props.modifiedTimeStamp
        ? String(props.modifiedTimeStamp)
        : undefined,
    };
  }
}

export interface ServerFilesEmitData {
  messageId: string;
  data: object;
}

/**
 * Handles the Positron Connections Pane comm for SAS Server file system browsing.
 *
 * Translates JSON-RPC requests (list_objects, list_fields, etc.) into REST API
 * calls to the Viya Compute file system endpoint, and emits JSON-RPC responses
 * via the onDidEmitData event.
 */
export class SasServerFilesConnection {
  readonly id = uuidv4();

  private readonly emitter = new EventEmitter<ServerFilesEmitData>();
  readonly onDidEmitData = this.emitter.event;

  constructor(
    private readonly browser: ServerFilesBrowser,
    readonly name: string,
    private readonly profileName: string,
    private readonly profileHost: string,
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
        return this.getIcon(path);
      case "preview_object":
        await this.previewObject(path);
        return null;
      case "get_metadata":
        return {
          name: this.name,
          language_id: "sas",
          host: this.profileHost,
          type: "SAS Server Files",
          code: `/* SAS Server Files: ${this.profileName} */`,
        };
      default:
        throw new Error(`Unknown connections method: ${method}`);
    }
  }

  private getIcon(path: Array<{ name: string; kind: string }>): string {
    if (path.length === 0) {
      return "";
    }
    const last = path[path.length - 1];
    if (last.kind === "schema") {
      return ICON_FOLDER;
    }
    // For files, pick icon based on extension
    const ext = last.name.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      case "sas":
        return ICON_SAS_PROGRAM;
      case "sas7bdat":
      case "sas7bvew":
        return ICON_SAS_DATASET;
      default:
        return "";
    }
  }

  private async listObjects(
    path: Array<{ name: string; kind: string }>,
  ): Promise<Array<{ name: string; kind: string }>> {
    const items = await this.browser.listDirectory(path.map((p) => p.name));
    return items.map((item) => ({
      name: item.name,
      kind: item.isDirectory ? "schema" : "table",
    }));
  }

  private containsData(
    path: Array<{ name: string; kind: string }>,
  ): boolean {
    if (path.length === 0) {
      return false;
    }
    const lastItem = path[path.length - 1];
    return lastItem.kind === "table";
  }

  private async previewObject(
    path: Array<{ name: string; kind: string }>,
  ): Promise<void> {
    if (path.length === 0) {
      return;
    }
    const lastItem = path[path.length - 1];
    if (lastItem.kind !== "table") {
      return;
    }

    try {
      const content = await this.browser.readFile(path.map((p) => p.name));
      const doc = await workspace.openTextDocument({
        content,
        language: guessLanguage(lastItem.name),
      });
      await window.showTextDocument(doc, { preview: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.showErrorMessage(`Failed to open file: ${msg}`);
    }
  }

  private async listFields(
    path: Array<{ name: string; kind: string }>,
  ): Promise<Array<{ name: string; dtype: string }>> {
    if (path.length === 0) {
      return [];
    }
    const lastItem = path[path.length - 1];
    if (lastItem.kind !== "table") {
      return [];
    }

    try {
      const props = await this.browser.getProperties(path.map((p) => p.name));
      const fields: Array<{ name: string; dtype: string }> = [];
      if (props.size !== undefined) {
        fields.push({ name: "size", dtype: `${props.size} bytes` });
      }
      if (props.modified) {
        fields.push({ name: "modified", dtype: props.modified });
      }
      return fields;
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
