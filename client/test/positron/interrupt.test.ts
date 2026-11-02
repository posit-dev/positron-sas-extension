// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import { interruptNotSupportedMessage } from "../../src/positron/interrupt";

describe("interruptNotSupportedMessage", () => {
  it("names the connection type and says the console stays busy", () => {
    const ssh = interruptNotSupportedMessage("ssh");
    expect(ssh).to.include("SSH");
    expect(ssh).to.include("stays busy");
    expect(ssh).to.include("restart the session");

    expect(interruptNotSupportedMessage("stdio")).to.include("local stdio");
  });

  it("falls back to a generic label for an unknown connection type", () => {
    expect(interruptNotSupportedMessage("")).to.include("on this connection.");
  });
});
