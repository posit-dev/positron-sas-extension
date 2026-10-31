// Copyright © 2022-2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { EventEmitter } from "events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as sinon from "sinon";

import {
  StdioSession,
  getSession,
  processLauncher,
} from "../../../src/connection/stdio";
import { assertThrowsAsync } from "../../utils";

// setup() and run() attach the process handlers synchronously, so the tests emit
// mock SAS output right after calling them. process.nextTick callbacks would not
// run under the sandbox's fake timers, and the awaited promise would never settle.
describe("stdio connection", () => {
  // The session checks that saspath is executable before spawning, so the tests
  // use a real (never run, spawn is stubbed) executable file as SAS.
  let fakeSasDir: string;
  let fakeSas: string;
  before(() => {
    fakeSasDir = mkdtempSync(join(tmpdir(), "stdio-test-"));
    fakeSas = join(fakeSasDir, "sas");
    writeFileSync(fakeSas, "#!/bin/sh\n");
    chmodSync(fakeSas, 0o755);
  });
  after(() => {
    rmSync(fakeSasDir, { recursive: true, force: true });
  });

  let sandbox: sinon.SinonSandbox;
  let session: StdioSession;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockProcess: any;

  beforeEach(() => {
    sandbox = sinon.createSandbox({
      useFakeTimers: { shouldClearNativeTimers: true },
    });

    const config = {
      saspath: fakeSas,
      sasOptions: [],
    };

    session = new StdioSession(config);
    session.onExecutionLogFn = () => {
      return;
    };
  });

  afterEach(() => {
    sandbox.restore();
    if (sandbox.clock) {
      sandbox.clock.restore();
    }
  });

  describe("setup", () => {
    it("rejects with the saspath when SAS is not executable", async () => {
      const missing = join(fakeSasDir, "no-such-sas");
      session = new StdioSession({ saspath: missing, sasOptions: [] });
      const spawnStub = sandbox.stub(processLauncher, "spawn");

      await assertThrowsAsync(async () => await session.setup(), missing);

      expect(spawnStub.called).to.be.false;
    });

    it("spawns SAS process with correct params", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: ["-memsize", "2G"],
      };

      // Create mock streams
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      mockStdin.write = sandbox.stub();
      mockStdin.end = sandbox.stub();

      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();

      // Create mock process
      mockProcess = new EventEmitter();
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = mockStdout;
      mockProcess.stderr = mockStderr;
      mockProcess.kill = sandbox.stub();
      mockProcess.killed = false;

      // Stub the SAS process launch
      const spawnStub = sandbox
        .stub(processLauncher, "spawn")
        .returns(mockProcess);

      session = new StdioSession(config);

      // Start setup in the background
      const setupPromise = session.setup();

      // Simulate SAS ready prompt
      mockStdout.emit("data", Buffer.from("?"));

      await setupPromise;

      // Verify spawn was called correctly
      expect(spawnStub.calledOnce).to.be.true;
      const spawnArgs = spawnStub.firstCall.args;
      expect(spawnArgs[0]).to.equal(fakeSas);
      expect(spawnArgs[1]).to.include("-nodms");
      expect(spawnArgs[1]).to.include("-noterminal");
      expect(spawnArgs[1]).to.include("-memsize");
      expect(spawnArgs[1]).to.include("2G");
    });

    it("rejects on process error", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      // Create mock process that emits error
      mockProcess = new EventEmitter();
      mockProcess.stdin = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession(config);

      const setupPromise = session.setup();

      // Simulate process error
      mockProcess.emit("error", new Error("SAS process failed to start"));

      await assertThrowsAsync(async () => {
        await setupPromise;
      }, "SAS process failed to start");
    });

    it("rejects when process closes before ready", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      mockProcess = new EventEmitter();
      mockProcess.stdin = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.removeAllListeners = sandbox.stub();

      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession(config);

      const setupPromise = session.setup();

      // Simulate process closing before ready
      mockProcess.stdout.removeAllListeners = sandbox.stub();
      mockProcess.stderr.removeAllListeners = sandbox.stub();
      mockProcess.emit("close", 1, null);

      await assertThrowsAsync(async () => {
        await setupPromise;
      }, "Could not start the SAS process.");
    });
  });

  describe("run", () => {
    it("writes code to stdin and handles completion", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      // Create mock streams
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      const writeStub = sandbox.stub();
      mockStdin.write = writeStub;
      mockStdin.end = sandbox.stub();

      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();

      mockProcess = new EventEmitter();
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = mockStdout;
      mockProcess.stderr = mockStderr;
      mockProcess.kill = sandbox.stub();
      mockProcess.killed = false;

      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession(config);

      // Setup session first
      const setupPromise = session.setup();
      mockStdout.emit("data", Buffer.from("?"));
      await setupPromise;

      // Now run some code
      const runPromise = session.run("data test; x=1; run;");

      // Simulate completion marker
      mockStdout.emit("data", Buffer.from("quit82938829"));

      await runPromise;

      // Verify code was written
      expect(writeStub.calledWith("data test; x=1; run;\n")).to.be.true;
      expect(writeStub.calledWith("%put quit82938829;\n")).to.be.true;
    });

    it("rejects if process is not running", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      session = new StdioSession(config);

      await assertThrowsAsync(async () => {
        await session.run("data test; x=1; run;");
      }, "SAS process is not running.");
    });
  });

  describe("close", () => {
    it("sends ENDSAS and closes stdin", async () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      const writeStub = sandbox.stub();
      const endStub = sandbox.stub();
      mockStdin.write = writeStub;
      mockStdin.end = endStub;

      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();

      mockProcess = new EventEmitter();
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = mockStdout;
      mockProcess.stderr = mockStderr;
      mockProcess.kill = sandbox.stub();
      mockProcess.killed = false;
      mockProcess.removeAllListeners = sandbox.stub().returnsThis();
      mockStdout.removeAllListeners = sandbox.stub().returnsThis();
      mockStderr.removeAllListeners = sandbox.stub().returnsThis();

      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession(config);

      // Setup session
      const setupPromise = session.setup();
      mockStdout.emit("data", Buffer.from("?"));
      await setupPromise;

      // Close session
      session.close();

      // Verify ENDSAS was written
      expect(writeStub.calledWith("endsas;\n")).to.be.true;
      expect(endStub.calledOnce).to.be.true;
    });
  });

  describe("getSession", () => {
    it("returns singleton session instance", () => {
      const config = {
        saspath: fakeSas,
        sasOptions: [],
      };

      const session1 = getSession(config);
      const session2 = getSession(config);

      expect(session1).to.equal(session2);
    });
  });
});
