// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import {
  ActionCancelledError,
  ActionTimeoutError,
  getActionToken,
  pollActionStatus,
} from "../../src/clinical/actionStatus";

const running = { data: { summary: {} } };
const done = (completionStatus: string) => ({
  data: {
    summary: { endTimeStamp: "2026-10-26T12:00:00Z", completionStatus },
    details: [{ itemName: "adsl.sas", message: "ok" }],
  },
});
const noSleep = () => Promise.resolve();

describe("getActionToken", () => {
  it("takes the last path segment of the Location header", () => {
    expect(
      getActionToken("/clinicalActionStatus/actionstatus/abc-123"),
    ).to.equal("abc-123");
    expect(getActionToken("/x/abc/")).to.equal("abc");
    expect(getActionToken(undefined)).to.be.undefined;
    expect(getActionToken("")).to.be.undefined;
  });
});

describe("pollActionStatus", () => {
  it("polls until the action has ended and returns its status", async () => {
    const get = sinon.stub();
    get.onCall(0).resolves(running);
    get.onCall(1).resolves(running);
    get.onCall(2).resolves(done("WARN"));
    const status = await pollActionStatus(get, "tok", { sleep: noSleep });
    expect(status.summary.completionStatus).to.equal("WARN");
    expect(get.callCount).to.equal(3);
    expect(get.firstCall.args[0]).to.equal(
      "/clinicalActionStatus/actionstatus/tok",
    );
    expect(get.firstCall.args[1].headers.Accept).to.equal(
      "application/vnd.sas.clinical.action.status+json",
    );
  });

  it("returns ERROR statuses to the caller instead of throwing", async () => {
    const get = sinon.stub().resolves(done("ERROR"));
    const status = await pollActionStatus(get, "tok", { sleep: noSleep });
    expect(status.summary.completionStatus).to.equal("ERROR");
  });

  it("times out", async () => {
    const get = sinon.stub().resolves(running);
    let error: unknown;
    try {
      await pollActionStatus(get, "tok", {
        sleep: noSleep,
        intervalMs: 10,
        timeoutMs: 30,
      });
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(ActionTimeoutError);
    expect(get.callCount).to.equal(4);
  });

  it("stops when cancelled", async () => {
    const get = sinon.stub().resolves(running);
    let error: unknown;
    try {
      await pollActionStatus(get, "tok", {
        sleep: noSleep,
        isCancelled: () => get.callCount >= 2,
      });
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(ActionCancelledError);
  });

  it("propagates HTTP errors", async () => {
    const get = sinon.stub().rejects(new Error("503"));
    let error: unknown;
    try {
      await pollActionStatus(get, "tok", { sleep: noSleep });
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(Error).with.property("message", "503");
  });
});
