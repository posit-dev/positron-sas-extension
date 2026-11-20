// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect } from "chai";
import sinon from "sinon";

import {
  SasClient,
  checkMacroExpression,
  isInternalMacroName,
  parseMacroExpression,
  parseSessionSnapshot,
} from "../../src/positron/sasClient";
import type { SessionSnapshot } from "../../src/positron/sasClient";
import {
  AUTOMATIC_KEY,
  SasVariables,
  type SasVariablesBackend,
  letStatement,
} from "../../src/positron/sasVariables";

function sentinelWrap(content: string): string {
  return `log noise\n~~SAS_START~~\n${content}\n~~SAS_END~~\nmore noise`;
}

// ─── parseSessionSnapshot ────────────────────────────────────────────────────

describe("parseSessionSnapshot", () => {
  it("parses macro variables and keeps pipes and leading blanks", () => {
    const { macros } = parseSessionSnapshot(
      sentinelWrap(
        [
          "MN1=AUTOMATIC|SYSERR|1",
          "MX1=|0",
          "MN2=GLOBAL|PIPE|5",
          "MX2=|a|b|c",
          "MN3=GLOBAL|LEAD|4",
          "MX3=|   x",
          "MN4=GLOBAL|EMPTY|0",
          "MN5=GLOBAL|TRAIL|4",
          "MX5=|y",
        ].join("\n"),
      ),
    );
    expect(macros).to.deep.equal([
      { scope: "AUTOMATIC", name: "SYSERR", value: "0" },
      { scope: "GLOBAL", name: "PIPE", value: "a|b|c" },
      { scope: "GLOBAL", name: "LEAD", value: "   x" },
      { scope: "GLOBAL", name: "EMPTY", value: "" },
      // The log drops trailing blanks; the length puts them back.
      { scope: "GLOBAL", name: "TRAIL", value: "y   " },
    ]);
  });

  it("joins 200-character chunks and keeps blanks at chunk ends", () => {
    // 199 x's and a blank fill the first chunk; the log drops the blank.
    const { macros } = parseSessionSnapshot(
      sentinelWrap(
        ["MN1=GLOBAL|LONG|202", `MX1=|${"x".repeat(199)}`, "MX1=| z"].join("\n"),
      ),
    );
    expect(macros).to.have.length(1);
    expect(macros[0].value).to.equal(`${"x".repeat(199)}  z`);
  });

  it("trims the padding of AUTOMATIC values", () => {
    const { macros } = parseSessionSnapshot(
      sentinelWrap(["MN1=AUTOMATIC|SYSLAST|10", "MX1=|WORK.V"].join("\n")),
    );
    expect(macros[0].value).to.equal("WORK.V");
  });

  it("hides the extension's own helper variables", () => {
    const { macros } = parseSessionSnapshot(
      sentinelWrap(
        [
          "MN1=GLOBAL|_SAS_OPT|6",
          "MX1=|ls=100",
          "MN2=GLOBAL|_DR3|3",
          "MX2=|row",
          "MN3=GLOBAL|MYVAR|1",
          "MX3=|1",
        ].join("\n"),
      ),
    );
    expect(macros.map((m) => m.name)).to.deep.equal(["MYVAR"]);
  });

  it("parses WORK tables, views and labels with pipes", () => {
    const { tables } = parseSessionSnapshot(
      sentinelWrap(
        [
          "WT1=A|DATA|19|5|2026-11-19T10:00:00|Class | copy",
          "WT2=V|VIEW|.|15|2026-11-19T10:00:01|",
        ].join("\n"),
      ),
    );
    expect(tables).to.deep.equal([
      {
        name: "A",
        memtype: "DATA",
        rows: 19,
        columns: 5,
        modified: "2026-11-19T10:00:00",
        label: "Class | copy",
      },
      {
        name: "V",
        memtype: "VIEW",
        rows: undefined,
        columns: 15,
        modified: "2026-11-19T10:00:01",
        label: undefined,
      },
    ]);
  });

  it("ignores lines outside the sentinels", () => {
    const out = "MN1=GLOBAL|X|1\nMX1=|1\n" + sentinelWrap("");
    expect(parseSessionSnapshot(out)).to.deep.equal({ macros: [], tables: [] });
  });
});

describe("isInternalMacroName", () => {
  it("matches helper names only", () => {
    for (const name of ["_SAS_N", "_sas_lib1", "_DR12", "_DRN", "_NC0", "_S1_2", "_HB0B3", "_FTV1_2"]) {
      expect(isInternalMacroName(name), name).to.equal(true);
    }
    for (const name of ["SYSERR", "MYVAR", "_SASPROGRAMFILE", "_DATA", "POSIT_USER"]) {
      expect(isInternalMacroName(name), name).to.equal(false);
    }
  });
});

// ─── Macro expressions ───────────────────────────────────────────────────────

describe("checkMacroExpression", () => {
  it("accepts ordinary expressions", () => {
    expect(checkMacroExpression("%eval(1+2)")).to.equal(undefined);
    expect(checkMacroExpression("%sysfunc(today(), date9.)")).to.equal(undefined);
    expect(checkMacroExpression("&sysdate9 'it''s' \"(\"")).to.equal(undefined);
  });

  it("rejects what would break the hidden %LET", () => {
    expect(checkMacroExpression("  ")).to.match(/Enter/);
    expect(checkMacroExpression("1; %put x")).to.match(/semicolon/);
    expect(checkMacroExpression("a\nb")).to.match(/line break/);
    expect(checkMacroExpression("'open")).to.match(/quote/);
    expect(checkMacroExpression("%eval((1)")).to.match(/opening/);
    expect(checkMacroExpression("%eval(1))")).to.match(/closing/);
    expect(checkMacroExpression("a /* b")).to.match(/comment/);
  });
});

describe("parseMacroExpression", () => {
  it("joins chunks and collects warnings and errors", () => {
    const out = [
      "WARNING: Apparent symbolic reference X not resolved.",
      "~~SAS_START~~",
      "EVLEN=203",
      `EV=|${"a".repeat(199)}`,
      "EV=|bc",
      "~~SAS_END~~",
      "ERROR: something",
    ].join("\n");
    const result = parseMacroExpression(out);
    expect(result.value).to.equal(`${"a".repeat(199)} bc`.padEnd(203, " "));
    expect(result.messages).to.deep.equal([
      "WARNING: Apparent symbolic reference X not resolved.",
      "ERROR: something",
    ]);
  });

  it("returns an empty value", () => {
    expect(parseMacroExpression(sentinelWrap("EVLEN=0")).value).to.equal("");
  });
});

describe("SasClient macro helpers", () => {
  it("runs the snapshot code inside a temporary macro", async () => {
    const execute = sinon.stub().resolves(sentinelWrap("MN1=GLOBAL|X|1\nMX1=|1"));
    const snapshot = await new SasClient(execute).getSessionSnapshot();
    expect(snapshot.macros).to.deep.equal([{ scope: "GLOBAL", name: "X", value: "1" }]);
    const code: string = execute.firstCall.args[0];
    expect(code).to.include("%macro _sas_vars;");
    expect(code).to.include("sashelp.vmacro");
    expect(code).to.include("%sysmacdelete _sas_vars");
  });

  it("refuses unsafe expressions without running code", async () => {
    const execute = sinon.stub().resolves("");
    await new SasClient(execute)
      .evaluateMacroExpression("'oops")
      .then(
        () => expect.fail("should reject"),
        (e: Error) => expect(e.message).to.match(/quote/),
      );
    expect(execute.called).to.equal(false);
  });

  it("deletes only valid names", async () => {
    const execute = sinon.stub().resolves("");
    const client = new SasClient(execute);
    await client.deleteMacroVariables(["A", "bad name", "B"]);
    expect(execute.firstCall.args[0]).to.equal("%symdel A B / nowarn;");
    await client.deleteWorkTables(["T1"]);
    expect(execute.secondCall.args[0]).to.include("delete T1;");
  });
});

// ─── SasVariables comm ───────────────────────────────────────────────────────

const SNAPSHOT: SessionSnapshot = {
  macros: [
    { scope: "GLOBAL", name: "B", value: "hello" },
    { scope: "GLOBAL", name: "A", value: "42" },
    { scope: "AUTOMATIC", name: "SYSERR", value: "0" },
    { scope: "AUTOMATIC", name: "SYSCC", value: "0" },
  ],
  tables: [
    { name: "CLASS", memtype: "DATA", rows: 19, columns: 5, label: "Students" },
    { name: "V", memtype: "VIEW", columns: 15 },
  ],
};

function makeVariables(snapshots: SessionSnapshot[] = [SNAPSHOT]) {
  let i = 0;
  const backend = {
    snapshot: sinon.stub().callsFake(async () => snapshots[Math.min(i++, snapshots.length - 1)]),
    getColumns: sinon.stub().resolves([
      { name: "NAME", type: "char", length: 8, label: "Name" },
      { name: "AGE", type: "num", length: 8 },
    ]),
    deleteMacroVariables: sinon.stub().resolves(),
    deleteWorkTables: sinon.stub().resolves(),
    openDataExplorer: sinon.stub().returns("explorer-1"),
  } satisfies SasVariablesBackend;
  let time = 1000;
  const variables = new SasVariables("vars-1", backend, () => time);
  const replies: Array<{ messageId: string; data: Record<string, unknown> }> = [];
  const events: Array<Record<string, unknown>> = [];
  variables.onDidEmitData((d) => replies.push({ messageId: d.messageId, data: Object.fromEntries(Object.entries(d.data)) }));
  variables.onDidEmitEvent((e) => events.push(Object.fromEntries(Object.entries(e))));
  const request = async (method: string, params: Record<string, unknown> = {}) => {
    const id = `m${replies.length}-${method}`;
    variables.sendMessage(id, { method, params });
    for (let n = 0; n < 50 && !replies.some((r) => r.messageId === id); n++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const reply = replies.find((r) => r.messageId === id);
    if (!reply) {
      throw new Error(`no reply to ${method}`);
    }
    return reply.data;
  };
  return { variables, backend, request, events, setTime: (t: number) => (time = t) };
}

// Results are plain JSON objects; read them through JSON to avoid type assertions.
function json<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value));
}

interface ListResult {
  variables: Array<{ access_key: string; display_value: string; kind: string; has_children: boolean; has_viewer: boolean; updated_time: number }>;
  length: number;
}

describe("SasVariables", () => {
  it("lists GLOBAL macro variables, the AUTOMATIC group and WORK tables", async () => {
    const { request } = makeVariables();
    const result = json<ListResult>((await request("list")).result);
    expect(result.variables.map((v) => v.access_key)).to.deep.equal([
      "A",
      "B",
      AUTOMATIC_KEY,
      "WORK.CLASS",
      "WORK.V",
    ]);
    const byKey = new Map(result.variables.map((v) => [v.access_key, v]));
    expect(byKey.get("A")?.kind).to.equal("number");
    expect(byKey.get("B")?.kind).to.equal("string");
    expect(byKey.get(AUTOMATIC_KEY)?.has_children).to.equal(true);
    expect(byKey.get("WORK.CLASS")?.display_value).to.equal("[19 obs x 5 vars] Students");
    expect(byKey.get("WORK.CLASS")?.has_viewer).to.equal(true);
    expect(byKey.get("WORK.V")?.display_value).to.equal("[view, 15 vars]");
  });

  it("inspects the AUTOMATIC group and a table's columns", async () => {
    const { request, backend } = makeVariables();
    await request("list");
    const auto = json<{ children: Array<{ access_key: string }> }>(
      (await request("inspect", { path: [AUTOMATIC_KEY] })).result,
    );
    expect(auto.children.map((c) => c.access_key)).to.deep.equal(["SYSCC", "SYSERR"]);
    const cols = json<{ children: Array<{ access_key: string; display_type: string }> }>(
      (await request("inspect", { path: ["WORK.CLASS"] })).result,
    );
    expect(cols.children.map((c) => `${c.access_key}:${c.display_type}`)).to.deep.equal([
      "NAME:char(8)",
      "AGE:num(8)",
    ]);
    expect(backend.getColumns.calledWith("WORK", "CLASS")).to.equal(true);
  });

  it("copies macro variables as %let statements", async () => {
    const { request } = makeVariables();
    await request("list");
    expect((await request("clipboard_format", { path: ["B"], format: "text/plain" })).result)
      .to.deep.equal({ content: "%let B=hello;" });
    expect((await request("clipboard_format", { path: [AUTOMATIC_KEY, "SYSERR"] })).result)
      .to.deep.equal({ content: "%let SYSERR=0;" });
    expect((await request("clipboard_format", { path: ["WORK.CLASS"] })).result)
      .to.deep.equal({ content: "WORK.CLASS" });
  });

  it("quotes leading and trailing blanks in %let", () => {
    expect(letStatement({ scope: "GLOBAL", name: "X", value: "  a " })).to.equal("%let X=%str(  a );");
  });

  it("opens WORK tables in the Data Explorer", async () => {
    const { request, backend } = makeVariables();
    await request("list");
    expect((await request("view", { path: ["WORK.CLASS"] })).result).to.equal("explorer-1");
    expect(backend.openDataExplorer.calledWith("WORK", "CLASS")).to.equal(true);
    expect((await request("view", { path: ["A"] })).error).to.not.equal(undefined);
  });

  it("deletes macro variables and tables, then sends an update", async () => {
    const after: SessionSnapshot = {
      macros: SNAPSHOT.macros.filter((m) => m.name !== "A"),
      tables: SNAPSHOT.tables.filter((t) => t.name !== "V"),
    };
    const { request, backend, events } = makeVariables([SNAPSHOT, after]);
    await request("list");
    const removed = (await request("delete", { names: ["A", "WORK.V", "NOPE"] })).result;
    expect(removed).to.deep.equal(["A", "WORK.V"]);
    expect(backend.deleteMacroVariables.calledWith(["A"])).to.equal(true);
    expect(backend.deleteWorkTables.calledWith(["V"])).to.equal(true);
    const update = json<{ method: string; params: { removed: string[] } }>(events[0]);
    expect(update.method).to.equal("update");
    expect(update.params.removed).to.have.members(["A", "WORK.V"]);
  });

  it("clear keeps the session identity variables", async () => {
    const withIdentity: SessionSnapshot = {
      ...SNAPSHOT,
      macros: [...SNAPSHOT.macros, { scope: "GLOBAL", name: "POSIT_USER", value: "me" }],
    };
    const { request, backend } = makeVariables([withIdentity]);
    await request("list");
    await request("clear", { include_hidden_objects: false });
    expect(backend.deleteMacroVariables.firstCall.args[0]).to.have.members(["A", "B"]);
    expect(backend.deleteWorkTables.firstCall.args[0]).to.have.members(["CLASS", "V"]);
  });

  it("reload sends the whole list, even when nothing changed", async () => {
    const { request, variables, events } = makeVariables();
    await request("list");
    await variables.reload();
    expect(events).to.have.length(1);
    const refresh = json<{ method: string; params: ListResult }>(events[0]);
    expect(refresh.method).to.equal("refresh");
    expect(refresh.params.length).to.equal(refresh.params.variables.length);
    expect(refresh.params.variables.map((v) => v.access_key)).to.include("A");
  });

  it("sends only what changed after a run, with a new updated_time", async () => {
    const next: SessionSnapshot = {
      macros: [
        { scope: "GLOBAL", name: "A", value: "42" },
        { scope: "GLOBAL", name: "B", value: "changed" },
        { scope: "GLOBAL", name: "C", value: "new" },
        ...SNAPSHOT.macros.filter((m) => m.scope === "AUTOMATIC"),
      ],
      tables: SNAPSHOT.tables,
    };
    const { request, variables, events, setTime } = makeVariables([SNAPSHOT, next, next]);
    await request("list");
    setTime(2000);
    await variables.refresh();
    expect(events).to.have.length(1);
    const update = json<{ params: { assigned: Array<{ access_key: string; updated_time: number }>; removed: string[] } }>(events[0]);
    expect(update.params.assigned.map((v) => v.access_key)).to.deep.equal(["B", "C"]);
    expect(update.params.assigned.every((v) => v.updated_time === 2000)).to.equal(true);
    expect(update.params.removed).to.deep.equal([]);
    // Nothing changed: no event.
    await variables.refresh();
    expect(events).to.have.length(1);
  });

  it("summarises tables for the assistant", async () => {
    const { request } = makeVariables();
    await request("list");
    const summary = json<{ num_rows: number; num_columns: number; column_schemas: string[] }>(
      (await request("query_table_summary", { path: ["WORK.CLASS"], query_types: [] })).result,
    );
    expect(summary.num_rows).to.equal(19);
    expect(summary.num_columns).to.equal(2);
    expect(JSON.parse(summary.column_schemas[0]).column_name).to.equal("NAME");
  });

  it("answers unknown methods with an error", async () => {
    const { request } = makeVariables();
    const reply = json<{ error: { code: number } }>(await request("frobnicate"));
    expect(reply.error.code).to.equal(-32601);
  });
});
