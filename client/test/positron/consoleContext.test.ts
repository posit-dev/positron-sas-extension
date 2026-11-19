// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The SAS Viya compute context of a SAS console, and how it is shown.
import { expect } from "chai";

import {
  DEFAULT_CONTEXT,
  consoleBanner,
  consoleSessionName,
  effectiveContext,
  shortContextName,
  withContext,
} from "../../src/positron/consoleContext";

describe("console compute context", () => {
  it("is the profile's context, or the default, for SAS Viya", () => {
    expect(
      effectiveContext({
        connectionType: "rest",
        context: "SAS Studio compute context",
      }),
    ).to.equal("SAS Studio compute context");
    expect(effectiveContext({ connectionType: "rest" })).to.equal(
      DEFAULT_CONTEXT,
    );
    expect(
      effectiveContext({ connectionType: "rest", context: "  " }),
    ).to.equal(DEFAULT_CONTEXT);
  });

  it("is none for direct connections and other connection types", () => {
    // A serverId connects to a running server and bypasses contexts.
    expect(
      effectiveContext({ connectionType: "rest", serverId: "srv-1" }),
    ).to.equal(undefined);
    for (const connectionType of ["ssh", "stdio", "com", "iom"]) {
      expect(effectiveContext({ connectionType }), connectionType).to.equal(
        undefined,
      );
    }
    expect(effectiveContext(undefined)).to.equal(undefined);
  });

  it("shortens a context name for the console tab", () => {
    expect(shortContextName("SAS Studio compute context")).to.equal(
      "SAS Studio",
    );
    expect(shortContextName("SAS Job Execution Compute Context")).to.equal(
      "SAS Job Execution",
    );
    expect(shortContextName("Data Mining")).to.equal("Data Mining");
    // Nothing would be left: keep the full name.
    expect(shortContextName("compute context")).to.equal("compute context");
  });

  it("names the console after the profile and the short context", () => {
    expect(consoleSessionName("Viya", "SAS Studio compute context")).to.equal(
      "Viya · SAS Studio",
    );
    expect(consoleSessionName("Local SAS")).to.equal("Local SAS");
  });

  it("prints the full context when the console starts", () => {
    expect(consoleBanner("Viya", "SAS Studio compute context")).to.equal(
      'SAS Session (Viya), compute context "SAS Studio compute context"',
    );
    expect(consoleBanner("Local SAS")).to.equal("SAS Session (Local SAS)");
  });

  it("saves a new context in the profile, leaving the default out", () => {
    const profile = {
      connectionType: "rest",
      endpoint: "https://viya.example.com",
      context: "SAS Studio compute context",
    };
    expect(withContext(profile, "Data Mining compute context")).to.deep.equal({
      ...profile,
      context: "Data Mining compute context",
    });
    expect(withContext(profile, DEFAULT_CONTEXT)).to.deep.equal({
      connectionType: "rest",
      endpoint: "https://viya.example.com",
    });
    // The profile it was given is left as it was.
    expect(profile.context).to.equal("SAS Studio compute context");
  });
});
