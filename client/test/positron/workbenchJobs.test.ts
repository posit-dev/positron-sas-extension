// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  buildSasjobArgs,
  computeSasOption,
  resolveSasJob,
} from "../../src/workbenchJobs/sasjob";

describe("Workbench Jobs: sasjob arguments", () => {
  const viya = {
    connectionType: "rest",
    endpoint: "https://viya.example.com/",
    context: "SAS Studio compute context",
    sasOptions: ["-PAGESIZE=MAX", "-validvarname any"],
  };

  it("passes the profile's server, context and options", () => {
    expect(
      buildSasjobArgs(viya, ["options nonotes;", "%let x = 1;"]),
    ).to.deep.equal([
      "--viya-url",
      "https://viya.example.com",
      "--context",
      "SAS Studio compute context",
      "--sas-option",
      "-PAGESIZE MAX",
      "--sas-option",
      "-validvarname any",
      "--autoexec-line",
      "options nonotes;",
      "--autoexec-line",
      "%let x = 1;",
    ]);
  });

  it("leaves out what the profile doesn't set", () => {
    expect(
      buildSasjobArgs({ connectionType: "rest", endpoint: "https://v" }),
    ).to.deep.equal(["--viya-url", "https://v"]);
  });

  it("names the Workbench OAuth integration the profile uses", () => {
    expect(
      buildSasjobArgs({
        connectionType: "rest",
        endpoint: "https://v",
        workbenchIntegration: " 4c1cfecb-1927-4f19-bc2f-d8ac261364e0 ",
      }),
    ).to.deep.equal([
      "--viya-url",
      "https://v",
      "--integration",
      "4c1cfecb-1927-4f19-bc2f-d8ac261364e0",
    ]);
  });

  it("skips empty options and autoexec lines", () => {
    expect(
      buildSasjobArgs(
        { connectionType: "rest", endpoint: "https://v", sasOptions: [" "] },
        ["", "  ", "run;"],
      ),
    ).to.deep.equal(["--viya-url", "https://v", "--autoexec-line", "run;"]);
  });

  it("turns = into a space in SAS options, as the REST connection does", () => {
    expect(computeSasOption("-SET=NAME=VALUE")).to.equal("-SET NAME VALUE");
  });
});

describe("Workbench Jobs: resolving a SAS program", () => {
  it("runs sasjob with the profile's arguments", () => {
    const resolved = resolveSasJob({
      profile: { connectionType: "rest", endpoint: "https://v" },
      profileName: "viya",
      executable: "sasjob",
      cluster: { name: "Local" },
    });
    expect(resolved).to.deep.equal({
      executable: "sasjob",
      leadingArgs: ["run"],
      defaultArgs: ["--viya-url", "https://v"],
      warnings: [],
    });
  });

  it("falls back to sasjob when the setting is blank", () => {
    expect(resolveSasJob({ executable: "  " }).executable).to.equal("sasjob");
  });

  it("warns without a SAS Viya profile", () => {
    expect(resolveSasJob({ executable: "sasjob" }).warnings).to.have.length(1);
    const ssh = resolveSasJob({
      profile: { connectionType: "ssh" },
      profileName: "server",
      executable: "sasjob",
    });
    expect(ssh.defaultArgs).to.deep.equal([]);
    expect(ssh.warnings[0]).to.contain('"server" does not connect to SAS Viya');
  });

  it("warns when the profile signs in with SAS Logon", () => {
    const resolved = resolveSasJob({
      profile: {
        connectionType: "rest",
        endpoint: "https://v",
        authentication: "sasLogon",
      },
      profileName: "viya",
      executable: "sasjob",
    });
    expect(resolved.warnings[0]).to.contain("signs in with SAS Logon");
  });

  it("reminds to install sasjob on other clusters", () => {
    const resolved = resolveSasJob({
      profile: { connectionType: "rest", endpoint: "https://v" },
      executable: "/opt/sasjob/bin/sasjob",
      cluster: { name: "Kubernetes" },
    });
    expect(resolved.warnings).to.deep.equal([
      'Make sure that "/opt/sasjob/bin/sasjob" is installed where jobs run on the Kubernetes cluster.',
    ]);
  });
});
