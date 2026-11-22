// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Positron API integration tests: SAS commands for external coding agents
// (#156). Positron's MCP server offers agents the commands that
// getAgentAllowedCommands() lists and runs them with
// validateAndExecuteCommand(), so these tests go through the same two calls.
// No SAS session is needed.
import { extensions } from "vscode";

import * as assert from "assert";

import { getPositronApi } from "../../src/positron";

const EXTENSION_ID = "posit.positron-sas";

describe("SAS commands for coding agents", () => {
  before(async function () {
    this.timeout(120000);
    const extension = extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be present`);
    await extension.activate();
  });

  function agentApi() {
    const ai = getPositronApi()?.ai;
    const list = ai?.getAgentAllowedCommands;
    const run = ai?.validateAndExecuteCommand;
    return list && run && ai ? { ai, list, run } : undefined;
  }

  it("lists both commands in the agent catalog", async function () {
    const api = agentApi();
    if (!api) {
      this.skip(); // Positron before 2026.11 has no agent commands.
    }
    const catalog = await api.list.call(api.ai, { includeDisabled: true });
    const ids = catalog.map((c) => c.id);
    assert.ok(ids.includes("SAS.agent.runCode"), ids.join(", "));
    const listSessions = catalog.find((c) => c.id === "SAS.agent.listSessions");
    assert.ok(listSessions, ids.join(", "));
    assert.strictEqual(listSessions.readOnly, true);
  });

  it("reports no SAS console", async function () {
    const api = agentApi();
    if (!api) {
      this.skip();
    }
    const sessions = await api.run.call(api.ai, "SAS.agent.listSessions", []);
    assert.deepStrictEqual(sessions, { ok: true, result: [] });

    const run = await api.run.call(api.ai, "SAS.agent.runCode", [
      "%put hello;",
    ]);
    assert.strictEqual(run.ok, false);
    assert.match(
      run.ok ? "" : (run.message ?? ""),
      /No SAS console is running/,
    );
  });
});
