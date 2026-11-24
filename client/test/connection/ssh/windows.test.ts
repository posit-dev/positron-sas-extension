// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as vscode from "vscode";

import { expect } from "chai";
import { EventEmitter } from "events";
import { SinonSandbox, SinonStub, createSandbox } from "sinon";
import { Client } from "ssh2";
import { stubInterface } from "ts-sinon";

import { setContext } from "../../../src/components/ExtensionContext";
import { LogLine, RunResult } from "../../../src/connection";
import * as scripts from "../../../src/connection/itc/script";
import { LineCodes, Tags } from "../../../src/connection/itc/script/env.json";
import { Session } from "../../../src/connection/session";
import {
  Config,
  LineSplitter,
  POWERSHELL_COMMAND,
  RESULTS_END_TAG,
  RESULTS_START_TAG,
  createSession,
} from "../../../src/connection/ssh/windows";
import { extensionContext } from "../../../src/node/extension";

const WORK = "C:\\Users\\user\\AppData\\Local\\Temp\\SAS Temporary Files\\_TD1";
const HTML_NAME = "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6";
const HTML = `<html><body><div id="IDX">Résumé ✓</div></body></html>`;

describe("SAS on Windows over SSH", () => {
  let sandbox: SinonSandbox;
  let channel: EventEmitter & { stderr: EventEmitter };
  let writeStub: SinonStub;
  let channelEndStub: SinonStub;
  let execStub: SinonStub;
  let endStub: SinonStub;
  let getScriptStub: SinonStub;
  let session: Session;
  let log: LogLine[];

  /** What the session wrote to PowerShell. */
  const written = () => writeStub.args.map(([text]) => String(text)).join("");

  /** PowerShell output, as bytes from the SSH channel. */
  const output = (text: string) => channel.emit("data", Buffer.from(text));

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  const connect = async (config: Partial<Config> = {}) => {
    session = createSession({
      host: "sasserver",
      port: 22,
      username: "user",
      saspath: "D:\\SAS\\sas.exe",
      sasOptions: ["-nosplash", "-linesize", "max"],
      ...config,
    });
    log = [];
    session.onExecutionLogFn = (lines) => log.push(...lines);
    const setup = session.setup(true);
    await settle();
    output(`${Tags.WorkDirStartTag}\r\n${WORK}\r\n${Tags.WorkDirEndTag}\r\n`);
    await setup;
  };

  beforeEach(() => {
    sandbox = createSandbox({});
    getScriptStub = sandbox.stub(scripts, "getScript").returns("<script>");
    writeStub = sandbox.stub().returns(true);
    writeStub.callsFake((_text, callback) => callback?.());
    channelEndStub = sandbox.stub();
    channel = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      write: writeStub,
      end: channelEndStub,
    });
    sandbox.stub(Client.prototype, "connect").callsFake(function (
      this: Client,
    ) {
      this.emit("ready");
      return this;
    });
    execStub = sandbox.stub(Client.prototype, "exec");
    execStub.callsFake((_command, callback) => {
      callback(undefined, channel);
      return true;
    });
    endStub = sandbox.stub(Client.prototype, "end");

    const context: vscode.ExtensionContext = {
      ...extensionContext,
      globalStorageUri: vscode.Uri.from({ scheme: "file", path: __dirname }),
      secrets: stubInterface<vscode.SecretStorage>(),
    };
    setContext(context);
  });

  afterEach(async () => {
    await session?.close();
    sandbox.restore();
  });

  it("starts the ITC script with PowerShell on the server, over COM", async () => {
    await connect();

    expect(execStub.firstCall.args[0]).to.equal(POWERSHELL_COMMAND);
    expect(getScriptStub.firstCall.args[0]).to.include({ remote: true });
    const text = written();
    expect(text).to.include("<script>");
    expect(text).to.include('$profileHost = "localhost"');
    expect(text).to.include("$protocol = 0");
    expect(text).to.include("$runner.Setup(");
    // -nosplash can't be set after SAS starts; -linesize max can.
    expect(text).to.include('$sasOpts=@("linesize=max")');
    expect(log.map(({ line }) => line).join("\n")).to.include("-nosplash");
  });

  it("uses IOM Bridge to the server's own spawner when asked", async () => {
    await connect({ windowsProtocol: "iom", iomPort: 8592 });

    const text = written();
    expect(text).to.include('$profileHost = "localhost"');
    expect(text).to.include("$port = 8592");
    expect(text).to.include("$protocol = 2");
    expect(text).to.include('$username = "user"');
  });

  it("sends the log and fetches results as base64, split across packets", async () => {
    await connect();

    const run = session.run(
      `ods html5(id=vscode) body="${HTML_NAME}.htm";\nproc print; run;`,
    );
    await settle();
    expect(written()).to.include(`path="${WORK}"`);

    // The log echoes the ODS statement, which names the results file.
    output(`1    ods html5(id=vscode) body="${HTML_NAME}.htm";\r\n`);
    // A log line split across two packets, and inside a UTF-8 character.
    const logLine = Buffer.from("NOTE: Résumé printed.\r\n");
    channel.emit("data", logLine.subarray(0, 8));
    channel.emit("data", logLine.subarray(8));
    output(`${LineCodes.RunEndCode}\r\n`);
    await settle();
    expect(written()).to.include(`FetchResultsFileBase64 $runner $filePath`);
    expect(written()).to.include(`${HTML_NAME}.htm`);

    const base64 = Buffer.from(HTML).toString("base64");
    const half = Math.floor(base64.length / 2);
    output(`${RESULTS_START_TAG}\r\n${base64.slice(0, half)}`);
    output(`${base64.slice(half)}\r\n${RESULTS_END_TAG}\r\n`);
    output(`${LineCodes.ResultsFetchedCode}\r\n`);

    const result: RunResult = await run;
    expect(result.html5).to.equal(HTML);
    const lines = log.map(({ line }) => line);
    expect(lines).to.include("NOTE: Résumé printed.");
    expect(lines.some((line) => line.includes(base64.slice(0, 10)))).to.be
      .false;
  });

  it("ends the SSH connection when it closes", async () => {
    await connect();
    await session.close();

    expect(written()).to.include("$runner.Close()");
    expect(channelEndStub.called).to.be.true;
    channel.emit("close");
    expect(endStub.called).to.be.true;
  });

  it("fails setup when the connection closes first", async () => {
    execStub.callsFake(function (this: Client) {
      this.emit("close");
      return true;
    });
    session = createSession({
      host: "sasserver",
      port: 22,
      username: "user",
    });
    let error: Error | undefined;
    await session.setup(true).catch((e) => (error = e));
    expect(error?.message).to.equal("Could not connect to the SAS server.");
  });
});

describe("LineSplitter", () => {
  it("passes whole lines only, joining split lines and characters", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    const data = Buffer.from("one\r\ntwo é\nthr");
    splitter.push(data.subarray(0, 9));
    splitter.push(data.subarray(9));
    expect(lines).to.deep.equal(["one", "two é"]);
    splitter.push("ee\n");
    splitter.push("tail");
    splitter.flush();
    expect(lines).to.deep.equal(["one", "two é", "three", "tail"]);
  });
});
