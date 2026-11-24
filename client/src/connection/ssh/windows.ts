// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";

import { EventEmitter } from "events";
import { Client, ClientChannel } from "ssh2";

import { BaseConfig, RunResult } from "..";
import { updateStatusBarItem } from "../../components/StatusBarItem";
import { SessionEncoding, decodeHtml } from "../encoding";
import { ITCSession } from "../itc";
import { ITCProtocol, ShellProcess } from "../itc/types";
import { escapePowershellString, getDirectorySeparator } from "../itc/util";
import { Session } from "../session";
import { SSHConnectionConfig, sshConnectConfig } from "./connect";
import { toWindowsSasOptions } from "./platform";

/**
 * Runs PowerShell on the server with UTF-8 input and output. `cmd /c`
 * works whether the account's OpenSSH shell is cmd or PowerShell.
 */
export const POWERSHELL_COMMAND =
  'cmd /d /c "chcp 65001 >NUL & powershell.exe -NonInteractive -NoProfile -Command -"';

/** Tags itcRemote.ps1 writes around a base64 results file. */
export const RESULTS_START_TAG = "<ResultsBase64>";
export const RESULTS_END_TAG = "</ResultsBase64>";

/** How long a closing session waits for PowerShell before it disconnects. */
const CLOSE_TIMEOUT_MS = 5000;

const DEFAULT_IOM_PORT = 8591;

export interface Config extends BaseConfig, SSHConnectionConfig {
  saspath?: string;
  /** How PowerShell on the server reaches SAS: "com" (default) or "iom". */
  windowsProtocol?: "com" | "iom";
  /** The object spawner port on the server, for "iom". */
  iomPort?: number;
  /** Where SASInterop.dll is on the server, if it isn't found. */
  interopLibraryFolderPath?: string;
}

/**
 * Splits a byte stream into lines, so a line split across SSH packets, or
 * a UTF-8 character split across them, arrives whole.
 */
export class LineSplitter {
  private pending = Buffer.alloc(0);

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    const data = Buffer.concat([
      new Uint8Array(this.pending),
      new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
    ]);
    const end = data.lastIndexOf(0x0a);
    if (end === -1) {
      this.pending = data;
      return;
    }
    this.pending = data.subarray(end + 1);
    for (const line of data.subarray(0, end).toString("utf8").split("\n")) {
      this.onLine(line.replace(/\r$/, "").replace(/^\uFEFF/, ""));
    }
  }

  /** Sends what's left of an unfinished last line. */
  flush(): void {
    if (this.pending.length) {
      const rest = this.pending.toString("utf8");
      this.pending = Buffer.alloc(0);
      this.onLine(rest.replace(/\r$/, ""));
    }
  }
}

/** PowerShell on the server, over an SSH channel, as the ITC session's shell. */
class RemoteShell implements ShellProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  readonly stdin: ShellProcess["stdin"];

  constructor(
    private readonly conn: Client,
    private readonly channel: ClientChannel,
    /** Takes a stdout line out of the stream when it returns true. */
    takeLine: (line: string) => boolean,
  ) {
    this.stdin = {
      write: (data, callback) => channel.write(data, callback),
    };
    const out = new LineSplitter((line) => {
      if (!takeLine(line)) {
        this.stdout.emit("data", Buffer.from(`${line}\n`));
      }
    });
    const err = new LineSplitter((line) =>
      this.stderr.emit("data", Buffer.from(`${line}\n`)),
    );
    channel.on("data", (data: Buffer) => out.push(data));
    channel.stderr.on("data", (data: Buffer) => err.push(data));
    channel.on("close", () => {
      out.flush();
      err.flush();
      this.killed = true;
      conn.end();
    });
  }

  kill(): void {
    if (this.killed) {
      return;
    }
    this.killed = true;
    // End PowerShell's input, so it runs what it was sent and exits.
    this.channel.end();
    setTimeout(() => this.conn.end(), CLOSE_TIMEOUT_MS).unref?.();
  }
}

/**
 * SAS 9.4 on Windows over SSH. SAS on Windows can't be driven through
 * stdin, so this runs the ITC PowerShell script on the server, which
 * starts SAS through COM (or IOM Bridge to the server's own spawner), and
 * talks to it over the SSH channel as the COM connection does locally.
 */
export class SSHWindowsSession extends ITCSession {
  protected remote = true;
  private _sshConfig: Config;
  private _resultsLines: string[] | undefined;
  private _resultsBase64: string[] = [];
  /** Startup-only SAS options of the profile, which COM can't set. */
  private _droppedOptions: string[] = [];

  /** Sets the profile; the ITC side reaches SAS on the server itself. */
  configure(config: Config): void {
    this._sshConfig = config;
    const { options, dropped } = toWindowsSasOptions(config.sasOptions);
    this._droppedOptions = dropped;
    const iom = config.windowsProtocol === "iom";
    this.config = {
      host: "localhost",
      port: iom ? config.iomPort || DEFAULT_IOM_PORT : 0,
      username: iom ? config.username : "",
      protocol: iom ? ITCProtocol.IOMBridge : ITCProtocol.COM,
      interopLibraryFolderPath: config.interopLibraryFolderPath,
      sasOptions: options,
    };
    // The stored IOM password belongs to the SSH host, not "localhost".
    this._passwordKey = `ssh:${config.host}${this._config.protocol}${config.username}`;
  }

  protected openShell(): Promise<ShellProcess> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let shell: RemoteShell | undefined;
      const fail = (error: unknown) => {
        if (!shell) {
          reject(error);
          conn.end();
        }
      };
      conn
        .on("ready", () => {
          conn.exec(POWERSHELL_COMMAND, (err, channel) => {
            if (err) {
              fail(err);
              return;
            }
            shell = new RemoteShell(conn, channel, this.takeResultsLine);
            this.warnDroppedOptions();
            resolve(shell);
          });
        })
        .on("error", (error) => {
          if (shell) {
            this._runReject?.(error);
          } else {
            fail(error);
          }
        })
        .on("close", () => {
          if (!shell) {
            fail(new Error(l10n.t("Could not connect to the SAS server.")));
          } else {
            this.onShellClosed(shell);
          }
        });
      conn.connect(sshConnectConfig(this._sshConfig, fail));
    });
  }

  private warnDroppedOptions(): void {
    if (this._droppedOptions.length) {
      const line = l10n.t(
        "WARNING: SAS on Windows starts through COM, which ignores these startup options: {options}",
        { options: this._droppedOptions.join(" ") },
      );
      this._onExecutionLogFn?.([{ type: "warning", line }]);
    }
  }

  /** The connection closed: a later run connects again. */
  private onShellClosed(shell: RemoteShell): void {
    if (this._shellProcess !== shell) {
      return; // closed by close()
    }
    this._shellProcess = undefined;
    this._workDirectory = undefined;
    this._resultsLines = undefined;
    this._runReject?.(
      new Error(l10n.t("The connection to the SAS server closed.")),
    );
    this._runReject = undefined;
    this._runResolve = undefined;
    updateStatusBarItem(false);
  }

  /** Collects the base64 lines of a results file, out of the log. */
  private takeResultsLine = (line: string): boolean => {
    if (this._resultsLines) {
      if (line === RESULTS_END_TAG) {
        this._resultsBase64 = this._resultsLines;
        this._resultsLines = undefined;
      } else {
        this._resultsLines.push(line);
      }
      return true;
    }
    if (line === RESULTS_START_TAG) {
      this._resultsLines = [];
      return true;
    }
    return false;
  };

  protected async fetchResultsFile(): Promise<void> {
    const separator = getDirectorySeparator(this._workDirectory);
    const filePath = `${this._workDirectory}${separator}${this._html5FileName}.htm`;
    this._resultsBase64 = [];
    this._shellProcess.stdin.write(
      `$filePath = "${escapePowershellString(filePath)}"
FetchResultsFileBase64 $runner $filePath\n`,
      this.onWriteComplete,
    );
  }

  protected displayResults = async () => {
    const html = decodeHtml(
      Buffer.from(this._resultsBase64.join(""), "base64"),
      SessionEncoding.UTF8,
    );
    this._resultsBase64 = [];
    const runResult: RunResult = {};
    if (html.search('<*id="IDX*.+">') !== -1) {
      runResult.html5 = html;
      runResult.title = l10n.t("Result");
    }
    this._runResolve?.(runResult);
  };
}

let sessionInstance: SSHWindowsSession | undefined;

/** The shared session for SAS on Windows over SSH. */
export function getSession(c: Config): Session {
  if (!sessionInstance) {
    sessionInstance = new SSHWindowsSession();
  }
  sessionInstance.configure(c);
  return sessionInstance;
}

/** A new session with its own SSH connection, separate from the shared one. */
export function createSession(c: Config): Session {
  const session = new SSHWindowsSession();
  session.configure(c);
  return session;
}
