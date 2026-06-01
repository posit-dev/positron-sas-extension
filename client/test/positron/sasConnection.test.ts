// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect } from "chai";
import sinon from "sinon";

import { SasConnection } from "../../src/positron/sasConnection";
import type { SasClient } from "../../src/positron/sasClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(overrides: Partial<SasClient> = {}): SasClient {
  return {
    getLibraryList: sinon.stub().resolves(["WORK", "SASHELP"]),
    getLibraryMembers: sinon.stub().resolves([
      { name: "CLASS", type: "DATA" },
      { name: "CARS", type: "VIEW" },
    ]),
    getDatasetColumns: sinon.stub().resolves([
      { name: "NAME", type: "char" },
      { name: "AGE", type: "num" },
    ]),
    getDatasetRowCount: sinon.stub().resolves(0),
    getDatasetRows: sinon.stub().resolves([]),
    getColumnNullCounts: sinon.stub().resolves([]),
    getColumnSummaryStats: sinon.stub().resolves([]),
    clearColumnCache: sinon.stub(),
    ...overrides,
  } as unknown as SasClient;
}

function sendAndWait(
  conn: SasConnection,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ messageId: string; data: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const msgId = `msg-${method}`;
    const sub = conn.onDidEmitData((e) => {
      sub.dispose();
      resolve(e as { messageId: string; data: Record<string, unknown> });
    });
    conn.sendMessage(msgId, { method, params });
  });
}

function makeConnection(
  clientOverrides: Partial<SasClient> = {},
  onPreview?: (lib: string, mem: string) => void,
): { conn: SasConnection; client: SasClient } {
  const client = makeClient(clientOverrides);
  const conn = new SasConnection(
    client,
    "Libraries (test)",
    "testProfile",
    "localhost",
    onPreview ?? sinon.stub(),
  );
  return { conn, client };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SasConnection.list_objects", () => {
  it("returns libraries at root path", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "list_objects", { path: [] });
    expect(data.result).to.deep.equal([
      { name: "WORK", kind: "schema" },
      { name: "SASHELP", kind: "schema" },
    ]);
  });

  it("returns tables inside a library", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "list_objects", {
      path: [{ name: "SASHELP", kind: "schema" }],
    });
    expect(data.result).to.deep.equal([
      { name: "CLASS", kind: "table" },
      { name: "CARS", kind: "view" },
    ]);
  });

  it("returns empty array for unsupported depth", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "list_objects", {
      path: [
        { name: "WORK", kind: "schema" },
        { name: "CLASS", kind: "table" },
        { name: "extra", kind: "table" },
      ],
    });
    expect(data.result).to.deep.equal([]);
  });
});

describe("SasConnection.list_fields", () => {
  it("returns field schemas for a table", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "list_fields", {
      path: [{ name: "WORK", kind: "schema" }, { name: "CLASS", kind: "table" }],
    });
    expect(data.result).to.deep.equal([
      { name: "NAME", dtype: "char" },
      { name: "AGE", dtype: "num" },
    ]);
  });

  it("returns empty array for non-table path", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "list_fields", {
      path: [{ name: "WORK", kind: "schema" }],
    });
    expect(data.result).to.deep.equal([]);
  });
});

describe("SasConnection.contains_data", () => {
  it("returns true for a table", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "contains_data", {
      path: [{ name: "WORK", kind: "schema" }, { name: "CLASS", kind: "table" }],
    });
    expect(data.result).to.equal(true);
  });

  it("returns true for a view", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "contains_data", {
      path: [{ name: "WORK", kind: "schema" }, { name: "V", kind: "view" }],
    });
    expect(data.result).to.equal(true);
  });

  it("returns false for a library", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "contains_data", {
      path: [{ name: "WORK", kind: "schema" }],
    });
    expect(data.result).to.equal(false);
  });
});

describe("SasConnection.get_metadata", () => {
  it("returns connection metadata", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "get_metadata", { comm_id: "x" });
    const meta = data.result as Record<string, unknown>;
    expect(meta.name).to.equal("Libraries (test)");
    expect(meta.language_id).to.equal("sas");
    expect(meta.host).to.equal("localhost");
  });
});

describe("SasConnection.preview_object", () => {
  it("calls onPreviewTable for a table", async () => {
    const onPreview = sinon.stub();
    const { conn } = makeConnection({}, onPreview);
    await sendAndWait(conn, "preview_object", {
      path: [{ name: "WORK", kind: "schema" }, { name: "CLASS", kind: "table" }],
    });
    expect(onPreview.calledOnceWith("WORK", "CLASS")).to.be.true;
  });

  it("does not call onPreviewTable for a library", async () => {
    const onPreview = sinon.stub();
    const { conn } = makeConnection({}, onPreview);
    await sendAndWait(conn, "preview_object", {
      path: [{ name: "WORK", kind: "schema" }],
    });
    expect(onPreview.callCount).to.equal(0);
  });
});

describe("SasConnection error handling", () => {
  it("returns a JSON-RPC error for unknown methods", async () => {
    const { conn } = makeConnection();
    const { data } = await sendAndWait(conn, "nonexistent_method");
    expect(data).to.have.property("error");
    const err = data.error as Record<string, unknown>;
    expect(err.code).to.equal(-32603);
  });

  it("returns a JSON-RPC error when the client throws", async () => {
    const { conn } = makeConnection({
      getLibraryList: sinon.stub().rejects(new Error("connection lost")),
    });
    const { data } = await sendAndWait(conn, "list_objects", { path: [] });
    expect(data).to.have.property("error");
    const err = data.error as Record<string, unknown>;
    expect(String(err.message)).to.include("connection lost");
  });
});
