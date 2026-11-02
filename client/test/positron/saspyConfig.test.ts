// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import type { Profile } from "../../src/components/profile";
import {
  SASPY_TOKEN_ENV,
  profileToSaspyConfig,
  saspyConfigName,
} from "../../src/positron/saspyConfig";

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const asProfile = (p: object) => p as Profile;

describe("profileToSaspyConfig", () => {
  it("exports a SAS Viya profile as the HTTP access method", () => {
    const config = profileToSaspyConfig(
      "viya",
      asProfile({
        connectionType: "rest",
        endpoint: "https://viya.example.com",
        context: "SAS Studio compute context",
        clientId: "my-client",
        clientSecret: "s3cr3t",
      }),
    );

    expect(config).to.include("SAS_config_names = ['viya']");
    expect(config).to.include("'url': 'https://viya.example.com',");
    expect(config).to.include("'context': 'SAS Studio compute context',");
    expect(config).to.include(
      `'authtoken': os.environ.get('${SASPY_TOKEN_ENV}'),`,
    );
    expect(config).to.include("import os");
    // No IOM keys, and no secrets from the profile.
    expect(config).not.to.match(/iomhost|iomport|'java'/);
    expect(config).not.to.include("s3cr3t");
    expect(config).not.to.include("client_secret'");
  });

  it("uses the default compute context when the profile has none", () => {
    const config = profileToSaspyConfig(
      "viya",
      asProfile({
        connectionType: "rest",
        endpoint: "https://viya.example.com",
      }),
    );
    expect(config).to.include(
      "'context': 'SAS Job Execution compute context',",
    );
  });

  it("exports SSH and stdio profiles with saspath", () => {
    const ssh = profileToSaspyConfig(
      "remote",
      asProfile({
        connectionType: "ssh",
        host: "sas.example.com",
        port: 22,
        username: "me",
        saspath: "/opt/sas/sas",
      }),
    );
    expect(ssh).to.include("'host': 'sas.example.com',");
    expect(ssh).to.include("'saspath': '/opt/sas/sas',");

    const stdio = profileToSaspyConfig(
      "local",
      asProfile({ connectionType: "stdio", saspath: "/opt/sas/sas" }),
    );
    expect(stdio).to.include("local = {");
    expect(stdio).to.include("'saspath': '/opt/sas/sas',");
  });

  it("quotes values for Python", () => {
    const config = profileToSaspyConfig(
      "local",
      asProfile({ connectionType: "stdio", saspath: "/opt/it's/sas" }),
    );
    expect(config).to.include("'saspath': '/opt/it\\'s/sas',");
  });
});

describe("saspyConfigName", () => {
  it("turns a profile name into a Python identifier", () => {
    expect(saspyConfigName("viya")).to.equal("viya");
    expect(saspyConfigName("my-viya prod")).to.equal("my_viya_prod");
    expect(saspyConfigName("2024")).to.equal("sas_2024");
  });
});
