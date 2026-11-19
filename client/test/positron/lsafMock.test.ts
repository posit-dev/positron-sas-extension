// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF client and models over real HTTP (axios) against the local mock
// server, to catch header, multipart and encoding mistakes that request
// recorders can't. The mock follows the OpenAPI document; a real server may
// still differ.
import { expect } from "chai";

import { LsafClient } from "../../src/lsaf/LsafClient";
import { axiosTransport } from "../../src/lsaf/transport";
import { LsafMockServer } from "../lsaf-mock/server";

describe("LSAF client against the mock server", function () {
  this.timeout(10_000);
  let mock: LsafMockServer;
  let apiUrl: string;

  beforeEach(async () => {
    mock = new LsafMockServer({ jobDurationMs: 50 });
    apiUrl = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  const signedIn = async () => {
    const client = new LsafClient(apiUrl, axiosTransport(apiUrl));
    const secret = await client.encrypt("demo", "demo");
    client.setCredentials({ userId: "demo", secret });
    await client.logon();
    return client;
  };

  it("encrypts, logs on with the encrypted password and logs off", async () => {
    const client = await signedIn();
    expect(client.signedIn).to.equal(true);
    const logon = mock.requests.find((r) => r.path.endsWith("/logon"));
    const basic = Buffer.from(
      String(logon?.headers.authorization).slice(6),
      "base64",
    ).toString("utf8");
    expect(basic).to.match(/^demo:\{P21\}/);
    await client.logoff();
    expect(mock.tokens.size).to.equal(0);
  });

  it("rejects a wrong password", async () => {
    const client = new LsafClient(apiUrl, axiosTransport(apiUrl));
    try {
      await client.encrypt("demo", "wrong");
      expect.fail("should throw");
    } catch (error) {
      expect(String(error)).to.match(/Invalid credentials/);
    }
  });

  it("renews an expired session transparently", async () => {
    const client = await signedIn();
    mock.expireSessions();
    const children = await client.getJson<{ items: unknown[] }>(
      "/repository/containers",
      { component: "children" },
    );
    expect(children.items).to.have.length(1);
    expect(
      mock.requests.filter((r) => r.path.endsWith("/logon")),
    ).to.have.length(2);
  });
});
