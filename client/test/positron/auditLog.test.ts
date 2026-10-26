// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sinon from "sinon";

import { AuditLog, AuditRecord, expandHome } from "../../src/positron/auditLog";

const input = (executionId: string): AuditRecord => ({
  event: "input",
  ts: "2026-10-26T12:00:00.000Z",
  osUser: "jdoe",
  host: "wb-node-1",
  positronSessionId: "sas-1",
  profile: "Viya",
  connectionType: "rest",
  executionId,
  code: "proc print data=sashelp.class; run;",
});

describe("AuditLog", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sas-audit-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends one JSON record per line, creating the directory", async () => {
    const file = path.join(dir, "nested", "audit.jsonl");
    const log = new AuditLog(() => file, sinon.stub());
    log.write(input("e1"));
    await log.write({
      event: "complete",
      ts: "2026-10-26T12:00:01.000Z",
      positronSessionId: "sas-1",
      executionId: "e1",
      status: "ok",
      errorCount: 0,
      warningCount: 1,
      durationMs: 1000,
    });

    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).to.have.length(2);
    expect(JSON.parse(lines[0])).to.deep.equal(input("e1"));
    expect(JSON.parse(lines[1])).to.include({
      event: "complete",
      status: "ok",
      warningCount: 1,
    });
  });

  it("keeps records in submission order", async () => {
    const file = path.join(dir, "audit.jsonl");
    const log = new AuditLog(() => file, sinon.stub());
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);
    await Promise.all(ids.map((id) => log.write(input(id))));
    const written = fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).executionId);
    expect(written).to.deep.equal(ids);
  });

  it("writes nothing when no file is configured", async () => {
    const onError = sinon.stub();
    await new AuditLog(() => "", onError).write(input("e1"));
    await new AuditLog(() => undefined, onError).write(input("e1"));
    expect(fs.readdirSync(dir)).to.be.empty;
    expect(onError.called).to.be.false;
  });

  it("reports a write failure once and never throws", async () => {
    // A path below a regular file cannot be created.
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "");
    const onError = sinon.stub();
    const log = new AuditLog(() => path.join(blocker, "audit.jsonl"), onError);
    await log.write(input("e1"));
    await log.write(input("e2"));
    expect(onError.calledOnce).to.be.true;
  });
});

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~/audit.jsonl")).to.equal(
      path.join(os.homedir(), "audit.jsonl"),
    );
    expect(expandHome("/var/log/sas.jsonl")).to.equal("/var/log/sas.jsonl");
  });
});
