// Copyright © 2022-2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import { ChildProcess, spawn } from "child_process";
import { accessSync, constants, readFile } from "fs";
import { join } from "path";

import { BaseConfig, RunResult } from "..";
import { updateStatusBarItem } from "../../components/StatusBarItem";
import { AutoExec, toAutoExecLines } from "../../components/profile";
import {
  ENCODING_DETECT_TIMEOUT_MS,
  PUT_SESSION_ENCODING,
  SessionEncoding,
  StreamDecoder,
  decodeHtml,
  parseSessionEncoding,
} from "../encoding";
import { Session } from "../session";
import { extractOutputHtmlFileName } from "../util";
import { WORK_DIR_END_TAG, WORK_DIR_START_TAG } from "./const";
import { LineCodes } from "./types";

/**
 * How the session starts SAS. An object rather than a direct call so tests can
 * stub it: child_process.spawn itself cannot be stubbed in the VS Code
 * extension host (non-configurable property).
 */
export const processLauncher = { spawn };

let sessionInstance: StdioSession;

export interface Config extends BaseConfig {
  saspath: string;
  autoExec?: AutoExec[];
}

export function getSession(c: Config): Session {
  if (!sessionInstance) {
    sessionInstance = new StdioSession(c);
  }
  return sessionInstance;
}

/** A new session with its own SAS process, separate from the shared one. */
export function createSession(c: Config): Session {
  return new StdioSession(c);
}

export class StdioSession extends Session {
  private _process: ChildProcess | undefined;
  private _config: Config;
  private _resolve: ((value?) => void) | undefined;
  private _reject: ((reason?) => void) | undefined;
  private _html5FileName = "";
  private _sessionReady: boolean;
  private _workDirectory: string;
  // The session encoding (#182). Until SAS reports it, right after it
  // starts, output is read as UTF-8.
  private _encoding = SessionEncoding.UTF8;
  private _stdoutDecoder: StreamDecoder = SessionEncoding.UTF8.streamDecoder();
  private _stderrDecoder: StreamDecoder = SessionEncoding.UTF8.streamDecoder();
  // SAS's output from its prompt until it reported its encoding.
  private _startupOutput = "";
  private _encodingTimer: ReturnType<typeof setTimeout> | undefined;
  // Setup has finished: SAS is up and its encoding is known.
  private _connected = false;

  constructor(c?: Config) {
    super();
    this._config = c;
    this._sessionReady = false;
  }

  public sessionId? = (): string => {
    throw new Error(l10n.t("Method not implemented."));
  };

  set config(newValue: Config) {
    this._config = newValue;
  }

  protected establishConnection = (): Promise<void> => {
    return new Promise((pResolve, pReject) => {
      this._resolve = pResolve;
      this._reject = pReject;

      if (this._process) {
        this._resolve?.({});
        return;
      }

      // A missing executable would otherwise surface as a bare
      // "spawn ... ENOENT" or EPIPE, so name the path instead.
      try {
        accessSync(this._config.saspath, constants.X_OK);
      } catch {
        this._reject?.(
          new Error(
            l10n.t(
              "SAS executable not found or not executable: {saspath}. Check saspath in the connection profile (SAS Analytics Pro: /opt/sas/viya/home/SASFoundation/sas).",
              { saspath: this._config.saspath },
            ),
          ),
        );
        return;
      }

      try {
        // Build SAS options
        // -linesize max: SAS otherwise wraps log lines at about 78
        // columns, and a wrapped line of the code the extension adds around
        // a submission can't be told from the user's log. A -linesize in
        // the profile's sasOptions comes later and wins.
        const resolvedSasOpts: string[] = [
          "-nodms",
          "-noterminal",
          "-nosyntaxcheck",
          "-linesize",
          "max",
        ];

        if (this._config.sasOptions?.length > 0) {
          resolvedSasOpts.push(...this._config.sasOptions);
        }

        // Set Java options for headless mode
        const env = {
          ...process.env,
          _JAVA_OPTIONS: "-Djava.awt.headless=true",
        };

        // Spawn the SAS process with stdio pipes
        this._process = processLauncher.spawn(
          this._config.saspath,
          resolvedSasOpts,
          {
            stdio: ["pipe", "pipe", "pipe"],
            env,
          },
        );

        // Handle process errors
        this._process.on("error", this.onProcessError);
        this._process.on("close", this.onProcessClose);

        // Attach stdout/stderr handlers
        this._process.stdout?.on("data", this.onStdoutData);
        this._process.stderr?.on("data", this.onStderrData);
      } catch (err) {
        this._reject?.(err);
      }
    });
  };

  protected _run = (code: string): Promise<RunResult> => {
    this._html5FileName = "";

    // Parse code to extract HTML5 filename if present
    const codeLines = code.split(/\n|\r\n/);
    for (const line of codeLines) {
      this._html5FileName = extractOutputHtmlFileName(
        line,
        this._html5FileName,
      );
    }

    return new Promise((_resolve, _reject) => {
      this._resolve = _resolve;
      this._reject = _reject;

      if (!this._process?.stdin) {
        this._reject?.(new Error(l10n.t("SAS process is not running.")));
        return;
      }

      this._process.stdin.write(this.toSasInput(`${code}\n`));
      this._process.stdin.write(`%put ${LineCodes.RunEndCode};\n`);
    });
  };

  protected _close = (): void | Promise<void> => {
    if (!this._process) {
      this.disposeResources();
      return;
    }

    const child = this._process;
    if (child.stdin) {
      child.stdin.write("endsas;\n");
      child.stdin.end();
    }

    // Detach from the exiting process now, so a restart starts a new SAS
    // instead of reusing this one while it shuts down. This also stops a
    // submission that is still running (#90).
    this.disposeResources();
    child.on("error", () => {});

    // Give SAS a moment to shut down gracefully
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill();
      }
    }, 1000);
  };

  private onProcessClose = () => {
    if (!this._connected) {
      this._reject?.(new Error(l10n.t("Could not start the SAS process.")));
    }

    this.disposeResources();
  };

  private disposeResources = () => {
    if (this._process) {
      this._process.removeAllListeners();
      this._process.stdout?.removeAllListeners();
      this._process.stderr?.removeAllListeners();
      this._process = undefined;
    }
    this._resolve = undefined;
    this._reject = undefined;
    this._html5FileName = "";
    this._workDirectory = undefined;
    this._sessionReady = false;
    this._connected = false;
    this._startupOutput = "";
    clearTimeout(this._encodingTimer);
    this._encodingTimer = undefined;
    this.useEncoding(SessionEncoding.UTF8);
    if (sessionInstance === this) {
      sessionInstance = undefined;
    }
    updateStatusBarItem(false);
  };

  private onProcessError = (err: Error) => {
    this._reject?.(err);
  };

  private getResult = (): void => {
    const runResult: RunResult = {};

    // No HTML output is a valid completion state
    if (!this._html5FileName || !this._workDirectory) {
      this._resolve?.(runResult);
      return;
    }

    // Read the HTML file using Node.js fs
    const filePath = join(this._workDirectory, `${this._html5FileName}.htm`);

    readFile(filePath, (err: Error, html: Buffer) => {
      if (err) {
        this._resolve?.(runResult);
        return;
      }
      const fileContents = decodeHtml(html, this._encoding);

      //Make sure that the html has a valid body
      //TODO #185: should this be refactored into a shared location?
      if (fileContents.search('<*id="IDX*.+">') !== -1) {
        runResult.html5 = fileContents;
        runResult.title = l10n.t("Result");
      }
      this._resolve?.(runResult);
    });
  };

  private resolveSystemVars = (): void => {
    const code = `%let wd = %sysfunc(pathname(work));
  %let rc = %sysfunc(dlgcdir("&wd"));
  data _null_; length x $ 4096;
    file STDERR;
    x = resolve('&wd');  put '${WORK_DIR_START_TAG}' x '${WORK_DIR_END_TAG}';
    ${PUT_SESSION_ENCODING}
  run;

  `;
    if (this._process?.stdin) {
      this._process.stdin.write(code);
      // Setup finishes when SAS reports its encoding, or after the timeout.
      this._encodingTimer = setTimeout(
        () => this.finishSetup(undefined),
        ENCODING_DETECT_TIMEOUT_MS,
      );
    }
  };

  /**
   * Ends setup once the session encoding is known (or not, after the
   * timeout): from now on, SAS's output is read and code is written in it.
   */
  private finishSetup = (sasEncoding: string | undefined): void => {
    clearTimeout(this._encodingTimer);
    this._encodingTimer = undefined;
    if (this._connected || !this._process) {
      return;
    }
    const encoding = sasEncoding
      ? SessionEncoding.fromSasName(sasEncoding)
      : undefined;
    if (encoding && encoding !== this._encoding) {
      this.useEncoding(encoding);
    }
    this._startupOutput = "";
    this._connected = true;
    if (!encoding) {
      this.logWarning(
        sasEncoding
          ? l10n.t(
              "The SAS session encoding {encoding} is not supported. SAS output is read as UTF-8.",
              { encoding: sasEncoding },
            )
          : l10n.t(
              "SAS did not report its session encoding. SAS output is read as UTF-8.",
            ),
      );
    }

    // The profile's autoExec lines run once, right after SAS starts.
    const autoExecLines = this._config.autoExec
      ? toAutoExecLines(this._config.autoExec)
      : [];
    if (autoExecLines.length > 0 && this._process.stdin) {
      this._process.stdin.write(
        this.toSasInput(`${autoExecLines.join("\n")}\n`),
      );
    }

    this._resolve?.();
    updateStatusBarItem(true);
  };

  /** Reads and writes in this encoding from now on, with fresh decoders. */
  private useEncoding = (encoding: SessionEncoding): void => {
    this._encoding = encoding;
    this._stdoutDecoder = encoding.streamDecoder();
    this._stderrDecoder = encoding.streamDecoder();
  };

  /** Text in the session encoding, with a warning if a character is lost. */
  private toSasInput = (text: string): string | Buffer => {
    const { data, lossy } = this._encoding.input(text);
    if (lossy) {
      this.logWarning(
        l10n.t(
          "Characters that the SAS session encoding {encoding} does not have were replaced with ?.",
          { encoding: this._encoding.name },
        ),
      );
    }
    return data;
  };

  private logWarning = (line: string): void => {
    const logFn = this._onExecutionLogFn ?? this._onSessionLogFn;
    logFn?.([{ type: "warning", line: `WARNING: ${line}` }]);
  };

  private onStdoutData = (data: Buffer): void => {
    const output = this._stdoutDecoder.write(data).trimEnd();

    // Match SSH semantics: detect prompt from raw chunk
    if (!this._sessionReady && output.endsWith("?")) {
      this._sessionReady = true;
      this.resolveSystemVars();
      return;
    }

    const outputLines = output.split(/\n|\r\n/);
    outputLines.forEach((line) => {
      if (!line) {
        return;
      }
      const trimmedLine = line.trimEnd();
      if (trimmedLine.endsWith(LineCodes.RunEndCode)) {
        this.getResult();
      }
      if (!(trimmedLine.endsWith("?") || trimmedLine.endsWith(">"))) {
        this._onExecutionLogFn?.([{ type: "normal", line }]);
      }
    });
  };

  private onStderrData = (data: Buffer): void => {
    const text = this._stderrDecoder.write(data);
    const output = text.trimEnd();

    // Until setup finishes, look for the system variables in all of SAS's
    // output since its prompt, as a chunk can end inside a tag.
    let systemVarsOutput = output;
    if (this._sessionReady && !this._connected) {
      this._startupOutput += text;
      systemVarsOutput = this._startupOutput;
    }

    if (this._sessionReady && !this._workDirectory) {
      const match = systemVarsOutput.match(
        `${WORK_DIR_START_TAG}(/[\\s\\S]*?)${WORK_DIR_END_TAG}`,
      );
      if (match && match.length > 1) {
        this._workDirectory = match[1].trimEnd().replace(/(\r\n|\n|\r)/gm, "");
      }
    }

    // With -stdio, SAS writes its log to stderr. Once SAS is ready, that is
    // the log of the code we run, so it goes to the execution log, as the SSH
    // connection's does: the Positron console filters its own wrapper code
    // out of it, and a silent run captures it instead of showing it.
    const logFn = this._sessionReady
      ? this._onExecutionLogFn
      : this._onSessionLogFn;
    const outputLines = output.split(/\n|\r\n/);
    outputLines.forEach((line) => {
      if (!line) {
        return;
      }
      logFn?.([{ type: "normal", line }]);
      // The run ends at the output of `%put <RunEndCode>;` (stdio writes
      // %put to stderr), as with SSH. Its source echo, "16   %put ...;",
      // must not count: that ended the run early, and the marker line that
      // followed then ended the next run, such as a silent query, before it
      // had produced its log.
      if (line.trimEnd().endsWith(LineCodes.RunEndCode)) {
        this.getResult();
      }
    });

    if (this._sessionReady && !this._connected) {
      const sasEncoding = parseSessionEncoding(this._startupOutput);
      if (sasEncoding) {
        this.finishSetup(sasEncoding);
      }
    }
  };
}
