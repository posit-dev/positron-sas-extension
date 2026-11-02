// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import * as http from "http";
import { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";

import {
  WorkbenchIntegration,
  detectWorkbench,
  findIntegration,
  getToken,
  isExpired,
  listIntegrations,
  readRpcCookie,
  redact,
  resolveWorkbenchAuth,
  rpc,
  sasLogonTokenUrl,
} from "../../src/connection/rest/workbenchAuth";

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

type Handler = (req: Recorded) => {
  status?: number;
  contentType?: string;
  body: string | object;
};

/** A fake Workbench session RPC server, on TCP or a unix socket. */
class FakeWorkbench {
  requests: Recorded[] = [];
  handler: Handler = () => ({ body: { result: true } });
  private server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const recorded: Recorded = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: data ? JSON.parse(data) : {},
      };
      this.requests.push(recorded);
      const out = this.handler(recorded);
      res.statusCode = out.status ?? 200;
      res.setHeader("Content-Type", out.contentType ?? "application/json");
      res.end(
        typeof out.body === "string" ? out.body : JSON.stringify(out.body),
      );
    });
  });

  listen(socketPath?: string): Promise<string> {
    return new Promise((resolve) => {
      if (socketPath) {
        this.server.listen(socketPath, () => resolve(socketPath));
      } else {
        this.server.listen(0, "127.0.0.1", () => {
          const { port } = this.server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}`);
        });
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const ENDPOINT = "https://viya.example.com";
const UID = "8f0c2a4e-1b2c-4d5e-9f00-112233445566";

const viyaIntegration = (
  extra: Partial<WorkbenchIntegration> = {},
): WorkbenchIntegration => ({
  type: "custom",
  uid: UID,
  name: "sas-viya",
  display_name: "SAS Viya",
  client_id: "posit-workbench",
  auth_url: "https://viya.example.com/SASLogon/oauth/authorize",
  token_url: "https://viya.example.com/SASLogon/oauth/token",
  scopes: ["openid"],
  issuer: "https://viya.example.com/SASLogon",
  authenticated: true,
  ...extra,
});

describe("workbenchAuth", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wbauth-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("readRpcCookie", () => {
    it("prefers the runtime dir cookie file and re-reads it", () => {
      const env = {
        PWB_SESSION_RUNTIME_DIR: dir,
        RS_SESSION_RPC_COOKIE: "env-cookie",
      };
      writeFileSync(join(dir, "rpc_cookie"), "file-cookie-1\n");
      expect(readRpcCookie(env)).to.equal("file-cookie-1");
      writeFileSync(join(dir, "rpc_cookie"), "file-cookie-2");
      expect(readRpcCookie(env)).to.equal("file-cookie-2");
    });

    it("falls back to the environment", () => {
      expect(
        readRpcCookie({
          PWB_SESSION_RUNTIME_DIR: dir,
          RS_SESSION_RPC_COOKIE: "env-cookie",
        }),
      ).to.equal("env-cookie");
      expect(readRpcCookie({ RS_SESSION_RPC_COOKIE: "env-cookie" })).to.equal(
        "env-cookie",
      );
    });

    it("is undefined without a cookie", () => {
      expect(readRpcCookie({})).to.equal(undefined);
      writeFileSync(join(dir, "rpc_cookie"), "  \n");
      expect(readRpcCookie({ PWB_SESSION_RUNTIME_DIR: dir })).to.equal(
        undefined,
      );
    });
  });

  describe("detectWorkbench", () => {
    const none = () => false;
    const all = () => true;

    it("needs a cookie", () => {
      expect(detectWorkbench({ RS_SERVER_ADDRESS: "http://wb:8787" }, all)).to
        .be.undefined;
    });

    it("uses RS_SERVER_ADDRESS", () => {
      expect(
        detectWorkbench(
          { RS_SESSION_RPC_COOKIE: "c", RS_SERVER_ADDRESS: "http://wb:8787/" },
          none,
        ),
      ).to.deep.equal({ baseUrl: "http://wb:8787" });
    });

    it("falls back to the default RPC socket", () => {
      expect(
        detectWorkbench({ RS_SESSION_RPC_COOKIE: "c" }, all),
      ).to.deep.equal({
        socketPath:
          "/run/rstudio-server/rstudio-rserver/session-server-rpc.socket",
      });
    });

    it("uses RS_SERVER_RPC_SOCKET_PATH", () => {
      expect(
        detectWorkbench(
          { RS_SESSION_RPC_COOKIE: "c", RS_SERVER_RPC_SOCKET_PATH: "/x.sock" },
          (p) => p === "/x.sock",
        ),
      ).to.deep.equal({ socketPath: "/x.sock" });
    });

    it("is undefined without an address or socket", () => {
      expect(detectWorkbench({ RS_SESSION_RPC_COOKIE: "c" }, none)).to.be
        .undefined;
    });

    it("detects with only the cookie file", () => {
      writeFileSync(join(dir, "rpc_cookie"), "file-cookie");
      expect(
        detectWorkbench(
          { PWB_SESSION_RUNTIME_DIR: dir, RS_SERVER_ADDRESS: "http://wb" },
          none,
        ),
      ).to.deep.equal({ baseUrl: "http://wb" });
    });
  });

  describe("rpc", () => {
    let wb: FakeWorkbench;
    let baseUrl: string;

    beforeEach(async () => {
      wb = new FakeWorkbench();
      baseUrl = await wb.listen();
    });
    afterEach(() => wb.close());

    it("POSTs the method and kwparams with the cookie header", async () => {
      writeFileSync(join(dir, "rpc_cookie"), "rotated-cookie");
      await rpc(
        { baseUrl },
        "/oauth_token",
        { uuid: UID, force_refresh: false },
        { PWB_SESSION_RUNTIME_DIR: dir, RS_SESSION_RPC_COOKIE: "old" },
      );
      expect(wb.requests).to.have.length(1);
      const req = wb.requests[0];
      expect(req.method).to.equal("POST");
      expect(req.url).to.equal("/oauth_token");
      expect(req.headers["x-rs-session-server-rpc-cookie"]).to.equal(
        "rotated-cookie",
      );
      expect(req.headers["content-type"]).to.match(/^application\/json/);
      expect(req.body).to.deep.equal({
        method: "/oauth_token",
        kwparams: { uuid: UID, force_refresh: false },
      });
    });

    it("re-reads a rotated cookie on every call", async () => {
      const env = { PWB_SESSION_RUNTIME_DIR: dir };
      writeFileSync(join(dir, "rpc_cookie"), "cookie-1");
      await rpc({ baseUrl }, "/oauth_integrations", {}, env);
      writeFileSync(join(dir, "rpc_cookie"), "cookie-2");
      await rpc({ baseUrl }, "/oauth_integrations", {}, env);
      expect(
        wb.requests.map((r) => r.headers["x-rs-session-server-rpc-cookie"]),
      ).to.deep.equal(["cookie-1", "cookie-2"]);
    });

    it("rejects non-200 responses", async () => {
      wb.handler = () => ({ status: 404, body: "Not Found" });
      let err: Error | undefined;
      await rpc(
        { baseUrl },
        "/oauth_integrations",
        {},
        {
          RS_SESSION_RPC_COOKIE: "c",
        },
      ).catch((e) => (err = e));
      expect(err?.message).to.contain("HTTP 404");
    });

    it("rejects non-JSON responses", async () => {
      wb.handler = () => ({ contentType: "text/html", body: "<html/>" });
      let err: Error | undefined;
      await rpc(
        { baseUrl },
        "/oauth_integrations",
        {},
        {
          RS_SESSION_RPC_COOKIE: "c",
        },
      ).catch((e) => (err = e));
      expect(err?.message).to.contain("non-JSON");
    });

    it("rejects invalid JSON", async () => {
      wb.handler = () => ({ body: "{not json" });
      let err: Error | undefined;
      await rpc(
        { baseUrl },
        "/oauth_integrations",
        {},
        {
          RS_SESSION_RPC_COOKIE: "c",
        },
      ).catch((e) => (err = e));
      expect(err?.message).to.contain("invalid JSON");
    });

    it("does not leak the cookie in connection errors", async () => {
      let err: Error | undefined;
      await rpc(
        { baseUrl: "http://127.0.0.1:1" },
        "/oauth_token",
        {},
        {
          RS_SESSION_RPC_COOKIE: "secret-cookie-value",
        },
      ).catch((e) => (err = e));
      expect(err).to.exist;
      expect(err?.message).not.to.contain("secret-cookie-value");
    });

    it("works over the unix socket", async function () {
      if (process.platform === "win32") {
        this.skip();
      }
      const sockWb = new FakeWorkbench();
      const socketPath = await sockWb.listen(join(dir, "rpc.sock"));
      try {
        const target = detectWorkbench({
          RS_SESSION_RPC_COOKIE: "c",
          RS_SERVER_RPC_SOCKET_PATH: socketPath,
        });
        expect(target).to.deep.equal({ socketPath });
        await rpc(
          target!,
          "/oauth_integrations",
          {},
          {
            RS_SESSION_RPC_COOKIE: "c",
          },
        );
        expect(sockWb.requests[0].url).to.equal("/oauth_integrations");
        expect(
          sockWb.requests[0].headers["x-rs-session-server-rpc-cookie"],
        ).to.equal("c");
      } finally {
        await sockWb.close();
      }
    });
  });

  describe("getToken and listIntegrations", () => {
    let wb: FakeWorkbench;
    let baseUrl: string;
    const env = { RS_SESSION_RPC_COOKIE: "c" };

    beforeEach(async () => {
      wb = new FakeWorkbench();
      baseUrl = await wb.listen();
    });
    afterEach(() => wb.close());

    it("parses a token", async () => {
      wb.handler = () => ({
        body: {
          result: true,
          access_token: "tok",
          expiry: "2030-01-02T03:04:05Z",
        },
      });
      expect(
        await getToken({ baseUrl }, UID, { force: true }, env),
      ).to.deep.equal({
        accessToken: "tok",
        expiry: Date.UTC(2030, 0, 2, 3, 4, 5),
      });
      expect(wb.requests[0].body.kwparams).to.deep.equal({
        uuid: UID,
        force_refresh: true,
      });
    });

    it("returns undefined when the user has no token", async () => {
      wb.handler = () => ({ body: { result: false } });
      expect(await getToken({ baseUrl }, UID, {}, env)).to.equal(undefined);
    });

    it("throws on an RPC error", async () => {
      wb.handler = () => ({
        body: { error: { code: 1, message: "no such integration" } },
      });
      let err: Error | undefined;
      await getToken({ baseUrl }, UID, {}, env).catch((e) => (err = e));
      expect(err?.message).to.contain("no such integration");
    });

    it("flattens integrations across providers", async () => {
      wb.handler = () => ({
        body: {
          result: true,
          providers: [
            { type: "custom", integrations: [viyaIntegration()] },
            { type: "databricks", integrations: [{ uid: "db", name: "d" }] },
            { type: "snowflake" },
          ],
        },
      });
      const list = await listIntegrations({ baseUrl }, env);
      expect(list.map((i) => i.uid)).to.deep.equal([UID, "db"]);
    });

    it("lists nothing when the feature is off", async () => {
      wb.handler = () => ({ body: { result: false } });
      expect(await listIntegrations({ baseUrl }, env)).to.deep.equal([]);
    });

    it("isExpired honors the margin", () => {
      const now = 1_000_000;
      expect(isExpired({ accessToken: "t" }, now)).to.equal(false);
      expect(
        isExpired({ accessToken: "t", expiry: now + 60_000 }, now),
      ).to.equal(false);
      expect(
        isExpired({ accessToken: "t", expiry: now + 10_000 }, now),
      ).to.equal(true);
      expect(isExpired({ accessToken: "t", expiry: now - 1 }, now)).to.equal(
        true,
      );
    });
  });

  describe("findIntegration", () => {
    it("matches the SAS Logon token URL", () => {
      const m = findIntegration(ENDPOINT, [viyaIntegration()]);
      expect(m.kind).to.equal("match");
    });

    it("normalizes trailing slashes, case, and default ports", () => {
      for (const [endpoint, tokenUrl] of [
        [
          "https://viya.example.com/",
          "https://viya.example.com/SASLogon/oauth/token/",
        ],
        [
          "https://VIYA.Example.com",
          "HTTPS://viya.example.com/SASLogon/oauth/token",
        ],
        [
          "https://viya.example.com:443",
          "https://viya.example.com/SASLogon/oauth/token",
        ],
        [
          "https://viya.example.com",
          "https://viya.example.com:443/SASLogon/oauth/token",
        ],
      ]) {
        const m = findIntegration(endpoint, [
          viyaIntegration({ token_url: tokenUrl }),
        ]);
        expect(m.kind, `${endpoint} vs ${tokenUrl}`).to.equal("match");
      }
    });

    it("distinguishes ports, hosts, and schemes", () => {
      for (const tokenUrl of [
        "https://viya.example.com:8443/SASLogon/oauth/token",
        "https://other.example.com/SASLogon/oauth/token",
        "http://viya.example.com/SASLogon/oauth/token",
        "https://viya.example.com/oauth/token",
      ]) {
        const m = findIntegration(ENDPOINT, [
          viyaIntegration({ token_url: tokenUrl }),
        ]);
        expect(m.kind, tokenUrl).to.equal("none");
      }
    });

    it("prefers an explicit GUID", () => {
      const other = viyaIntegration({
        uid: "11111111-2222-3333-4444-555555555555",
        token_url: "https://elsewhere.example.com/token",
      });
      const m = findIntegration(
        ENDPOINT,
        [viyaIntegration(), other],
        "11111111-2222-3333-4444-555555555555".toUpperCase(),
      );
      expect(m.kind).to.equal("match");
      expect(m.kind === "match" && m.integration.uid).to.equal(other.uid);
      expect(
        findIntegration(ENDPOINT, [viyaIntegration()], "nope"),
      ).to.deep.equal({ kind: "notFound", guid: "nope" });
    });

    it("does not match zero or several integrations", () => {
      expect(findIntegration(ENDPOINT, []).kind).to.equal("none");
      const m = findIntegration(ENDPOINT, [
        viyaIntegration(),
        viyaIntegration({ uid: "second" }),
      ]);
      expect(m.kind).to.equal("ambiguous");
    });

    it("ignores integrations without a uid", () => {
      expect(
        findIntegration(ENDPOINT, [viyaIntegration({ uid: undefined })]).kind,
      ).to.equal("none");
    });

    it("builds the SAS Logon token URL", () => {
      expect(sasLogonTokenUrl("https://viya.example.com/")).to.equal(
        "https://viya.example.com/SASLogon/oauth/token",
      );
      expect(sasLogonTokenUrl("not a url")).to.equal(undefined);
    });
  });

  describe("resolveWorkbenchAuth", () => {
    let wb: FakeWorkbench;
    let baseUrl: string;
    let integrations: WorkbenchIntegration[];
    let tokens: object[];
    const future = () => new Date(Date.now() + 3600_000).toISOString();
    const past = () => new Date(Date.now() - 1000).toISOString();

    beforeEach(async () => {
      wb = new FakeWorkbench();
      baseUrl = await wb.listen();
      integrations = [viyaIntegration()];
      tokens = [{ result: true, access_token: "tok", expiry: future() }];
      wb.handler = (req) => {
        if (req.url === "/oauth_integrations") {
          return {
            body: {
              result: true,
              providers: [{ type: "custom", integrations }],
            },
          };
        }
        return { body: tokens.length > 1 ? tokens.shift()! : tokens[0] };
      };
    });
    afterEach(() => wb.close());

    const resolve = (
      mode: "auto" | "workbench" | "sasLogon" | undefined,
      extra: object = {},
    ) =>
      resolveWorkbenchAuth({
        mode,
        endpoint: ENDPOINT,
        env: { RS_SESSION_RPC_COOKIE: "c", RS_SERVER_ADDRESS: baseUrl },
        ...extra,
      });

    it("sasLogon never calls Workbench", async () => {
      expect(await resolve("sasLogon")).to.deep.equal({ kind: "sasLogon" });
      expect(wb.requests).to.have.length(0);
    });

    it("auto (the default) uses a matching integration", async () => {
      const out = await resolve(undefined);
      expect(out.kind).to.equal("token");
      expect(out.kind === "token" && out.token.accessToken).to.equal("tok");
      expect(wb.requests.map((r) => r.url)).to.deep.equal([
        "/oauth_integrations",
        "/oauth_token",
      ]);
    });

    it("auto falls back to SAS Logon outside Workbench", async () => {
      const out = await resolveWorkbenchAuth({
        mode: "auto",
        endpoint: ENDPOINT,
        env: {},
        socketExists: () => false,
      });
      expect(out).to.deep.equal({ kind: "sasLogon" });
    });

    it("workbench fails outside Workbench", async () => {
      const out = await resolveWorkbenchAuth({
        mode: "workbench",
        endpoint: ENDPOINT,
        env: {},
        socketExists: () => false,
      });
      expect(out).to.deep.include({ kind: "error", reason: "notInWorkbench" });
    });

    it("auto falls back without a matching integration; workbench fails", async () => {
      integrations = [viyaIntegration({ token_url: "https://x/token" })];
      expect(await resolve("auto")).to.deep.equal({ kind: "sasLogon" });
      expect(await resolve("workbench")).to.deep.include({
        kind: "error",
        reason: "noIntegration",
      });
    });

    it("auto falls back on ambiguity; workbench reports it", async () => {
      integrations = [viyaIntegration(), viyaIntegration({ uid: "other" })];
      expect(await resolve("auto")).to.deep.equal({ kind: "sasLogon" });
      expect(await resolve("workbench")).to.deep.include({
        kind: "error",
        reason: "ambiguous",
      });
    });

    it("auto falls back when the RPC fails; workbench reports it", async () => {
      wb.handler = () => ({ status: 500, body: "boom" });
      expect(await resolve("auto")).to.deep.equal({ kind: "sasLogon" });
      expect(await resolve("workbench")).to.deep.include({
        kind: "error",
        reason: "rpcFailed",
      });
    });

    it("asks to sign in when not authenticated", async () => {
      integrations = [viyaIntegration({ authenticated: false })];
      const auto = await resolve("auto");
      expect(auto.kind).to.equal("signInRequired");
      expect(await resolve("workbench")).to.deep.equal({
        kind: "error",
        reason: "signInRequired",
        detail: "SAS Viya",
      });
      expect(
        wb.requests.filter((r) => r.url === "/oauth_token"),
      ).to.have.length(0);
    });

    it("asks to sign in when Workbench has no token", async () => {
      tokens = [{ result: false }];
      expect((await resolve("auto")).kind).to.equal("signInRequired");
    });

    it("force refreshes an expired token once", async () => {
      tokens = [
        { result: true, access_token: "old", expiry: past() },
        { result: true, access_token: "new", expiry: future() },
      ];
      const out = await resolve("auto");
      expect(out.kind === "token" && out.token.accessToken).to.equal("new");
      const tokenCalls = wb.requests.filter((r) => r.url === "/oauth_token");
      expect(tokenCalls.map((r) => r.body.kwparams)).to.deep.equal([
        { uuid: UID, force_refresh: false },
        { uuid: UID, force_refresh: true },
      ]);
    });

    it("asks to sign in when the refreshed token is still expired", async () => {
      tokens = [{ result: true, access_token: "old", expiry: past() }];
      expect((await resolve("auto")).kind).to.equal("signInRequired");
    });

    it("passes force through", async () => {
      await resolve("workbench", { force: true });
      const call = wb.requests.find((r) => r.url === "/oauth_token");
      expect(call?.body.kwparams).to.deep.equal({
        uuid: UID,
        force_refresh: true,
      });
    });

    it("uses the explicit integration GUID", async () => {
      integrations = [
        viyaIntegration({ uid: "a", token_url: "https://x/token" }),
        viyaIntegration({ uid: "b", token_url: "https://y/token" }),
      ];
      const out = await resolve("workbench", { workbenchIntegration: "b" });
      expect(out.kind === "token" && out.integration.uid).to.equal("b");
      expect(
        await resolve("workbench", { workbenchIntegration: "c" }),
      ).to.deep.include({ kind: "error", reason: "notFound" });
    });

    it("never logs the token or cookie", async () => {
      const lines: string[] = [];
      const log = {
        info: (m: string) => lines.push(m),
        warn: (m: string) => lines.push(m),
      };
      tokens = [
        { result: true, access_token: "tok-secret-1", expiry: future() },
      ];
      await resolveWorkbenchAuth({
        mode: "auto",
        endpoint: ENDPOINT,
        env: {
          RS_SESSION_RPC_COOKIE: "cookie-secret",
          RS_SERVER_ADDRESS: baseUrl,
        },
        log,
      });
      wb.handler = () => ({
        body: { error: { message: "bad token tok-secret-1 Bearer abc.def" } },
      });
      await resolveWorkbenchAuth({
        mode: "auto",
        endpoint: ENDPOINT,
        env: {
          RS_SESSION_RPC_COOKIE: "cookie-secret",
          RS_SERVER_ADDRESS: baseUrl,
        },
        log,
      });
      expect(lines.length).to.be.greaterThan(0);
      const all = lines.join("\n");
      expect(all).not.to.contain("cookie-secret");
      expect(all).not.to.contain("abc.def");
    });
  });

  describe("redact", () => {
    it("removes known secrets, bearer tokens, token fields, and JWTs", () => {
      const jwt =
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJqZG9lIn0.c2lnbmF0dXJlLXZhbHVl";
      const out = redact(
        `cookie=my-cookie Authorization: Bearer abc123 {"access_token":"xyz789"} ${jwt} refresh_token=r1&x=1`,
        ["my-cookie"],
      );
      expect(out).not.to.contain("my-cookie");
      expect(out).not.to.contain("abc123");
      expect(out).not.to.contain("xyz789");
      expect(out).not.to.contain(jwt);
      expect(out).not.to.contain("r1&");
      expect(out).to.contain("x=1");
    });

    it("leaves ordinary text alone", () => {
      expect(redact("HTTP 404 from /oauth_token")).to.equal(
        "HTTP 404 from /oauth_token",
      );
    });
  });
});
