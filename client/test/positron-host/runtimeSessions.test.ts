// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { EventEmitter } from "events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as sinon from "sinon";

import { ConnectionType, ProfileConfig } from "../../src/components/profile";
import { processLauncher } from "../../src/connection/stdio";
import { LineCodes } from "../../src/connection/stdio/types";
import { SASLanguageRuntimeSession } from "../../src/positron/PositronLanguageRuntimeSession";
import { getActiveSession } from "../../src/positron/index";
import {
  LanguageRuntimeMetadata,
  LanguageRuntimeSessionLocation,
  LanguageRuntimeSessionMode,
  LanguageRuntimeStartupBehavior,
  RuntimeExitReason,
} from "../../src/positron/positron-types";

/** A stand-in SAS process that answers the stdio session's protocol. */
class FakeSasProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly written: string[] = [];
  ended = false;
  killed = false;
  readonly stdin = {
    write: (data: string) => {
      this.written.push(data);
      if (data.includes(LineCodes.RunEndCode)) {
        setImmediate(() =>
          this.stdout.emit("data", Buffer.from(LineCodes.RunEndCode)),
        );
      }
      return true;
    },
    end: () => {
      this.ended = true;
      setImmediate(() => this.emit("close", 0, null));
    },
  };

  constructor(readonly saspath: string) {
    super();
    // SAS prompts once it is ready.
    setImmediate(() => this.stdout.emit("data", Buffer.from("?")));
  }

  kill() {
    this.killed = true;
  }
}

// #88 and #89: each Positron SAS console starts its own SAS session, from the
// profile of the runtime that was picked.
describe("Positron SAS runtime sessions", () => {
  let fakeSasDir: string;
  let sasX: string;
  let sasY: string;
  before(() => {
    fakeSasDir = mkdtempSync(join(tmpdir(), "runtime-sessions-test-"));
    sasX = join(fakeSasDir, "sas-x");
    sasY = join(fakeSasDir, "sas-y");
    for (const sas of [sasX, sasY]) {
      writeFileSync(sas, "#!/bin/sh\n");
      chmodSync(sas, 0o755);
    }
  });
  after(() => {
    rmSync(fakeSasDir, { recursive: true, force: true });
  });

  let sandbox: sinon.SinonSandbox;
  let spawned: FakeSasProcess[];
  let sessions: SASLanguageRuntimeSession[];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    spawned = [];
    sessions = [];
    sandbox.stub(ProfileConfig.prototype, "getAllProfiles").returns({
      X: { connectionType: ConnectionType.Stdio, saspath: sasX },
      Y: { connectionType: ConnectionType.Stdio, saspath: sasY },
    });
    sandbox.stub(ProfileConfig.prototype, "getActiveProfile").returns("Y");
    sandbox.stub(processLauncher, "spawn").callsFake((saspath: string) => {
      const process = new FakeSasProcess(saspath);
      spawned.push(process);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return process as any;
    });
  });

  afterEach(async () => {
    for (const session of sessions) {
      await session.shutdown(RuntimeExitReason.Shutdown);
    }
    sandbox.restore();
  });

  function newSession(
    profileName: string,
    sessionMode = LanguageRuntimeSessionMode.Background,
  ): SASLanguageRuntimeSession {
    const runtimeMetadata: LanguageRuntimeMetadata = {
      runtimeId: `sas-${profileName}`,
      runtimeName: `SAS (${profileName})`,
      runtimeShortName: profileName,
      runtimeVersion: "9.4+",
      runtimeSource: "SAS Extension",
      runtimePath: "",
      languageName: "SAS",
      languageId: "sas",
      languageVersion: "9.4+",
      base64EncodedIconSvg: undefined,
      startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
      sessionLocation: LanguageRuntimeSessionLocation.Machine,
      extraRuntimeData: { profile: profileName },
    };
    const session = new SASLanguageRuntimeSession(
      runtimeMetadata,
      { sessionId: `sas-test-${sessions.length}`, sessionMode },
      profileName,
    );
    sessions.push(session);
    return session;
  }

  it("starts the picked profile, not the active one", async () => {
    await newSession("X").start();

    expect(spawned.map((p) => p.saspath)).to.deep.equal([sasX]);
  });

  it("gives each console of the same profile its own SAS process", async () => {
    await newSession("X").start();
    await newSession("X").start();

    expect(spawned).to.have.length(2);
    expect(spawned[0]).to.not.equal(spawned[1]);
  });

  it("shutting down one console leaves the other running", async () => {
    const first = newSession("X", LanguageRuntimeSessionMode.Console);
    const second = newSession("X", LanguageRuntimeSessionMode.Console);
    await first.start();
    await second.start();
    expect(getActiveSession()).to.equal(second);

    await first.shutdown(RuntimeExitReason.Shutdown);
    sessions.shift();

    expect(spawned[0].ended).to.be.true;
    expect(spawned[1].ended).to.be.false;
    expect(getActiveSession()).to.equal(second);

    // The second console's SAS process still runs code.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sasSession = (second as any)._sasSession;
    const before = spawned[1].written.length;
    await sasSession.run("data _null_; run;");
    expect(spawned[1].written.slice(before).join("")).to.contain(
      "data _null_; run;",
    );
  });
});
