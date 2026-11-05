// Copyright © 2026, Posit Software, PBC.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import { KeepAlive, httpStatus } from "../../src/connection/rest/keepAlive";

const INTERVAL = 60_000;

describe("httpStatus", () => {
  it("reads the status from an axios-style error", () => {
    expect(httpStatus({ response: { status: 404 } })).to.equal(404);
  });

  it("is 0 when there is no response", () => {
    expect(httpStatus(new Error("network"))).to.equal(0);
    expect(httpStatus(undefined)).to.equal(0);
    expect(httpStatus({ response: {} })).to.equal(0);
  });
});

describe("KeepAlive", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  const make = (
    overrides: Partial<ConstructorParameters<typeof KeepAlive>[0]> = {},
  ) => {
    const ping = sinon.stub().resolves();
    const onGone = sinon.stub();
    const keepAlive = new KeepAlive({
      intervalMs: INTERVAL,
      ping,
      isBusy: () => false,
      onGone,
      now: () => Date.now(),
      ...overrides,
    });
    return { keepAlive, ping, onGone };
  };

  it("pings once per interval while idle", async () => {
    const { keepAlive, ping } = make();
    keepAlive.start();

    await clock.tickAsync(INTERVAL - 1);
    expect(ping.callCount).to.equal(0);
    await clock.tickAsync(1);
    expect(ping.callCount).to.equal(1);
    await clock.tickAsync(INTERVAL * 2);
    expect(ping.callCount).to.equal(3);
    keepAlive.stop();
  });

  it("does not ping while a job is running", async () => {
    let busy = true;
    const { keepAlive, ping } = make({ isBusy: () => busy });
    keepAlive.start();

    await clock.tickAsync(INTERVAL * 3);
    expect(ping.callCount).to.equal(0);

    busy = false;
    await clock.tickAsync(INTERVAL);
    expect(ping.callCount).to.equal(1);
    keepAlive.stop();
  });

  it("stops pinging after stop()", async () => {
    const { keepAlive, ping } = make();
    keepAlive.start();
    await clock.tickAsync(INTERVAL);
    keepAlive.stop();
    await clock.tickAsync(INTERVAL * 5);
    expect(ping.callCount).to.equal(1);
  });

  it("does not reschedule when stopped during a ping", async () => {
    let finish: () => void = () => undefined;
    const ping = sinon
      .stub()
      .callsFake(() => new Promise<void>((resolve) => (finish = resolve)));
    const { keepAlive } = make({ ping });
    keepAlive.start();
    await clock.tickAsync(INTERVAL);
    expect(ping.callCount).to.equal(1);

    keepAlive.stop();
    finish();
    await clock.tickAsync(INTERVAL * 5);
    expect(ping.callCount).to.equal(1);
  });

  it("start() twice does not double the pings", async () => {
    const { keepAlive, ping } = make();
    keepAlive.start();
    keepAlive.start();
    await clock.tickAsync(INTERVAL);
    expect(ping.callCount).to.equal(1);
    keepAlive.stop();
  });

  it("can be restarted after stop()", async () => {
    const { keepAlive, ping } = make();
    keepAlive.start();
    keepAlive.stop();
    keepAlive.start();
    await clock.tickAsync(INTERVAL);
    expect(ping.callCount).to.equal(1);
    keepAlive.stop();
  });

  it("reports the session gone on 404 and stops", async () => {
    const ping = sinon.stub().rejects({ response: { status: 404 } });
    const { keepAlive, onGone } = make({ ping });
    keepAlive.start();

    await clock.tickAsync(INTERVAL);
    expect(onGone.callCount).to.equal(1);
    await clock.tickAsync(INTERVAL * 5);
    expect(ping.callCount).to.equal(1);
    expect(onGone.callCount).to.equal(1);
  });

  it("keeps going after a 401, a 5xx or a network error", async () => {
    const ping = sinon.stub();
    ping.onCall(0).rejects({ response: { status: 401 } });
    ping.onCall(1).rejects({ response: { status: 503 } });
    ping.onCall(2).rejects(new Error("ECONNRESET"));
    ping.resolves();
    const { keepAlive, onGone } = make({ ping });
    keepAlive.start();

    await clock.tickAsync(INTERVAL * 4);
    expect(ping.callCount).to.equal(4);
    expect(onGone.callCount).to.equal(0);
    keepAlive.stop();
  });

  it("stops after the max idle time without activity", async () => {
    const { keepAlive, ping } = make({ maxIdleMs: INTERVAL * 3 + 1 });
    keepAlive.start();

    await clock.tickAsync(INTERVAL * 10);
    // Pings at 1, 2 and 3 intervals; at 4 the idle window is exceeded.
    expect(ping.callCount).to.equal(3);
  });

  it("touch() restarts the max idle window", async () => {
    const { keepAlive, ping } = make({ maxIdleMs: INTERVAL * 2 + 1 });
    keepAlive.start();

    await clock.tickAsync(INTERVAL * 2);
    keepAlive.touch();
    await clock.tickAsync(INTERVAL * 2);
    expect(ping.callCount).to.equal(4);
    keepAlive.stop();
  });

  it("counts a running job as activity for the max idle window", async () => {
    let busy = true;
    const { keepAlive, ping } = make({
      maxIdleMs: INTERVAL * 2 + 1,
      isBusy: () => busy,
    });
    keepAlive.start();

    await clock.tickAsync(INTERVAL * 10);
    busy = false;
    await clock.tickAsync(INTERVAL);
    expect(ping.callCount).to.equal(1);
    keepAlive.stop();
  });

  it("does nothing when the interval is 0", async () => {
    const { keepAlive, ping } = make({ intervalMs: 0 });
    keepAlive.start();
    await clock.tickAsync(INTERVAL * 5);
    expect(ping.callCount).to.equal(0);
  });
});
