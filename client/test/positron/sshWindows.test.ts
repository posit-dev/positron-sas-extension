// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import type { Profile } from "../../src/components/profile";
import { getScript } from "../../src/connection/itc/script";
import {
  isWindowsSSHProfile,
  toWindowsSasOptions,
  viewConnectionType,
} from "../../src/connection/ssh/platform";
import { profileToSaspyConfig } from "../../src/positron/saspyConfig";

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const asProfile = (p: object) => p as Profile;

const ssh = (fields: object) =>
  asProfile({
    connectionType: "ssh",
    host: "sasserver",
    username: "user",
    port: 22,
    ...fields,
  });

describe("SAS on Windows over SSH: platform", () => {
  it("detects Windows from a Windows saspath", () => {
    for (const saspath of [
      "D:\\PROGRA~1\\SAS\\SASFOU~1\\9.4\\sas.exe",
      "C:/Program Files/SASHome/SASFoundation/9.4/sas.exe",
      "sas.exe",
      "SASFoundation\\9.4\\sas",
    ]) {
      expect(isWindowsSSHProfile(ssh({ saspath })), saspath).to.be.true;
    }
  });

  it("keeps a UNIX saspath on the SSH session", () => {
    for (const saspath of ["/opt/sas/SASFoundation/9.4/sas", "sas", ""]) {
      expect(isWindowsSSHProfile(ssh({ saspath })), saspath).to.be.false;
    }
  });

  it("lets platform override the saspath", () => {
    expect(isWindowsSSHProfile(ssh({ platform: "windows" }))).to.be.true;
    expect(
      isWindowsSSHProfile(ssh({ platform: "unix", saspath: "D:\\sas.exe" })),
    ).to.be.false;
  });

  it("only applies to SSH profiles", () => {
    expect(
      isWindowsSSHProfile(
        asProfile({ connectionType: "stdio", saspath: "C:\\sas.exe" }),
      ),
    ).to.be.false;
    expect(isWindowsSSHProfile(undefined)).to.be.false;
  });

  it("gives Windows SSH profiles the COM views", () => {
    expect(viewConnectionType(ssh({ saspath: "D:\\sas.exe" }))).to.equal("com");
    expect(viewConnectionType(ssh({ saspath: "/opt/sas" }))).to.equal("ssh");
    expect(viewConnectionType(asProfile({ connectionType: "rest" }))).to.equal(
      "rest",
    );
    expect(viewConnectionType(undefined)).to.be.undefined;
  });
});

describe("SAS on Windows over SSH: SAS options", () => {
  it("drops startup-only options", () => {
    expect(
      toWindowsSasOptions(["-nosplash", "-noicon", "-nonews", "-memsize 4G"]),
    ).to.deep.equal({
      options: [],
      dropped: ["-nosplash", "-noicon", "-nonews", "-memsize 4G"],
    });
  });

  it("keeps options SAS can set while it runs", () => {
    expect(
      toWindowsSasOptions(["-nonotes", "-linesize=120", "-pagesize 60"]),
    ).to.deep.equal({
      options: ["nonotes", "linesize=120", "pagesize 60"],
      dropped: [],
    });
  });

  it("joins a value given as its own item", () => {
    expect(
      toWindowsSasOptions([
        "-linesize",
        "max",
        "-nosplash",
        "-encoding",
        "utf-8",
      ]),
    ).to.deep.equal({
      options: ["linesize=max"],
      dropped: ["-nosplash", "-encoding=utf-8"],
    });
  });

  it("handles no options", () => {
    expect(toWindowsSasOptions(undefined)).to.deep.equal({
      options: [],
      dropped: [],
    });
  });
});

describe("SAS on Windows over SSH: remote script", () => {
  it("runs from the extension folder locally", () => {
    const script = getScript({ interopLibraryFolderPath: "" });
    expect(script).to.include("Set-Location -Path");
    expect(script).to.include('Get-Content -Path "$PWD\\\\env.json"');
    expect(script).not.to.include("FetchResultsFileBase64");
  });

  it("inlines env.json and adds the remote helpers on a server", () => {
    const script = getScript({
      interopLibraryFolderPath: "D:\\ITC",
      remote: true,
    });
    expect(script).not.to.include("Set-Location");
    expect(script).not.to.include("env.json");
    expect(script).to.include('$global:interopLibraryFolderPath="D:\\ITC"');
    expect(script).to.include("--vscode-sas-extension-results-fetched--");
    expect(script).to.include("class SASRunner");
    expect(script).to.include("function FetchResultsFileBase64");
    expect(script).to.include("function FetchFileContentBase64");
    // env.json is set before itc.ps1 runs.
    expect(script.indexOf("ConvertFrom-Json")).to.be.lessThan(
      script.indexOf("class SASRunner"),
    );
  });
});

describe("SAS on Windows over SSH: saspy export", () => {
  it("exports a Windows SSH profile as IOM, since saspy's SSH needs Linux", () => {
    const config = profileToSaspyConfig(
      "win",
      ssh({ saspath: "D:\\SAS\\sas.exe", iomPort: 8592 }),
    );
    expect(config).to.include("'iomhost': 'sasserver',");
    expect(config).to.include("'iomport': 8592,");
    expect(config).not.to.include("'ssh':");
  });

  it("still exports a UNIX SSH profile as SSH", () => {
    const config = profileToSaspyConfig(
      "unix",
      ssh({ saspath: "/opt/sas/sas" }),
    );
    expect(config).to.include("'ssh': '/usr/bin/ssh',");
  });
});
