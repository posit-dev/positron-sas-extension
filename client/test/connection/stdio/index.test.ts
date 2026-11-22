// Copyright © 2022-2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { EventEmitter } from "events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as sinon from "sinon";

import { AutoExecType } from "../../../src/components/profile";
import {
  StdioSession,
  createSession,
  getSession,
  processLauncher,
} from "../../../src/connection/stdio";
import { LineCodes } from "../../../src/connection/stdio/types";
import { assertThrowsAsync } from "../../utils";

/** Bytes from text (as UTF-8) and single byte values, in order. */
const bytes = (...parts: (string | number)[]): Buffer =>
  Buffer.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...Buffer.from(part)] : [part],
    ),
  );

/** What SAS writes to stderr for the system variables code. */
const systemVarsOutput = (workDir: string, encoding: string) =>
  `WORKDIR${workDir} WORKDIREND\nSASENC ${encoding} SASENCEND\n`;

/**
 * SAS's prompt, then its answer to the system variables code, which finishes
 * setup.
 */
function startSas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  child: any,
  encoding = "utf-8",
  workDir = "/tmp/work",
): void {
  child.stdout.emit("data", Buffer.from("?"));
  child.stderr.emit("data", Buffer.from(systemVarsOutput(workDir, encoding)));
}

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
      startSas(mockProcess);

      await setupPromise;

      // Verify spawn was called correctly
      expect(spawnStub.calledOnce).to.be.true;
      const spawnArgs = spawnStub.firstCall.args;
      expect(spawnArgs[0]).to.equal(fakeSas);
      expect(spawnArgs[1]).to.include("-nodms");
      expect(spawnArgs[1]).to.include("-noterminal");
      // Unwrapped log lines, so the console can filter its wrapper code.
      expect(spawnArgs[1].join(" ")).to.include("-linesize max");
      expect(spawnArgs[1]).to.include("-memsize");
      expect(spawnArgs[1]).to.include("2G");
    });

    it("runs the profile's autoExec lines after SAS starts", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      const writeStub = sandbox.stub();
      mockStdin.write = writeStub;
      mockStdin.end = sandbox.stub();
      const mockStdout = new EventEmitter();

      mockProcess = new EventEmitter();
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = mockStdout;
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = sandbox.stub();
      mockProcess.killed = false;
      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession({
        saspath: fakeSas,
        sasOptions: [],
        autoExec: [
          { type: AutoExecType.Line, line: "options pagesize=max;" },
          { type: AutoExecType.Line, line: "%let x = 1;" },
        ],
      });

      const setupPromise = session.setup();
      expect(writeStub.called).to.be.false;
      startSas(mockProcess);
      await setupPromise;

      expect(writeStub.calledWith("options pagesize=max;\n%let x = 1;\n")).to.be
        .true;
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
      startSas(mockProcess);
      await setupPromise;

      // Now run some code
      const runPromise = session.run("data test; x=1; run;");

      // Simulate completion marker
      mockStdout.emit("data", Buffer.from(LineCodes.RunEndCode));

      await runPromise;

      // Verify code was written
      expect(writeStub.calledWith("data test; x=1; run;\n")).to.be.true;
      expect(writeStub.calledWith(`%put ${LineCodes.RunEndCode};\n`)).to.be
        .true;
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

  describe("log routing", () => {
    it("sends SAS's log (stderr) to the execution log once SAS is ready", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      mockStdin.write = sandbox.stub();
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

      session = new StdioSession({ saspath: fakeSas, sasOptions: [] });
      const sessionLog: string[] = [];
      const executionLog: string[] = [];
      session.onSessionLogFn = (logs) =>
        sessionLog.push(...logs.map((l) => l.line));
      session.onExecutionLogFn = (logs) =>
        executionLog.push(...logs.map((l) => l.line));

      const setupPromise = session.setup();
      mockStderr.emit("data", Buffer.from("NOTE: SAS initialization used"));
      startSas(mockProcess);
      await setupPromise;

      const runPromise = session.run("%put hello;");
      mockStderr.emit(
        "data",
        Buffer.from(`1    %put hello;\nhello\n${LineCodes.RunEndCode}`),
      );
      await runPromise;

      expect(sessionLog).to.deep.equal(["NOTE: SAS initialization used"]);
      expect(executionLog).to.include.members(["1    %put hello;", "hello"]);
    });

    it("ends a run at the end marker's output, not at its source echo", async () => {
      // run() settles a few promise turns after the marker; the timers are fake.
      const flush = async () => {
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      mockStdin.write = sandbox.stub();
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

      session = new StdioSession({ saspath: fakeSas, sasOptions: [] });
      const executionLog: string[] = [];
      session.onExecutionLogFn = (logs) =>
        executionLog.push(...logs.map((l) => l.line));
      const setupPromise = session.setup();
      startSas(mockProcess);
      await setupPromise;

      let firstDone = false;
      const first = session.run("%let x=1;").then(() => (firstDone = true));
      // The source echo of the wrapper's own %put arrives first.
      mockStderr.emit(
        "data",
        Buffer.from(`1    %let x=1;\n2    %put ${LineCodes.RunEndCode};`),
      );
      await flush();
      expect(firstDone).to.be.false;

      mockStderr.emit("data", Buffer.from(LineCodes.RunEndCode));
      await first;

      // The next run gets its own log and ends at its own marker.
      let secondDone = false;
      const second = session
        .run("%put snapshot;")
        .then(() => (secondDone = true));
      mockStderr.emit(
        "data",
        Buffer.from(
          `3    %put snapshot;\nsnapshot\n4    %put ${LineCodes.RunEndCode};`,
        ),
      );
      await flush();
      expect(secondDone).to.be.false;
      mockStderr.emit("data", Buffer.from(LineCodes.RunEndCode));
      await second;
      expect(executionLog).to.include("snapshot");
    });
  });

  describe("session encoding", () => {
    // run() settles a few promise turns after the marker; the timers are fake.
    const flush = async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    };
    let writeStub: sinon.SinonStub;
    let executionLog: string[];

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockStdin: any = new EventEmitter();
      writeStub = sandbox.stub();
      mockStdin.write = writeStub;
      mockStdin.end = sandbox.stub();
      mockProcess = new EventEmitter();
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = sandbox.stub();
      mockProcess.killed = false;
      sandbox.stub(processLauncher, "spawn").returns(mockProcess);

      session = new StdioSession({ saspath: fakeSas, sasOptions: [] });
      executionLog = [];
      session.onExecutionLogFn = (logs) =>
        executionLog.push(...logs.map((l) => l.line));
    });

    it("asks SAS for its encoding and finishes setup when SAS reports it", async () => {
      let ready = false;
      const setupPromise = session.setup().then(() => (ready = true));
      mockProcess.stdout.emit("data", Buffer.from("?"));
      await flush();

      expect(writeStub.firstCall.args[0]).to.include("&sysencoding");
      expect(ready).to.be.false;

      // The tag can arrive split over two chunks.
      mockProcess.stderr.emit(
        "data",
        Buffer.from("WORKDIR/w WORKDIREND\nSASE"),
      );
      await flush();
      expect(ready).to.be.false;
      mockProcess.stderr.emit("data", Buffer.from("NC wlatin1 SASENCEND\n"));
      await setupPromise;
    });

    it("writes code and reads the log in a wlatin1 session's encoding", async () => {
      const setupPromise = session.setup();
      startSas(mockProcess, "wlatin1");
      await setupPromise;

      const runPromise = session.run("%put ä€;");
      mockProcess.stderr.emit(
        "data",
        bytes(0xe4, 0x80, `\n${LineCodes.RunEndCode}`),
      );
      await runPromise;

      const code = writeStub
        .getCalls()
        .map((call) => call.args[0])
        .find((arg) => Buffer.isBuffer(arg));
      expect(Buffer.isBuffer(code)).to.be.true;
      expect([...code]).to.deep.equal([
        ...Buffer.from("%put "),
        0xe4,
        0x80,
        ...Buffer.from(";\n"),
      ]);
      expect(executionLog).to.include("ä€");
    });

    it("warns when code has characters the session encoding lacks", async () => {
      const setupPromise = session.setup();
      startSas(mockProcess, "latin1");
      await setupPromise;

      const runPromise = session.run("%put €;");
      mockProcess.stderr.emit("data", Buffer.from(LineCodes.RunEndCode));
      await runPromise;

      expect(executionLog.some((line) => line.includes("latin1"))).to.be.true;
    });

    it("reads a UTF-8 character split over two chunks", async () => {
      const setupPromise = session.setup();
      startSas(mockProcess);
      await setupPromise;

      const runPromise = session.run("%put ä;");
      mockProcess.stderr.emit("data", Buffer.from([0xc3]));
      mockProcess.stderr.emit("data", bytes(0xa4, `\n${LineCodes.RunEndCode}`));
      await runPromise;

      expect(executionLog).to.include("ä");
      expect(writeStub.calledWith("%put ä;\n")).to.be.true;
    });

    it("goes on with UTF-8 when SAS does not report its encoding", async () => {
      const setupPromise = session.setup();
      mockProcess.stdout.emit("data", Buffer.from("?"));
      await sandbox.clock.tickAsync(30_000);
      await setupPromise;

      expect(executionLog.some((line) => line.includes("did not report"))).to.be
        .true;
    });

    it("goes on with UTF-8 when the encoding is not supported", async () => {
      const setupPromise = session.setup();
      startSas(mockProcess, "no-such-encoding");
      await setupPromise;

      expect(executionLog.some((line) => line.includes("no-such-encoding"))).to
        .be.true;
    });

    it("rejects setup when SAS exits before it reports its encoding", async () => {
      const setupPromise = session.setup();
      mockProcess.stdout.emit("data", Buffer.from("?"));
      mockProcess.emit("close", 1, null);

      await assertThrowsAsync(
        async () => await setupPromise,
        "Could not start the SAS process.",
      );
    });

    it("reads the HTML result in its charset, else in the session encoding", async () => {
      const setupPromise = session.setup();
      startSas(mockProcess, "wlatin1", fakeSasDir);
      await setupPromise;

      const run = async (name: string, html: Buffer) => {
        writeFileSync(join(fakeSasDir, `${name}.htm`), new Uint8Array(html));
        const runPromise = session.run(`ods html5 body="${name}.htm";`);
        mockProcess.stderr.emit("data", Buffer.from(LineCodes.RunEndCode));
        return await runPromise;
      };
      const latin = await run(
        "11111111-2222-3333-4444-555555555555",
        bytes('<div id="IDX1">', 0xe4),
      );
      expect(latin.html5).to.include("ä");

      const utf8 = await run(
        "11111111-2222-3333-4444-666666666666",
        bytes('<meta charset="utf-8"><div id="IDX1">ä'),
      );
      expect(utf8.html5).to.include("ä");
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
      startSas(mockProcess);
      await setupPromise;

      // Close session
      session.close();

      // Verify ENDSAS was written
      expect(writeStub.calledWith("endsas;\n")).to.be.true;
      expect(endStub.calledOnce).to.be.true;
    });

    it("starts a new SAS process on the next setup and kills the old one", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const makeProcess = (): any => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stdin: any = new EventEmitter();
        stdin.write = sandbox.stub();
        stdin.end = sandbox.stub();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const child: any = new EventEmitter();
        child.stdin = stdin;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = sandbox.stub();
        child.killed = false;
        child.exitCode = null;
        return child;
      };
      const first = makeProcess();
      const second = makeProcess();
      const spawnStub = sandbox.stub(processLauncher, "spawn");
      spawnStub.onFirstCall().returns(first);
      spawnStub.onSecondCall().returns(second);

      session = new StdioSession({ saspath: fakeSas, sasOptions: [] });
      let setupPromise = session.setup();
      startSas(first);
      await setupPromise;

      // SAS is still busy, so it does not exit on ENDSAS.
      session.close();

      setupPromise = session.setup();
      startSas(second);
      await setupPromise;
      expect(spawnStub.calledTwice).to.be.true;

      sandbox.clock.tick(1000);
      expect(first.kill.calledOnce).to.be.true;
      expect(second.kill.called).to.be.false;
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

  describe("createSession", () => {
    const config = () => ({ saspath: fakeSas, sasOptions: [] });

    it("returns a new session each time, separate from the shared one", () => {
      const shared = getSession(config());
      const session1 = createSession(config());
      const session2 = createSession(config());

      expect(session1).to.not.equal(session2);
      expect(session1).to.not.equal(shared);
      expect(session2).to.not.equal(shared);
    });

    it("closing a separate session keeps the shared one", async () => {
      const shared = getSession(config());

      await createSession(config()).close();

      expect(getSession(config())).to.equal(shared);
    });
  });
});
