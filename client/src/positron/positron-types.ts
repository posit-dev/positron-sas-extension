// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Type definitions for Positron API
 * These types are defined locally to avoid runtime imports of @posit-dev/positron
 * The @posit-dev/positron package is only used for development type checking
 */
import type * as vscode from "vscode";

// Enums that are used as values
export enum RuntimeState {
  Uninitialized = "uninitialized",
  Starting = "starting",
  Ready = "ready",
  Idle = "idle",
  Busy = "busy",
  Exited = "exited",
}

export enum RuntimeOnlineState {
  Online = "online",
  Offline = "offline",
}

export enum LanguageRuntimeStartupBehavior {
  Immediate = "immediate",
  Implicit = "implicit",
  Explicit = "explicit",
  Manual = "manual",
}

export enum LanguageRuntimeSessionLocation {
  Machine = "machine",
  Workspace = "workspace",
  Browser = "browser",
}

export enum RuntimeCodeExecutionMode {
  Interactive = "interactive",
  Silent = "silent",
}

export enum RuntimeErrorBehavior {
  Stop = "stop",
  Continue = "continue",
}

export enum RuntimeCodeFragmentStatus {
  Complete = "complete",
  Incomplete = "incomplete",
  Invalid = "invalid",
  Unknown = "unknown",
}

export enum RuntimeExitReason {
  Unknown = "unknown",
  Shutdown = "shutdown",
  Restart = "restart",
  ForcedQuit = "forced_quit",
  Error = "error",
  Extension = "extension",
}

export enum RuntimeClientType {
  Variables = "positron.variables",
  Plot = "positron.plot",
  Ui = "positron.ui",
  DataExplorer = "positron.dataExplorer",
  Connection = "positron.connection",
}

// Type definitions

export interface LanguageRuntimeMetadata {
  runtimeId: string;
  runtimeName: string;
  runtimeShortName: string;
  runtimeVersion: string;
  runtimeSource: string;
  runtimePath: string;
  languageName: string;
  languageId: string;
  languageVersion: string;
  base64EncodedIconSvg: string | undefined;
  startupBehavior: LanguageRuntimeStartupBehavior;
  sessionLocation: LanguageRuntimeSessionLocation;
  extraRuntimeData?: unknown;
}

export interface RuntimeSessionMetadata {
  readonly sessionId: string;
  readonly sessionMode: LanguageRuntimeSessionMode;
  readonly notebookUri?: vscode.Uri;
  readonly workingDirectory?: string;
}

export enum LanguageRuntimeSessionMode {
  Console = "console",
  Notebook = "notebook",
  Background = "background",
}

export interface LanguageRuntimeInfo {
  banner: string;
  implementation_version: string;
  language_version: string;
  startup_time: number;
  extra?: Record<string, unknown>;
}

export interface LanguageRuntimeMessage {
  id: string;
  parent_id: string;
  when: string;
  type: string;
  data: unknown;
}

export interface LanguageRuntimeExit {
  runtime_name: string;
  exit_code: number;
  reason: RuntimeExitReason;
  message: string;
}

export interface LanguageRuntimeDynState {
  online_state: RuntimeOnlineState;
}

export interface DebugProtocolRequest {
  command: string;
  arguments?: unknown;
}

export interface DebugProtocolResponse {
  success: boolean;
  message?: string;
  body?: unknown;
}

export interface BaseLanguageRuntimeSession {
  readonly runtimeMetadata: LanguageRuntimeMetadata;
  readonly metadata: RuntimeSessionMetadata;
  getDynState(): Thenable<LanguageRuntimeDynState>;
  callMethod?(method: string, ...args: unknown[]): Thenable<unknown>;
  execute(
    code: string,
    id: string,
    mode: RuntimeCodeExecutionMode,
    errorBehavior: RuntimeErrorBehavior,
  ): void;
  shutdown(exitReason: RuntimeExitReason): Thenable<void>;
}

export interface LanguageRuntimeSession
  extends BaseLanguageRuntimeSession, vscode.Disposable {
  readonly runtimeInfo: LanguageRuntimeInfo | undefined;
  readonly sessionId: string;
  readonly sessionMode: LanguageRuntimeSessionMode;
  readonly notebookUri?: vscode.Uri;
  readonly workingDirectory?: string;

  onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;
  onDidChangeRuntimeState: vscode.Event<RuntimeState>;
  onDidEndSession: vscode.Event<LanguageRuntimeExit>;

  openResource?(resource: vscode.Uri | string): Thenable<boolean>;
  debug(request: DebugProtocolRequest): Thenable<DebugProtocolResponse>;
  isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

  createClient(
    id: string,
    type: RuntimeClientType,
    params: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Thenable<void>;

  listClients(type?: RuntimeClientType): Thenable<Record<string, string>>;
  removeClient(id: string): void;

  sendClientMessage(
    client_id: string,
    message_id: string,
    message: Record<string, unknown>,
  ): void;

  replyToPrompt(id: string, reply: string): void;
  setWorkingDirectory(dir: string): Thenable<void>;

  start(): Thenable<LanguageRuntimeInfo>;
  interrupt(): Thenable<void>;
  restart(workingDirectory?: string): Thenable<void>;
  forceQuit(): Thenable<void>;

  updateSessionName(sessionName: string): void;
  showOutput?(channel?: unknown): void;
  listOutputChannels?(): unknown[];
  showProfile?(): Thenable<void>;
}

export interface LanguageRuntimeManager {
  discoverAllRuntimes(): AsyncGenerator<LanguageRuntimeMetadata>;
  recommendedWorkspaceRuntime(): Thenable<LanguageRuntimeMetadata | undefined>;
  onDidDiscoverRuntime?: vscode.Event<LanguageRuntimeMetadata>;
  validateMetadata?(
    metadata: LanguageRuntimeMetadata,
  ): Thenable<LanguageRuntimeMetadata>;
  validateSession?(sessionId: string): Thenable<boolean>;
  createSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
  ): Thenable<LanguageRuntimeSession>;
  restoreSession?(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
    sessionName: string,
  ): Thenable<LanguageRuntimeSession>;
}

export interface ConnectionsInput {
  id: string;
  label: string;
  type: string;
  required: boolean;
  value?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface ConnectionsDriverMetadata {
  languageId: string;
  name: string;
  base64EncodedIconSvg?: string;
  inputs: Array<ConnectionsInput>;
}

export interface ConnectionsDriver {
  driverId: string;
  metadata: ConnectionsDriverMetadata;
  generateCode?(inputs: Array<ConnectionsInput>): string;
  connect?(code: string): Thenable<void>;
  checkDependencies?(): Thenable<boolean>;
  installDependencies?(): Thenable<boolean>;
}

export interface PlotRenderSettings {
  size: { width: number; height: number };
  pixel_ratio: number;
  format: string;
}

// Connections protocol types
export interface ObjectSchema {
  name: string;
  kind: string;
  has_children?: boolean;
}

export interface FieldSchema {
  name: string;
  dtype: string;
}

export interface MetadataSchema {
  name: string;
  language_id: string;
  host?: string;
  type?: string;
  code?: string;
}

export interface ConnectionsRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params: {
    path?: ObjectSchema[];
    comm_id?: string;
  };
}

export interface ConnectionsRpcResponse extends Record<string, unknown> {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Main Positron API interface
 */
export interface PositronApi {
  readonly runtime: RuntimeManager;
  readonly connections: ConnectionsManager;
  readonly window: WindowManager;
  /** Data Connections pane API; only present in Positron 2026.10 and later. */
  readonly dataConnections?: DataConnectionsManager;
}

// Data Connections (Positron 2026.10+). Minimal subset of positron.d.ts used
// by the SAS driver; see `positron.dataConnections` in Positron's API typings.

export interface DataConnectionsManager {
  registerDriver(driver: DataConnectionDriver): vscode.Disposable;
}

export type DataConnectionParameterValues = Record<
  string,
  string | number | boolean
>;

export interface DataConnectionParameter {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  type: "option" | "string";
  options?: string[];
  defaultValue?: string;
}

export interface DataConnectionMechanism {
  id: string;
  label: string;
  description: string;
  parameters: DataConnectionParameter[];
}

export interface DiscoveredDataConnection {
  id: string;
  name: string;
  description?: string;
  mechanismId: string;
  parameters: DataConnectionParameterValues;
}

export type DataConnectionNodeKind =
  | "schema"
  | "table"
  | "view"
  | "field"
  | "directory"
  | "file";

export type DataConnectionNodeDetailsSection =
  | {
      kind: "properties";
      title?: string;
      properties: { name: string; value: string }[];
    }
  | { kind: "code"; title?: string; languageId?: string; code: string };

export interface DataConnectionNodeDetails {
  description?: string;
  sections: DataConnectionNodeDetailsSection[];
}

export interface DataConnectionNode {
  name: string;
  kind: DataConnectionNodeKind;
  dataType?: string;
  path?: string;
  getChildren?(): Thenable<DataConnectionNode[]>;
  /** Only honored for table, view and field nodes. */
  preview?(): Thenable<string | void>;
  getDetails?(): Thenable<DataConnectionNodeDetails>;
}

export interface DataConnection {
  isReadOnly(): Thenable<boolean>;
  getChildren(): Thenable<DataConnectionNode[]>;
  disconnect(): Thenable<void>;
  isConnected(): Thenable<boolean>;
}

export interface DataConnectionDriver {
  id: string;
  name: string;
  description: string;
  iconSvg: string;
  mechanisms: DataConnectionMechanism[];
  supportedLanguageIds: string[];
  connect(
    mechanismId: string,
    parameters: DataConnectionParameterValues,
  ): Thenable<DataConnection>;
  discoverConnections?(): Thenable<DiscoveredDataConnection[]>;
  onDidChange?: vscode.Event<void>;
}

export interface RuntimeManager {
  registerLanguageRuntimeManager(
    languageId: string,
    manager: LanguageRuntimeManager,
  ): vscode.Disposable;
  getActiveSessions(): Thenable<BaseLanguageRuntimeSession[]>;
  getSession(
    sessionId: string,
  ): Thenable<BaseLanguageRuntimeSession | undefined>;
  getForegroundSession(): Thenable<BaseLanguageRuntimeSession | undefined>;
  executeCode(
    languageId: string,
    code: string,
    focus: boolean,
    allowIncomplete?: boolean,
    mode?: RuntimeCodeExecutionMode,
    errorBehavior?: RuntimeErrorBehavior,
    observer?: unknown,
    sessionId?: string,
    documentUri?: vscode.Uri,
  ): Thenable<Record<string, unknown>>;
  startLanguageRuntime(
    runtimeId: string,
    sessionName: string,
    notebookUri?: vscode.Uri,
  ): Thenable<LanguageRuntimeSession>;
  getRegisteredRuntimes(): Thenable<LanguageRuntimeMetadata[]>;
  getPreferredRuntime(
    languageId: string,
  ): Thenable<LanguageRuntimeMetadata | undefined>;
  selectLanguageRuntime(runtimeId: string): Thenable<void>;
  restartSession(sessionId: string): Thenable<void>;
  focusSession(sessionId: string): void;
  deleteSession(sessionId: string): Thenable<boolean>;
  onDidChangeForegroundSession: vscode.Event<string | undefined>;
}

export interface ConnectionsManager {
  registerConnectionDriver(driver: ConnectionsDriver): vscode.Disposable;
}

export interface PreviewPanel {
  webview: {
    html: string;
  };
}

export interface WindowManager {
  getPlotsRenderSettings(): Thenable<PlotRenderSettings>;
  onDidChangePlotsRenderSettings: vscode.Event<PlotRenderSettings>;
  createPreviewPanel(
    viewType: string,
    title: string,
    preserveFocus?: boolean,
  ): PreviewPanel;
}
