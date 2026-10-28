// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Disposable,
  EventEmitter,
  Selection,
  Uri,
  authentication,
  window,
  workspace,
} from "vscode";

import { v4 as uuidv4 } from "uuid";

import { profileConfig } from "../commands/profile";
import { ConnectionType } from "../components/profile";
import { type LogLine, getSession, setSessionTags } from "../connection";
import {
  appendSessionLogFn,
  setFileName,
} from "../components/logViewer";
import { sasDiagnostic } from "../components/logViewer/sasDiagnostics";
import { SASCodeDocument } from "../components/utils/SASCodeDocument";
import { getCodeDocumentConstructionParameters } from "../components/utils/SASCodeDocumentHelper";
import { AuditLog } from "./auditLog";
import { locateCodeInDocument } from "./consoleDiagnostics";
import {
  CONSOLE_OPTIONS,
  CONSOLE_POSTAMBLE,
  isWrapperLogLine,
  odsOpenCode,
  stripSubmissionTag,
} from "./consoleLog";
import { SasClient, type ColumnInfo as SasColumnInfo } from "./sasClient";
import {
  type SessionIdentity,
  buildIdentityMacroCode,
  buildJobTags,
  buildSessionTags,
  buildSubmissionComment,
  getSessionIdentity,
  tagCode,
} from "./sessionIdentity";
import { SasConnection } from "./sasConnection";
import {
  buildBase64WriteCode,
  buildWorkSubdirCode,
  findSasErrors,
  splitIntoChunks,
  workPathLiteral,
} from "./xptFormat";
import { SasDataExplorer } from "./sasDataExplorer";
import {
  SasServerFilesConnection,
  ServerFilesBrowser,
} from "./sasServerFilesConnection";
import {
  getDataConnectionsDriver,
  getPositronApi,
  setActiveAssistantClient,
  setActiveSession,
} from "./index";
import { Session } from "../connection/session";
import type {
  ConnectionsRpcRequest,
  ConnectionsRpcResponse,
  DebugProtocolRequest,
  DebugProtocolResponse,
  FieldSchema,
  LanguageRuntimeDynState,
  LanguageRuntimeExit,
  LanguageRuntimeInfo,
  LanguageRuntimeMessage,
  LanguageRuntimeMetadata,
  LanguageRuntimeSession,
  MetadataSchema,
  ObjectSchema,
  RuntimeCodeExecutionMode,
  RuntimeErrorBehavior,
  RuntimeSessionMetadata,
} from "./positron-types";
import {
  LanguageRuntimeSessionMode,
  RuntimeClientType,
  RuntimeCodeFragmentStatus,
  RuntimeExitReason,
  RuntimeOnlineState,
  RuntimeState,
} from "./positron-types";

// Type definitions for data viewer filters and sorting
interface RowFilter {
  column_index: number;
  filter_type: string;
  op?: string;
  value?: string | number;
  left_value?: string | number;
  right_value?: string | number;
  term?: string;
}

interface SortKey {
  column_index: number;
  ascending: boolean;
}

// Console submissions are appended here when SAS.audit.logFile is set
// (posit-dev/positron-sas-extension#58).
const auditLog = new AuditLog(
  () => workspace.getConfiguration("SAS").get<string>("audit.logFile"),
  (error, file) => {
    console.error(`SAS audit log: cannot write ${file}:`, error);
    window.showWarningMessage(
      `SAS audit log: cannot write ${file}: ${error.message}`,
    );
  },
);

// ColumnInfo is imported from sasClient
type ColumnInfo = SasColumnInfo;

export class SASLanguageRuntimeSession implements LanguageRuntimeSession {
  // Required by ActiveRuntimeSessionMetadata (via BaseLanguageRuntimeSession)
  readonly runtimeMetadata: LanguageRuntimeMetadata;

  private _runtimeMetadata: LanguageRuntimeMetadata;
  private _profileName: string;
  private _identity!: SessionIdentity;
  private _sasSession: Session | undefined;
  private _runtimeInfo: LanguageRuntimeInfo | undefined;
  private _state: RuntimeState = RuntimeState.Uninitialized;
  private _disposables: Disposable[] = [];

  // Track current execution ID for log correlation
  private _currentExecutionId: string = "";

  // Per-execution error/warning counts and text for the summary message
  private _execErrorCount = 0;
  private _execWarningCount = 0;
  private _execErrorLines: string[] = [];

  // SAS query client - created lazily when the session starts
  private _sasClient: SasClient | undefined;

  // Active connection comm (one per session)
  private _connection: SasConnection | undefined;
  private _connectionListeners: Disposable[] = [];

  // Registration with the Data Connections pane (Positron 2026.10+)
  private _dataConnectionSource: Disposable | undefined;

  // Active server files connection comm (REST/Viya only)
  private _serverConnection: SasServerFilesConnection | undefined;
  private _serverConnectionListeners: Disposable[] = [];

  // Active data explorer comms (one per open dataset)
  private readonly _dataExplorers = new Map<string, SasDataExplorer>();
  private readonly _dataExplorerListeners = new Map<string, Disposable[]>();

  // Event emitters
  private _onDidReceiveRuntimeMessage =
    new EventEmitter<LanguageRuntimeMessage>();
  private _onDidChangeRuntimeState = new EventEmitter<RuntimeState>();
  private _onDidEndSession = new EventEmitter<LanguageRuntimeExit>();
  private _onDidUpdateResourceUsage = new EventEmitter<unknown>();

  // Typed event emitters for specific message types (for Positron console)
  private _onDidReceiveRuntimeMessageStream =
    new EventEmitter<LanguageRuntimeMessage>();
  private _onDidReceiveRuntimeMessageOutput =
    new EventEmitter<LanguageRuntimeMessage>();
  private _onDidReceiveRuntimeMessageError =
    new EventEmitter<LanguageRuntimeMessage>();

  readonly onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
  readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
  readonly onDidEndSession = this._onDidEndSession.event;
  readonly onDidUpdateResourceUsage = this._onDidUpdateResourceUsage.event;

  // Typed events
  readonly onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStream.event;
  readonly onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutput.event;
  readonly onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageError.event;

  // Store metadata directly as readonly property (like Python runtime does)
  readonly metadata: RuntimeSessionMetadata;

  // Session metadata properties - access through metadata
  get sessionId(): string {
    return this.metadata.sessionId;
  }

  get sessionMode(): RuntimeSessionMetadata["sessionMode"] {
    return this.metadata.sessionMode;
  }

  get notebookUri(): RuntimeSessionMetadata["notebookUri"] {
    return this.metadata.notebookUri;
  }

  get workingDirectory(): RuntimeSessionMetadata["workingDirectory"] {
    return this.metadata.workingDirectory;
  }

  constructor(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionMetadata: RuntimeSessionMetadata,
    profileName: string,
  ) {
    this._runtimeMetadata = runtimeMetadata;
    this.runtimeMetadata = runtimeMetadata;  // public read-only alias required by Positron API
    this.metadata = sessionMetadata;
    this._profileName = profileName;

    // Listen for incoming runtime messages (from Positron to us)
    // This is needed to handle RPC requests for connections
    console.log("Session constructor: setting up message routing");

    // Add a test listener to verify events work
    this.onDidReceiveRuntimeMessage((msg) => {
      console.log(`!!! Event fired and received internally !!!`, msg.type);
    });
    console.log("Test listener added to onDidReceiveRuntimeMessage");
  }

  get runtimeInfo(): LanguageRuntimeInfo | undefined {
    return this._runtimeInfo;
  }

  /**
   * Start the SAS session
   */
  async start(): Promise<LanguageRuntimeInfo> {
    console.log("SAS Runtime Session: start() called");
    console.log("Session ID:", this.sessionId);
    console.log("Session mode:", this.sessionMode);

    this.setState(RuntimeState.Starting);

    try {
      // Identify the user and session so submissions can be traced (#58).
      const profile = profileConfig.getProfileByName(this._profileName);
      const connectionType =
        profile && "connectionType" in profile ? String(profile.connectionType) : "";
      this._identity = getSessionIdentity(this.sessionId, this._profileName, connectionType);
      setSessionTags(buildSessionTags(this._identity));

      // Get the SAS session using existing connection logic
      this._sasSession = getSession();
      console.log("SAS session obtained:", !!this._sasSession);

      // Setup session with profile
      await this._sasSession.setup(true);

      // Session-log handler (connection/startup messages only).
      this._sasSession.onSessionLogFn = (logs) => {
        logs.forEach((log) => {
          this.emitLogMessage(log.line, log.type, this._currentExecutionId);
        });
      };

      // Execution-log handler is set per-execution in execute() so we can
      // accumulate all log lines for diagnostics. Set a default no-op here so
      // the REST session never calls an undefined handler between executions.
      this._sasSession.onExecutionLogFn = () => {};

      // Warm-up: run a trivial query to ensure the compute session is fully
      // initialized before any real queries hit it. Without this, the first
      // silentExecute often returns empty because the session isn't ready.
      // The extra delay lets the SSH stream fully drain any residual buffered data.
      this._identity.sasUser = await this.getSasUser(profile);
      await this._sasSession.run(
        `options nosource nonotes; ${buildIdentityMacroCode(this._identity)} %put; options notes source;`,
      );
      await new Promise((r) => setTimeout(r, 500));

      this._runtimeInfo = {
        banner: `SAS Session (${this._profileName})`,
        implementation_version: "9.4+",
        language_version: "9.4+",
        startup_time: Date.now(),
        extra: {
          profile: this._profileName,
        },
      };

      this.setState(RuntimeState.Ready);

      // DISABLED: Auto-execution on session start
      // Enable ODS HTML5 output for plots (now called manually when first plot is needed)
      // console.log("Enabling ODS HTML5 output...");
      // this._sasSession.run(`
      //   ods html5 path='/tmp' file='sas_output.html';
      // `).catch((error) => {
      //   console.error("Failed to enable ODS HTML5:", error);
      // });

      console.log("SAS Runtime Session: start() completed successfully");
      console.log("Returning runtime info:", this._runtimeInfo);

      // Open the Connections pane comm for Console sessions.
      // Background sessions (implicit startup) skip this — index.ts will
      // start a Console session which then opens its own connection.
      if (this.sessionMode !== LanguageRuntimeSessionMode.Background) {
        setTimeout(() => this.openConnection(), 2000);
        // Make this session's SasClient available to LM tools.
        setActiveAssistantClient(this.getSasClient(), this._profileName);
        setActiveSession(this);
      }

      return this._runtimeInfo;
    } catch (error) {
      this.setState(RuntimeState.Exited);
      throw error;
    }
  }

  /** The SAS-side account: the signed-in Viya user, or the profile username. */
  private async getSasUser(
    profile: ReturnType<typeof profileConfig.getProfileByName>,
  ): Promise<string | undefined> {
    if (!profile || !("connectionType" in profile)) {
      return undefined;
    }
    if (profile.connectionType === ConnectionType.Rest) {
      try {
        const session = await authentication.getSession("SAS", [], { silent: true });
        return session?.account.label;
      } catch {
        return undefined;
      }
    }
    return "username" in profile && typeof profile.username === "string"
      ? profile.username
      : undefined;
  }

  /** Open the Connections Pane comm for this session. */
  private openConnection(): void {
    this.closeConnection();

    const profile = profileConfig.getProfileByName(this._profileName);
    const host = this.getProfileHost(profile);

    // Data Connections pane: register as a source instead of opening comms,
    // which Positron would dispose.
    const dataConnections = getDataConnectionsDriver();
    if (dataConnections) {
      this._dataConnectionSource = dataConnections.addSource({
        profileName: this._profileName,
        host,
        client: this.getSasClient(),
        openDataExplorer: (lib, mem) => this.openDataExplorer(lib, mem),
        serverFiles: this.createServerFilesBrowser(),
      });
      return;
    }

    const name = `SAS (${this._profileName})`;
    const conn = new SasConnection(
      this.getSasClient(),
      name,
      this._profileName,
      host,
      (lib, mem) => this.openDataExplorer(lib, mem),
    );

    const dataListener = conn.onDidEmitData(({ messageId, data }) => {
      this.fireCommMessage("comm_data", { comm_id: conn.id, parent_id: messageId, data });
    });
    this._connectionListeners = [dataListener];
    this._connection = conn;

    // Pass the same params as the old createClient call so Positron recognises
    // the connection driver.
    this.fireCommMessage("comm_open", {
      comm_id: conn.id,
      target_name: RuntimeClientType.Connection,
      data: {
        name,
        language_id: "sas",
        host,
        type: "SAS",
        code: `/* SAS profile: ${this._profileName} */`,
      },
    });
    // Ask the Connections Pane to focus.
    this.fireCommMessage("comm_data", {
      comm_id: conn.id,
      data: { method: "focus", params: {} },
    });

    // Also open server files connection for REST/Viya profiles.
    this.openServerFilesConnection();
  }

  private closeConnection(): void {
    this._dataConnectionSource?.dispose();
    this._dataConnectionSource = undefined;
    if (!this._connection) {
      return;
    }
    this.fireCommMessage("comm_closed", { comm_id: this._connection.id, data: {} });
    this._connectionListeners.forEach((d) => d.dispose());
    this._connectionListeners = [];
    this._connection.dispose();
    this._connection = undefined;
  }

  /** Open the Server Files connection comm (REST/Viya only). */
  /** File system browser for REST (Viya) profiles; undefined otherwise. */
  private createServerFilesBrowser(): ServerFilesBrowser | undefined {
    const profile = profileConfig.getProfileByName(this._profileName);
    if (!profile || typeof profile !== "object") {
      return undefined;
    }
    if (!("connectionType" in profile) || profile.connectionType !== ConnectionType.Rest) {
      return undefined;
    }

    const sessionId = this._sasSession?.sessionId?.();
    if (!sessionId) {
      return undefined;
    }

    // Determine file navigation root from profile settings
    const fileNavigationRoot =
      "fileNavigationRoot" in profile && typeof profile.fileNavigationRoot === "string"
        ? profile.fileNavigationRoot
        : "USER";
    const fileNavigationCustomRootPath =
      "fileNavigationCustomRootPath" in profile && typeof profile.fileNavigationCustomRootPath === "string"
        ? profile.fileNavigationCustomRootPath
        : "";

    return new ServerFilesBrowser(
      sessionId,
      fileNavigationRoot,
      fileNavigationCustomRootPath,
    );
  }

  private openServerFilesConnection(): void {
    this.closeServerFilesConnection();

    const browser = this.createServerFilesBrowser();
    if (!browser) {
      return;
    }

    const profile = profileConfig.getProfileByName(this._profileName);
    const host = this.getProfileHost(profile);
    const name = `SAS Server Files (${this._profileName})`;

    const conn = new SasServerFilesConnection(
      browser,
      name,
      this._profileName,
      host,
    );

    const dataListener = conn.onDidEmitData(({ messageId, data }) => {
      this.fireCommMessage("comm_data", { comm_id: conn.id, parent_id: messageId, data });
    });
    this._serverConnectionListeners = [dataListener];
    this._serverConnection = conn;

    this.fireCommMessage("comm_open", {
      comm_id: conn.id,
      target_name: RuntimeClientType.Connection,
      data: {
        name,
        language_id: "sas",
        host,
        type: "SAS Server Files",
        code: `/* SAS Server Files: ${this._profileName} */`,
      },
    });
  }

  private closeServerFilesConnection(): void {
    if (!this._serverConnection) {
      return;
    }
    this.fireCommMessage("comm_closed", { comm_id: this._serverConnection.id, data: {} });
    this._serverConnectionListeners.forEach((d) => d.dispose());
    this._serverConnectionListeners = [];
    this._serverConnection.dispose();
    this._serverConnection = undefined;
  }

  /** Open a Data Explorer comm for a dataset. */
  openDataExplorer(lib: string, mem: string, title = `${lib}.${mem}`): void {
    const explorer = new SasDataExplorer(this.getSasClient(), lib, mem);
    this._dataExplorers.set(explorer.id, explorer);

    const dataListener = explorer.onDidEmitData(({ messageId, data }) => {
      this.fireCommMessage("comm_data", { comm_id: explorer.id, parent_id: messageId, data });
    });
    const eventListener = explorer.onDidEmitEvent((data) => {
      this.fireCommMessage("comm_data", { comm_id: explorer.id, data });
    });
    this._dataExplorerListeners.set(explorer.id, [dataListener, eventListener]);

    // Pre-warm: fetch columns and row count before opening the comm so the
    // first get_state / get_data_values from Positron can respond instantly.
    explorer.warmUp().then(() => {
      this.fireCommMessage("comm_open", {
        comm_id: explorer.id,
        target_name: "positron.dataExplorer",
        data: { title },
      });
    }).catch(() => {
      // Open anyway even if warm-up fails — Positron will retry on demand.
      this.fireCommMessage("comm_open", {
        comm_id: explorer.id,
        target_name: "positron.dataExplorer",
        data: { title },
      });
    });
  }

  private closeDataExplorer(id: string): void {
    const explorer = this._dataExplorers.get(id);
    if (!explorer) {
      return;
    }
    this.fireCommMessage("comm_closed", { comm_id: id, data: {} });
    this._dataExplorerListeners.get(id)?.forEach((d) => d.dispose());
    this._dataExplorerListeners.delete(id);
    explorer.dispose();
    this._dataExplorers.delete(id);
  }

  private closeAllClients(): void {
    for (const id of [...this._dataExplorers.keys()]) {
      this.closeDataExplorer(id);
    }
    this.closeServerFilesConnection();
    this.closeConnection();
  }

  private fireCommMessage(
    type: "comm_open" | "comm_data" | "comm_closed",
    fields: { comm_id: string; data: unknown; parent_id?: string; target_name?: string },
  ): void {
    const msg = {
      id: uuidv4(),
      parent_id: fields.parent_id ?? "",
      when: new Date().toISOString(),
      type,
      ...fields,
    };
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    this._onDidReceiveRuntimeMessage.fire(msg as unknown as LanguageRuntimeMessage);
  }

  /**
   * Get host/endpoint from profile
   */
  private getProfileHost(profile: unknown): string {
    if (!profile || typeof profile !== "object") {
      return "localhost";
    }
    // ViyaProfile has endpoint
    if ("endpoint" in profile && typeof profile.endpoint === "string") {
      return profile.endpoint;
    }
    // SSH/IOM/COM profiles have host
    if ("host" in profile && typeof profile.host === "string") {
      return profile.host;
    }
    return "localhost";
  }

  /**
   * Execute code in the SAS session
   */
  /**
   * Wrap console code for submission. When the code came from the active SAS
   * editor (Run Selection, or the statement at the cursor), it is submitted
   * through a SASCodeDocument for that range, so SAS log problems map back
   * to the editor and the Problems pane after the run (#68). Code typed into
   * the console or generated by Positron Assistant has no source document,
   * so it gets no editor diagnostics.
   */
  private buildSubmission(
    code: string,
    id: string,
  ): { codeDoc: SASCodeDocument | undefined; wrappedCode: string } {
    const hasOdsHtml = /\bods\s+html5?\b/i.test(code);
    // Generate a UUID body filename so the SSH session's extractOutputHtmlFileName
    // can detect it and retrieve the HTML output file after execution.
    const odsOpen = odsOpenCode(uuidv4());
    const postamble = CONSOLE_POSTAMBLE;
    // Traceability tag (#58): added to an existing line, never as a new one.
    const tag = buildSubmissionComment(this._identity, id);

    const editor = window.activeTextEditor;
    const document = editor?.document;
    const range =
      document?.languageId === "sas"
        ? locateCodeInDocument(
            document.getText(),
            code,
            document.offsetAt(editor!.selection.active),
          )
        : undefined;
    if (document && range) {
      const codeDoc = new SASCodeDocument({
        ...getCodeDocumentConstructionParameters(document, {
          selections: [
            new Selection(
              document.positionAt(range.start),
              document.positionAt(range.end),
            ),
          ],
          preamble: hasOdsHtml
            ? tag
            : `${CONSOLE_OPTIONS} ${tag}\n${odsOpen}`,
          postamble: hasOdsHtml ? undefined : postamble,
        }),
        // ODS is opened by the preamble above, not by SASCodeDocument.
        outputHtml: false,
      });
      return { codeDoc, wrappedCode: codeDoc.getWrappedCode() };
    }

    return {
      codeDoc: undefined,
      wrappedCode: tagCode(
        hasOdsHtml
          ? code
          : `${CONSOLE_OPTIONS}\n${odsOpen}\n${code}\n${postamble}`,
        tag,
      ),
    };
  }

  execute(
    code: string,
    id: string,
    _mode: RuntimeCodeExecutionMode,
    _errorBehavior: RuntimeErrorBehavior,
  ): void {
    console.log(`Execute called with code:`, code.substring(0, 100), `... (id: ${id})`);

    if (!this._sasSession) {
      this.emitErrorMessage("SAS session not initialized", id);
      return;
    }

    // Build the submission now, synchronously and before any await, while
    // the active editor is still the one the code was run from.
    const { codeDoc, wrappedCode } = this.buildSubmission(code, id);

    // Track execution ID and reset per-execution counters
    this._currentExecutionId = id;
    this._execErrorCount = 0;
    this._execWarningCount = 0;
    this._execErrorLines = [];

    // Clear stale diagnostics from the previous run so squiggles don't linger.
    if (codeDoc?.getUri()) {
      sasDiagnostic.ignoreAll(Uri.parse(codeDoc.getUri()));
    }

    this.setState(RuntimeState.Busy);

    // Send a "state: busy" message on the message stream so the assistant
    // knows execution has started.
    this.fireStateMessage("busy", id);

    // Send "input" message to echo the code (Positron protocol).
    const inputMessage: LanguageRuntimeMessage & { code: string; execution_count: number } = {
      id: uuidv4(),
      parent_id: id,
      when: new Date().toISOString(),
      type: "input",
      code,
      execution_count: 0,
      data: undefined,
    };
    this._onDidReceiveRuntimeMessage.fire(inputMessage);

    const startedAt = Date.now();
    void auditLog.write({
      event: "input",
      ts: new Date(startedAt).toISOString(),
      ...this._identity,
      executionId: id,
      code,
    });
    const auditComplete = (status: "ok" | "error") =>
      void auditLog.write({
        event: "complete",
        ts: new Date().toISOString(),
        positronSessionId: this._identity.positronSessionId,
        executionId: id,
        status,
        errorCount: this._execErrorCount,
        warningCount: this._execWarningCount,
        durationMs: Date.now() - startedAt,
      });

    // Collect every log line so we can run the existing parseLog→diagnostics
    // pipeline after execution. All types are needed: 'source' lines carry
    // the line-number info that parseLog uses to map errors to file positions.
    const executionLogs: LogLine[] = [];

    console.log(`Code wrapping: mapped to editor=${!!codeDoc}`);

    // Wait for any in-flight silent execution to finish, then install our log
    // handler and run user code. User code takes priority: we reject all
    // queued (not yet started) silent executions so we don't loop waiting for
    // an ever-growing queue to drain. We only need to wait for the single
    // currently-running silent execution (if any) to complete.
    const runWhenReady = async () => {
      // Reject all queued-but-not-started silent executions to avoid waiting.
      const pending = this._silentQueue.splice(0);
      for (const item of pending) {
        item.reject(new Error("Preempted by user execution"));
      }
      // Wait for the currently in-flight silent execution (at most one).
      if (this._silentRunning && this._silentDonePromise) {
        await this._silentDonePromise;
      }
      // Console runs append to the SAS Log channel without showing it, so
      // the panel stays on the Console. The editor Run command sets its own
      // file name before each run.
      setFileName("Console");
      this._sasSession!.onExecutionLogFn = (logs) => {
        executionLogs.push(...logs);
        // Show the user's log, without the lines our wrapper code produces.
        const visible = logs
          .filter((log) => !isWrapperLogLine(log.line))
          .map((log) => ({ ...log, line: stripSubmissionTag(log.line) }));
        visible.forEach((log) => {
          this.emitLogMessage(log.line, log.type, this._currentExecutionId);
        });
        appendSessionLogFn(visible);
      };
      // Job tags are REST-only; ITC reads its second run() argument as a
      // skipPageHeaders flag, so don't pass anything there.
      return this._identity.connectionType === ConnectionType.Rest
        ? this._sasSession!.run(wrappedCode, {
            jobTags: buildJobTags(this._identity, id),
          })
        : this._sasSession!.run(wrappedCode);
    };

    runWhenReady()
      .then((result) => {
        console.log(`Execution completed. Full result object:`, result);
        console.log(`  - html5 length: ${result.html5?.length || 0}`);
        console.log(`  - html5 value: ${result.html5?.substring(0, 200) || 'empty'}`);
        console.log(`  - title: ${result.title || 'empty'}`);

        auditComplete(this._execErrorCount > 0 ? "error" : "ok");

        if (result.html5 && result.html5.trim()) {
          this.emitOutputMessage(result.html5, "text/html", id);
          // Also emit an execute_result so the assistant knows output was produced
          this.emitExecuteResult("SAS output produced (displayed in Viewer pane)", id);
        }

        // Update VS Code diagnostics (squiggles + "Fix with Assistant" / "Explain with Assistant")
        // using the same parseLog pipeline as the VS Code run command.
        if (codeDoc) {
          sasDiagnostic.updateDiagnostics(executionLogs, codeDoc).catch(() => {});
        }

        // Emit execution summary. Errors use the structured error message type
        // so Positron shows "Fix / Explain" with the full SAS error text. The
        // individual error lines were already streamed to stderr above, so the
        // error message here serves as the clickable entry point for the assistant.
        if (this._execErrorCount > 0) {
          const warningNote = this._execWarningCount > 0
            ? ` (and ${this._execWarningCount} warning(s))`
            : "";
          const detail = `Code:\n${code}\n\nErrors:\n${this._execErrorLines.join("\n")}`;
          this.emitErrorMessage(detail, id, warningNote);
        } else if (this._execWarningCount > 0) {
          this.emitLogMessage(
            `⚠ ${this._execWarningCount} warning(s)`,
            "warning",
            id,
          );
        }

        // Notify the Connections pane to refresh its tree.
        if (this._connection) {
          this.fireCommMessage("comm_data", {
            comm_id: this._connection.id,
            data: { method: "update", params: {} },
          });
        }

        // Invalidate cached row counts in any open Data Explorers so their
        // next get_state reflects the current table contents.
        for (const explorer of this._dataExplorers.values()) {
          explorer.invalidateCache();
        }

        // Send a "state: idle" message on the message stream so the assistant
        // knows execution is complete. This MUST be sent before setState()
        // — otherwise drainSilentQueue fires and the assistant never receives
        // its completion signal.
        this.fireStateMessage("idle", id);
        console.log(`Sent state:idle message`);

        this.setState(RuntimeState.Idle);
        console.log(`Execution complete, state set to Idle`);
      })
      .catch((error) => {
        console.error(`Execution error:`, error);
        auditComplete("error");
        this.emitErrorMessage(error.message || String(error), id);

        // Send "state: idle" so the assistant knows execution finished (even on error).
        this.fireStateMessage("idle", id);

        this.setState(RuntimeState.Idle);
      });
  }

  /**
   * Check if a code fragment is complete
   */
  async isCodeFragmentComplete(
    code: string,
  ): Promise<RuntimeCodeFragmentStatus> {
    // For SAS, we can use simple heuristics
    // A code fragment is complete if it doesn't end with a semicolon continuation
    const trimmed = code.trim();
    if (trimmed.endsWith(";") || trimmed === "") {
      return RuntimeCodeFragmentStatus.Complete;
    }
    return RuntimeCodeFragmentStatus.Incomplete;
  }

  /**
   * Interrupt the running code
   */
  async interrupt(): Promise<void> {
    if (this._sasSession?.cancel) {
      await this._sasSession.cancel();
    }
    this.setState(RuntimeState.Idle);
  }

  /**
   * Restart the session
   */
  async restart(_workingDirectory?: string): Promise<void> {
    await this.shutdown(RuntimeExitReason.Restart);
    await this.start();
  }

  /**
   * Shutdown the session
   */
  async shutdown(exitReason: RuntimeExitReason): Promise<void> {
    this.closeAllClients();
    if (this.sessionMode !== LanguageRuntimeSessionMode.Background) {
      setActiveAssistantClient(undefined);
      setActiveSession(undefined);
    }
    this._sasClient = undefined;

    if (this._sasSession) {
      await this._sasSession.close();
      this._sasSession = undefined;
    }

    this.setState(RuntimeState.Exited);

    const exitMessage = {
      runtime_name: this._runtimeMetadata?.runtimeName || "SAS Session",
      exit_code: 0,
      reason: exitReason,
      message: exitReason === RuntimeExitReason.Restart
        ? "Session restarting"
        : "Session ended",
    };

    console.log(`Firing onDidEndSession with:`, exitMessage);
    console.log(`Exit message fields:`, {
      runtime_name: exitMessage.runtime_name,
      exit_code: exitMessage.exit_code,
      reason: exitMessage.reason,
      message: exitMessage.message,
    });
    console.log(`Exit message as JSON:`, JSON.stringify(exitMessage));

    this._onDidEndSession.fire(exitMessage);
    console.log(`onDidEndSession fired`);
  }

  /**
   * Force quit the session
   */
  async forceQuit(): Promise<void> {
    await this.shutdown(RuntimeExitReason.ForcedQuit);
  }

  /**
   * Get dynamic state
   */
  async getDynState(): Promise<LanguageRuntimeDynState> {
    const dynState: LanguageRuntimeDynState & {
      sessionName: string;
      inputPrompt: string;
      continuationPrompt: string;
    } = {
      online_state:
        this._state === RuntimeState.Ready || this._state === RuntimeState.Idle
          ? RuntimeOnlineState.Online
          : RuntimeOnlineState.Offline,
      // Add additional fields that Positron expects
      sessionName: this._profileName,
      inputPrompt: "sas> ",
      continuationPrompt: "... ",
    };
    console.log("getDynState called, returning:", dynState);
    return dynState;
  }

  async createClient(
    _id: string,
    _type: RuntimeClientType,
    _params: Record<string, unknown>,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Comm channels are managed internally via openConnection/openDataExplorer.
  }

  async listClients(_type?: RuntimeClientType): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    if (this._connection) {
      result[this._connection.id] = RuntimeClientType.Connection;
    }
    if (this._serverConnection) {
      result[this._serverConnection.id] = RuntimeClientType.Connection;
    }
    for (const [id] of this._dataExplorers) {
      result[id] = RuntimeClientType.DataExplorer;
    }
    return result;
  }

  removeClient(id: string): void {
    if (this._dataExplorers.has(id)) {
      this.closeDataExplorer(id);
    }
  }

  /**
   * Called by Positron to send an RPC message to one of our client comms.
   */
  sendClientMessage(
    client_id: string,
    message_id: string,
    message: Record<string, unknown>,
  ): void {
    // Route to the connection comm.
    if (this._connection && client_id === this._connection.id) {
      this._connection.sendMessage(message_id, message);
      return;
    }
    // Route to the server files connection comm.
    if (this._serverConnection && client_id === this._serverConnection.id) {
      this._serverConnection.sendMessage(message_id, message);
      return;
    }
    // Route to a data explorer comm.
    const explorer = this._dataExplorers.get(client_id);
    if (explorer) {
      explorer.sendMessage(message_id, message);
      return;
    }
  }

  /**
   * Reply to prompt (not implemented for SAS)
   */
  replyToPrompt(_id: string, _reply: string): void {
    // Not implemented for SAS
  }


  // ========== Helper Methods to Access Library Data ==========

  private async getLibrariesFromSession(): Promise<Array<{ name: string }>> {
    try {
      const names = await this.getSasClient().getLibraryList();
      return names.map((name) => ({ name }));
    } catch {
      return [{ name: "WORK" }, { name: "SASHELP" }, { name: "SASUSER" }];
    }
  }

  private async getTablesFromSession(
    library: string,
  ): Promise<Array<{ name: string }>> {
    try {
      const members = await this.getSasClient().getLibraryMembers(library);
      return members.map((m) => ({ name: m.name }));
    } catch {
      return [];
    }
  }

  private async getColumnsFromSession(
    library: string,
    table: string,
  ): Promise<Array<{ name: string; type: string }>> {
    try {
      const cols = await this.getSasClient().getDatasetColumns(library, table);
      return cols.map((c) => ({ name: c.name, type: c.type }));
    } catch {
      return [];
    }
  }

  /**
   * Set working directory
   */
  async setWorkingDirectory(dir: string): Promise<void> {
    // Could be implemented by running SAS code: x cd 'dir';
    console.log(`Set working directory: ${dir}`);
  }

  /**
   * Update session name
   */
  updateSessionName(_sessionName: string): void {
    // Not applicable for SAS
  }

  /**
   * Show output (optional method for Positron compatibility)
   */
  showOutput(channel?: unknown): void {
    console.log(`showOutput called with channel: ${channel}`);
    // Positron might call this to display a specific output channel
    // For now, just log it - output should appear via onDidReceiveRuntimeMessage
  }

  /**
   * List output channels (optional method for Positron compatibility)
   * Positron console might subscribe to these channels for output display
   */
  listOutputChannels(): unknown[] {
    console.log("⚠️ listOutputChannels called - returning console channels");
    console.log("⚠️ This should be logged if Positron is checking for output channels");
    // Return standard output channels that Positron might use
    // Based on Jupyter protocol: stdout, stderr
    return ['stdout', 'stderr', 'console'];
  }

  /**
   * Show profile (optional method for Positron compatibility)
   */
  async showProfile(): Promise<void> {
    console.log("showProfile called");
  }

  /**
   * Open resource (not implemented for SAS)
   */
  async openResource(_resource: string): Promise<boolean> {
    return false;
  }

  /**
   * Debug (not implemented for SAS)
   */
  async debug(request: DebugProtocolRequest): Promise<DebugProtocolResponse> {
    // SAS doesn't support debugging, but return a proper error response
    // instead of throwing to avoid breaking Positron's debug service
    console.log("Debug request received (not supported):", request);
    return {
      success: false,
      message: "Debug protocol not supported for SAS runtime",
    };
  }

  /**
   * Dispose the session
   */
  dispose(): void {
    this.closeAllClients();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
    if (this._sasSession) {
      this._sasSession.close();
    }
  }

  /**
   * Execute SAS code silently and return captured log output.
   *
   * If the session is currently busy executing user code, the request is
   * queued and runs as soon as the session becomes idle. At most 10 requests
   * may queue; further requests reject immediately to prevent unbounded growth.
   * Each queued request times out after 60 seconds.
   */
  private silentExecute(code: string): Promise<string> {
    if (!this._sasSession) {
      return Promise.resolve("");
    }

    if (this._silentQueue.length >= 10) {
      return Promise.reject(new Error("Silent execution queue full"));
    }

    return new Promise<string>((resolve, reject) => {
      this._silentQueue.push({ code, resolve, reject });
      this.drainSilentQueue();
    });
  }

  private readonly _silentQueue: Array<{
    code: string;
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  }> = [];
  private _silentRunning = false;
  // Resolves when the current silent execution completes; undefined when idle.
  private _silentDonePromise: Promise<void> | undefined;
  private _silentDoneResolve: (() => void) | undefined;

  private drainSilentQueue(): void {
    if (this._silentRunning || this._state === RuntimeState.Busy) {
      return;
    }
    const next = this._silentQueue.shift();
    if (!next || !this._sasSession) {
      return;
    }

    this._silentDonePromise = new Promise<void>((resolve) => {
      this._silentDoneResolve = resolve;
    });

    this._silentRunning = true;
    const session = this._sasSession;
    const originalLogFn = session.onExecutionLogFn;
    const lines: string[] = [];
    let timedOut = false;

    const finish = () => {
      session.onExecutionLogFn = originalLogFn ?? (() => {});
      this._silentRunning = false;
      const resolve = this._silentDoneResolve;
      this._silentDonePromise = undefined;
      this._silentDoneResolve = undefined;
      resolve?.();
      // Run next item if any
      this.drainSilentQueue();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // Reject the caller immediately so it doesn't wait forever, but do NOT
      // call finish() yet — session.run() is still in-flight. We wait for it
      // to settle (below) before allowing new work on the session.
      next.reject(new Error("SAS silent execution timed out"));
      // Safety net: if session.run() doesn't settle within 10s after timeout,
      // force-finish to unblock the queue. The session may be in a bad state
      // but at least the extension won't lock up permanently.
      setTimeout(() => {
        if (this._silentRunning) {
          console.warn("Silent execution: force-finishing after session.run() failed to settle");
          finish();
        }
      }, 10_000);
    }, 60_000);

    session.onExecutionLogFn = (logs) => {
      if (!timedOut) {
        logs.forEach((log) => lines.push(log.line));
      }
    };

    session
      .run(next.code)
      .then(() => {
        clearTimeout(timer);
        finish();
        if (!timedOut) {
          next.resolve(lines.join("\n"));
        }
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        finish();
        if (!timedOut) {
          next.reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
  }

  /**
   * Run SAS code silently (no console output) and return captured log.
   * Used for setup operations like LIBNAME assignments.
   */
  runSilent(code: string): Promise<string> {
    return this.silentExecute(code);
  }

  /**
   * Copy a file into `subdir` under this session's WORK directory and return
   * its location as a SAS string literal. Used for files that aren't on a
   * disk SAS can read, e.g. ones opened from the Clinical Repository or SAS
   * Content views. The bytes go through SAS itself (base64 DATALINES),
   * because SAS can always write to WORK, even in lockdown, while server
   * file APIs may not reach it.
   */
  async uploadToWork(
    subdir: string,
    name: string,
    content: Uint8Array,
  ): Promise<string> {
    const file = workPathLiteral(subdir, name);
    const chunks = splitIntoChunks(content);
    for (let i = 0; i < chunks.length; i++) {
      const code = buildBase64WriteCode(file, chunks[i], i > 0);
      const errors = findSasErrors(
        await this.runSilent(i === 0 ? `${buildWorkSubdirCode(subdir)}\n${code}` : code),
      );
      if (errors.length > 0) {
        throw new Error(
          `Copying ${name} to the SAS server failed: ${errors.join(" ")}`,
        );
      }
    }
    return file;
  }

  /** Return the DATA/VIEW members of a library. */
  listMembers(lib: string): Promise<Array<{ name: string; type: string }>> {
    return this.getSasClient().getLibraryMembers(lib);
  }

  /** Return (or lazily create) the SasClient bound to this session's silentExecute. */
  private getSasClient(): SasClient {
    if (!this._sasClient) {
      this._sasClient = new SasClient(this.silentExecute.bind(this));
    }
    return this._sasClient;
  }

  /**
   * Helper: Set state and emit event
   */
  private setState(state: RuntimeState): void {
    if (this._state !== state) {
      const oldState = this._state;
      this._state = state;
      console.log(`State transition: ${oldState} -> ${state}`);
      this._onDidChangeRuntimeState.fire(state);
      // When session becomes idle, drain any queued silent executions
      if (state === RuntimeState.Ready || state === RuntimeState.Idle) {
        this.drainSilentQueue();
      }
    }
  }

  /**
   * Helper: Emit a log line to the console.
   *
   * Stream rules (based on SAS REST LogLineTypeEnum):
   *   "error"   → stderr stream, increment error counter
   *   "warning" → stderr stream, increment warning counter
   *   everything else (source, note, normal…) → stdout stream
   *
   * Callers drop the lines produced by our wrapper code, so the console shows
   * the user's SAS log line by line.
   */
  private emitLogMessage(text: string, type: string, parent_id: string = ""): void {
    // The SSH session may deliver all lines as type "normal" without
    // classification. Apply content-based heuristics to detect the actual type.
    let effective = type.toLowerCase();
    if (effective === "normal" || effective === "" || effective === "message") {
      effective = this.classifyLogLine(text);
    }

    if (effective === "error") {
      this._execErrorCount++;
      this._execErrorLines.push(text);
    } else if (effective === "warning") {
      this._execWarningCount++;
    }

    const streamName = (effective === "error" || effective === "warning") ? "stderr" : "stdout";

    const message: LanguageRuntimeMessage & { name: string; text: string } = {
      id: uuidv4(),
      parent_id: parent_id,
      when: new Date().toISOString(),
      type: "stream",
      name: streamName,
      text: text + "\n",
      data: undefined,
    };

    this._onDidReceiveRuntimeMessage.fire(message);
    this._onDidReceiveRuntimeMessageStream.fire(message);
  }

  /**
   * Classify a SAS log line by content when the session doesn't provide types.
   * Returns "error", "warning", "note", "source", or "normal".
   */
  private classifyLogLine(text: string): string {
    const trimmed = text.trimStart();
    if (/^ERROR\b/i.test(trimmed)) {
      return "error";
    }
    if (/^WARNING\b/i.test(trimmed)) {
      return "warning";
    }
    if (/^NOTE\b/i.test(trimmed)) {
      return "note";
    }
    // Source echo: line number followed by spaces and code
    if (/^\d+\s/.test(trimmed)) {
      return "source";
    }
    return "normal";
  }

  /**
   * Helper: Emit output message
   */
  private emitOutputMessage(content: string, mimeType: string, parent_id: string = ""): void {
    console.log(`emitOutputMessage called with parent_id: ${parent_id}, mime: ${mimeType}`);

    // If HTML output, send to Viewer pane (not console or editor split)
    if (mimeType.includes("html")) {
      console.log(`Sending HTML output to Viewer pane (${content.length} chars)`);
      this.emitViewerOutput(content, parent_id);
      return;
    }

    // For non-HTML output, send to console as before
    this.emitTextOutput(content, mimeType, parent_id);
  }

  /**
   * Helper: Emit HTML output to Viewer pane using Positron's preview panel API.
   */
  private emitViewerOutput(htmlContent: string, _parent_id: string = ""): void {
    const api = getPositronApi();
    if (!api) {
      return;
    }

    const panel = api.window.createPreviewPanel(
      "sas.output",
      "SAS Output",
      true, // preserveFocus — keep cursor in the console
    );
    panel.webview.html = htmlContent;
  }

  /**
   * Helper: Emit text output to console (extracted from emitOutputMessage)
   */
  private emitTextOutput(content: string, mimeType: string, parent_id: string = ""): void {
    // Positron expects kind, data, and output_location as direct properties
    const message: LanguageRuntimeMessage & {
      kind: string;
      output_location?: string;
    } = {
      id: uuidv4(),
      parent_id: parent_id,
      when: new Date().toISOString(),
      type: "output",
      kind: "text",
      data: { [mimeType]: content },
      output_location: undefined,
    };

    console.log(`Emitting text output to console`);

    // Fire generic event (for backwards compatibility)
    this._onDidReceiveRuntimeMessage.fire(message);

    // Also fire typed event (for Positron console to receive)
    this._onDidReceiveRuntimeMessageOutput.fire(message);
    console.log(`Both generic and typed output events fired`);
  }

  /**
   * Helper: Emit a "result" message (Positron protocol).
   * This signals to the assistant that execution produced output.
   */
  private emitExecuteResult(text: string, parent_id: string): void {
    const message: LanguageRuntimeMessage = {
      id: uuidv4(),
      parent_id,
      when: new Date().toISOString(),
      type: "result",
      data: { "text/plain": text },
    };
    this._onDidReceiveRuntimeMessage.fire(message);
  }

  /**
   * Helper: Fire a runtime state message on the message stream.
   * The assistant uses these to track busy→idle transitions.
   */
  private fireStateMessage(state: "busy" | "idle", parent_id: string): void {
    const message: LanguageRuntimeMessage & { state: string } = {
      id: uuidv4(),
      parent_id,
      when: new Date().toISOString(),
      type: "state",
      state,
      data: undefined,
    };
    this._onDidReceiveRuntimeMessage.fire(message);
  }

  /**
   * Helper: Emit error message.
   *
   * @param message   Full error text shown in the console and sent to the assistant.
   * @param parent_id Execution ID to correlate with the triggering execute() call.
   * @param note      Optional suffix appended to the name (e.g. warning count).
   */
  private emitErrorMessage(message: string, parent_id: string = "", note = ""): void {
    console.log(`emitErrorMessage called with parent_id: ${parent_id}`);

    // Positron expects name, message, and traceback as direct properties.
    // - message: shown in the console header and passed to the assistant's /fix prompt.
    // - traceback: each entry is one line in the "Show Traceback" panel.
    const runtimeMessage: LanguageRuntimeMessage & {
      name: string;
      message: string;
      traceback: string[];
    } = {
      id: uuidv4(),
      parent_id: parent_id,
      when: new Date().toISOString(),
      type: "error",
      name: `SAS Error${note}`,
      message: message,
      traceback: message.split("\n").filter((l) => l.trim()),
      data: undefined,
    };

    // Fire generic event (for backwards compatibility)
    this._onDidReceiveRuntimeMessage.fire(runtimeMessage);

    // Also fire typed event (for Positron console to receive)
    this._onDidReceiveRuntimeMessageError.fire(runtimeMessage);
    console.log(`Both generic and typed error events fired`);
  }


  private async getTableDimensions(library: string, table: string): Promise<{ num_rows: number; num_columns: number }> {
    try {
      const [num_rows, columns] = await Promise.all([
        this.getSasClient().getDatasetRowCount(library, table),
        this.getSasClient().getDatasetColumns(library, table),
      ]);
      return { num_rows, num_columns: columns.length };
    } catch {
      return { num_rows: 0, num_columns: 0 };
    }
  }

  private getTableColumns(library: string, table: string): Promise<ColumnInfo[]> {
    return this.getSasClient().getDatasetColumns(library, table);
  }

  private async getBatchedNullCounts(
    library: string,
    table: string,
    columnsToFetch: Array<{ column_index: number; column: ColumnInfo }>,
  ): Promise<Array<{ column_index: number; null_count: number }>> {
    if (columnsToFetch.length === 0) {
      return [];
    }
    try {
      const names = columnsToFetch.map(({ column }) => column.name);
      const counts = await this.getSasClient().getColumnNullCounts(library, table, names);
      return columnsToFetch.map(({ column_index }, i) => ({
        column_index,
        null_count: counts[i] ?? 0,
      }));
    } catch {
      return columnsToFetch.map(({ column_index }) => ({ column_index, null_count: 0 }));
    }
  }

  private async getBatchedSummaryStats(
    library: string,
    table: string,
    columnsToFetch: Array<{ column_index: number; column: ColumnInfo }>,
  ): Promise<Array<{ column_index: number; stats: Record<string, unknown> }>> {
    if (columnsToFetch.length === 0) {
      return [];
    }
    try {
      const names = columnsToFetch.map(({ column }) => column.name);
      const statsArr = await this.getSasClient().getColumnSummaryStats(library, table, names);
      return columnsToFetch.map(({ column_index }, i) => {
        const s = statsArr[i];
        if (!s) {
          return { column_index, stats: {} };
        }
        return {
          column_index,
          stats: {
            min_value: s.minValue,
            max_value: s.maxValue,
            mean_value: s.meanValue,
            median_value: s.medianValue,
            std_dev: s.stdevValue,
          },
        };
      });
    } catch {
      return columnsToFetch.map(({ column_index }) => ({ column_index, stats: {} }));
    }
  }
}
