// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  clipForAgent,
  clipRunReply,
  errorText,
  jsonBytes,
} from "../../src/positron/agentReply";

const longLog = (n: number) =>
  Array.from({ length: n }, (_, k) => `NOTE: line ${k}`).join("\n");

describe("agent reply clipping", () => {
  it("leaves short text alone", () => {
    expect(clipForAgent("NOTE: ok\nERROR: bad", 1000)).to.deep.equal({
      text: "NOTE: ok\nERROR: bad",
      clipped: false,
    });
  });

  it("keeps both ends of a long log within the budget", () => {
    const { text, clipped } = clipForAgent(longLog(5000), 2000);
    expect(clipped).to.equal(true);
    expect(jsonBytes(text)).to.be.at.most(2000);
    expect(text.startsWith("NOTE: line 0\n")).to.equal(true);
    expect(text.endsWith("NOTE: line 4999")).to.equal(true);
    expect(text).to.match(/\[\.\.\. \d+ lines clipped \.\.\.\]/);
  });

  it("counts multibyte characters and JSON escapes as bytes", () => {
    const text = Array.from({ length: 400 }, () => 'Größe "ä"').join("\n");
    const out = clipForAgent(text, 1000);
    expect(out.clipped).to.equal(true);
    expect(jsonBytes(out.text)).to.be.at.most(1000);
  });

  it("fits log and report together", () => {
    const out = clipRunReply(longLog(5000), longLog(5000), 4000);
    expect(out.clipped).to.equal(true);
    expect(jsonBytes(out.log) + jsonBytes(out.result)).to.be.at.most(4000);
  });

  it("gives a short log's room to the report", () => {
    const out = clipRunReply("NOTE: ok", longLog(300), 8000);
    expect(out.log).to.equal("NOTE: ok");
    expect(jsonBytes(out.result)).to.be.greaterThan(4000);
  });

  it("reads the message of a runtime error object", () => {
    const runtimeError = {
      name: "SAS Error",
      message: "ERROR 180-322: Statement is not valid.",
      traceback: [],
    };
    expect(errorText(runtimeError)).to.equal(
      "ERROR 180-322: Statement is not valid.",
    );
    expect(errorText(new Error("boom"))).to.equal("boom");
    expect(errorText({ code: 1 })).to.equal('{"code":1}');
    expect(errorText("plain")).to.equal("plain");
  });
});
