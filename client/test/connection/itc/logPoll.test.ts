// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as vscode from "vscode";

import { expect } from "chai";
import proc from "child_process";
import { SinonFakeTimers, SinonSandbox, SinonStub, createSandbox } from "sinon";
import { stubInterface } from "ts-sinon";

import { setContext } from "../../../src/components/ExtensionContext";
import { getSession } from "../../../src/connection/itc";
import * as scripts from "../../../src/connection/itc/script";
import { LineCodes, Tags } from "../../../src/connection/itc/script/env.json";
import { ITCProtocol } from "../../../src/connection/itc/types";
import { Session } from "../../../src/connection/session";
import { extensionContext } from "../../../src/node/extension";

describe("ITC log polling", () => {
  let sandbox: SinonSandbox;
  let clock: SinonFakeTimers;
  let stdinStub: SinonStub;
  let session: Session;
  let onData: (chunk: Buffer) => void;

  const flushes = () =>
    stdinStub.args.filter(([text]) => String(text).includes("FlushLogLines")).length;

  /** Start a run and let PowerShell accept the `$runner.Run` line. */
  const startRun = (code: string) => {
    const done = session.run(code);
    // A run still going when the test ends is rejected by close().
    done.catch(() => undefined);
    const runCall = [...stdinStub.args].reverse().find(([text]) => text === "$runner.Run($code)\n");
    runCall?.[1]?.();
    return done;
  };

  beforeEach(async () => {
    sandbox = createSandbox({});
    sandbox.stub(scripts, "getScript");
    stdinStub = sandbox.stub();
    // Untyped stubs, as in index.test.ts: the fake process only has what
    // the session uses.
    const stdoutOn: SinonStub = sandbox.stub();
    stdoutOn.callsFake((event, callback) => {
      if (event === "data") {
        onData = callback;
      }
    });
    const spawnStub: SinonStub = sandbox.stub(proc, "spawn");
    spawnStub.returns({
      stdout: { on: stdoutOn, write: sandbox.stub() },
      stderr: { on: sandbox.stub() },
      stdin: { write: stdinStub, end: sandbox.stub() },
      on: sandbox.stub(),
      kill: sandbox.stub(),
    });
    const context: vscode.ExtensionContext = {
      ...extensionContext,
      globalStorageUri: vscode.Uri.from({ scheme: "file", path: __dirname }),
      secrets: stubInterface<vscode.SecretStorage>(),
    };
    setContext(context);

    session = getSession({ host: "localhost", sasOptions: [] }, ITCProtocol.COM);
    session.onExecutionLogFn = () => undefined;
    const setup = session.setup();
    onData(Buffer.from(Tags.WorkDirStartTag));
    onData(Buffer.from("/work/dir"));
    onData(Buffer.from(Tags.WorkDirEndTag));
    await setup;
    clock = sandbox.useFakeTimers();
  });

  afterEach(async () => {
    // getSession keeps one session; close it so the next test starts afresh.
    await session.close();
    sandbox.restore();
  });

  it("polls the log soon after a run starts", async () => {
    const run = startRun("%put hi;");
    expect(flushes()).to.equal(0);
    await clock.tickAsync(100);
    expect(flushes()).to.equal(1);
    onData(Buffer.from(LineCodes.RunEndCode));
    await run;
  });

  it("backs off to every 2 seconds for long runs", async () => {
    startRun("data _null_; call sleep(60, 1); run;");
    // 100, 200, 400, 800, 1600, 2000, 2000 ms apart.
    await clock.tickAsync(100 + 200 + 400 + 800 + 1600 + 2000 + 2000);
    expect(flushes()).to.equal(7);
  });

  it("stops polling a finished run when the next one starts", async () => {
    const first = startRun("%put one;");
    await clock.tickAsync(100);
    onData(Buffer.from(LineCodes.RunEndCode));
    await first;
    const second = startRun("%put two;");
    const before = flushes();
    // Only the second run's poll is left: one flush at +100 ms, then +200.
    await clock.tickAsync(300);
    expect(flushes() - before).to.equal(2);
    onData(Buffer.from(LineCodes.RunEndCode));
    await second;
    // After the last flush of a finished run, nothing keeps polling.
    await clock.tickAsync(400);
    const settled = flushes();
    await clock.tickAsync(10_000);
    expect(flushes()).to.equal(settled);
  });
});
