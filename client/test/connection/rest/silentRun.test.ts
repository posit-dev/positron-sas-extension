// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import { Config, createSession } from "../../../src/connection/rest";

/** A REST session whose compute session runs jobs with a log line and no results. */
function fakeSession() {
  const results = sinon.stub().resolves([]);
  const job = {
    getLogStream: async function* () {
      yield [{ type: "normal", line: "done" }];
    },
    results,
  };
  const execute = sinon.stub().resolves(job);
  const config: Config = { endpoint: "https://viya.example.com" };
  const session = createSession(config);
  Object.assign(session, { _computeSession: { sessionId: "s1", execute } });
  const lines: string[] = [];
  session.onExecutionLogFn = (logs) => lines.push(...logs.map((l) => l.line));
  return { session, execute, results, lines };
}

describe("REST session silent runs", () => {
  it("skips the ODS results request for silent runs", async () => {
    const { session, execute, results, lines } = fakeSession();
    const result = await session.run("%put hi;", { silent: true });
    expect(execute.callCount).to.equal(1);
    expect(lines).to.deep.equal(["done"]);
    expect(results.callCount).to.equal(0);
    expect(result).to.deep.equal({ html5: "", title: "" });
  });

  it("still fetches results for normal runs", async () => {
    const { session, results } = fakeSession();
    await session.run("proc print data=sashelp.class; run;");
    expect(results.callCount).to.equal(1);
  });
});
