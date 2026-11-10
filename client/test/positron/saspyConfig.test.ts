// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { Profile } from "../../src/components/profile";
import {
  SASPY_CONFIG_FILE,
  SASPY_INTEGRATION_ENV,
  SASPY_TOKEN_ENV,
  profileToSaspyConfig,
  saspyConfigName,
  writeSaspyConfig,
} from "../../src/positron/saspyConfig";
import {
  jwtExpiry,
  viyaTokenFilePath,
  writeViyaTokenFile,
} from "../../src/positron/saspyToken";

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
    expect(config).to.include("'url': _VIYA_URL,");
    expect(config).to.include("'context': 'SAS Studio compute context',");
    // The token is looked up for every SASsession, from outside the file.
    expect(config).to.include("def __getattr__(name):");
    expect(config).to.include("if name == 'viya':");
    expect(config).to.include("'authtoken': _viya_token(),");
    expect(config).to.include(`_os.environ.get('${SASPY_TOKEN_ENV}')`);
    expect(config).to.include("'viya-token.json'");
    expect(config).to.include("_VIYA_URL = 'https://viya.example.com'");
    // No IOM keys, and no secrets from the profile.
    expect(config).not.to.match(/iomhost|iomport|'java'/);
    expect(config).not.to.include("s3cr3t");
    expect(config).not.to.include("client_secret'");
  });

  it("passes the Workbench integration of the profile to the token lookup", () => {
    const config = profileToSaspyConfig(
      "viya",
      asProfile({
        connectionType: "rest",
        endpoint: "https://viya.example.com",
        workbenchIntegration: "abc-123",
      }),
    );
    expect(config).to.include(
      `_os.environ.get('${SASPY_INTEGRATION_ENV}') or 'abc-123'`,
    );
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

describe("writeSaspyConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "saspy-config-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes sascfg_personal.py with a trailing newline", () => {
    const result = writeSaspyConfig(dir, "SAS_config_names = ['a']");
    expect(result.status).to.equal("written");
    expect(result.path).to.equal(path.join(dir, SASPY_CONFIG_FILE));
    expect(fs.readFileSync(result.path, "utf8")).to.equal(
      "SAS_config_names = ['a']\n",
    );
  });

  it("reports an identical existing file as unchanged", () => {
    writeSaspyConfig(dir, "x = 1");
    expect(writeSaspyConfig(dir, "x = 1").status).to.equal("unchanged");
  });

  it("does not replace a different file unless asked to", () => {
    writeSaspyConfig(dir, "x = 1");
    const result = writeSaspyConfig(dir, "x = 2");
    expect(result.status).to.equal("exists");
    expect(fs.readFileSync(result.path, "utf8")).to.equal("x = 1\n");

    expect(writeSaspyConfig(dir, "x = 2", true).status).to.equal("written");
    expect(fs.readFileSync(result.path, "utf8")).to.equal("x = 2\n");
  });
});

describe("saspy token file", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "saspy-token-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const jwt = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("lives in a private folder in the home directory", () => {
    expect(viyaTokenFilePath(home)).to.equal(
      path.join(home, ".positron-sas", "viya-token.json"),
    );
  });

  it("reads the expiry of a JWT and tolerates other tokens", () => {
    expect(jwtExpiry(jwt({ exp: 1900000000 }))).to.equal(1900000000);
    expect(jwtExpiry(jwt({ sub: "x" }))).to.equal(undefined);
    expect(jwtExpiry("opaque-token")).to.equal(undefined);
    expect(jwtExpiry("a.not-base64-json.c")).to.equal(undefined);
  });

  it("writes the endpoint, token and expiry for the saspy config", () => {
    const file = viyaTokenFilePath(home);
    const token = jwt({ exp: 1900000000 });
    writeViyaTokenFile(file, "https://viya.example.com/", token);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).to.deep.equal({
      endpoint: "https://viya.example.com",
      access_token: token,
      expires_at: 1900000000,
    });
  });

  it("leaves out the expiry when it is unknown", () => {
    const file = viyaTokenFilePath(home);
    writeViyaTokenFile(file, "https://viya.example.com", "opaque");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).to.not.have.property(
      "expires_at",
    );
  });

  it("makes the file and its folder private and replaces an old token", function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const file = viyaTokenFilePath(home);
    writeViyaTokenFile(file, "https://viya.example.com", "first");
    writeViyaTokenFile(file, "https://viya.example.com", "second");
    expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).to.equal(0o700);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).access_token).to.equal(
      "second",
    );
    expect(fs.readdirSync(path.dirname(file))).to.deep.equal([
      "viya-token.json",
    ]);
  });
});
