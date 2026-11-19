// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// A local stand-in for the SAS Life Science Analytics Framework REST API 1.0,
// built from its OpenAPI document (no live LSAF server was available). It
// keeps a repository and a workspace in memory and fakes job runs, for the
// end-to-end tests of the LSAF client and for clicking through the LSAF
// views in Positron:
//
//   npx ts-node --transpile-only client/test/lsaf-mock/server.ts [port]
//
// then set "SAS.lsaf.url" to the printed URL and sign in as demo / demo.
//
// What a real server does where the spec is silent (job and manifest file
// formats, log locations, submission states) is guessed here; passing tests
// against this mock do not prove the requests are right for a real server.
import * as http from "http";

const API = "/lsaf/api";
const ERROR_TYPE = "application/vnd.sas.hls.error+json";

type Area = "repository" | "workspace";

interface RepoVersion {
  version: string;
  content: Uint8Array;
  created: string;
  createdBy: string;
  comment?: string;
}

interface RepoEntry {
  type: "context" | "folder" | "file";
  id: string;
  created: string;
  createdBy: string;
  lastModified: string;
  content?: Uint8Array;
  versioned?: boolean;
  versions?: RepoVersion[];
  checkedOutBy?: string;
  checkedOutDate?: string;
}

interface WsEntry {
  type: "folder" | "file";
  content?: Uint8Array;
  lastModified: string;
}

interface Submission {
  id: string;
  area: Area;
  jobPath: string;
  state: string;
  submittedBy: string;
  submittedTimestamp: string;
  completedTimestamp?: string;
  message: string;
  manifestPath?: string;
  parameters: Record<string, unknown>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: Uint8Array;
}

export interface MockOptions {
  /** How long a job runs. */
  jobDurationMs?: number;
  users?: Record<string, string>;
}

let nextId = 1;
const newId = () =>
  `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
const now = () => new Date().toISOString();

const norm = (path: string) =>
  `/${path
    .split("/")
    .filter((s) => s)
    .join("/")}`;
const parentOf = (path: string) => {
  const p = norm(path);
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};
const nameOf = (path: string) => norm(path).split("/").pop() ?? "";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string"
    ? encoder.encode(content)
    : new Uint8Array(content);
}

const textOf = (bytes: Uint8Array): string => decoder.decode(bytes);

/** A Buffer over the same memory, for its search and integer readers. */
const view = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export class LsafMockServer {
  readonly repository = new Map<string, RepoEntry>();
  readonly workspace = new Map<string, WsEntry>();
  readonly submissions = new Map<string, Submission>();
  readonly requests: RecordedRequest[] = [];
  readonly tokens = new Set<string>();
  private server: http.Server | undefined;
  private readonly users: Record<string, string>;
  private readonly jobDurationMs: number;

  constructor(options: MockOptions = {}) {
    this.users = options.users ?? { demo: "demo" };
    this.jobDurationMs = options.jobDurationMs ?? 2000;
    this.seed();
  }

  /** Start listening on 127.0.0.1; resolves to the API URL. */
  async start(port = 0): Promise<string> {
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.error(res, 500, 99999, String(error));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    const address = server.address();
    const actual = address && typeof address === "object" ? address.port : port;
    return `http://127.0.0.1:${actual}${API}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
  }

  /** Invalidate every session token, as an inactivity timeout would. */
  expireSessions(): void {
    this.tokens.clear();
  }

  // --- data ---

  addRepoFolder(path: string, type: "context" | "folder" = "folder") {
    const p = norm(path);
    if (p === "/") {
      return;
    }
    if (!this.repository.has(parentOf(p))) {
      this.addRepoFolder(parentOf(p));
    }
    if (!this.repository.has(p)) {
      this.repository.set(p, {
        type,
        id: newId(),
        created: now(),
        createdBy: "admin",
        lastModified: now(),
      });
    }
  }

  addRepoFile(path: string, content: string | Uint8Array, versions?: string[]) {
    const p = norm(path);
    this.addRepoFolder(parentOf(p));
    const bytes = toBytes(content);
    this.repository.set(p, {
      type: "file",
      id: newId(),
      created: now(),
      createdBy: "admin",
      lastModified: now(),
      content: bytes,
      versioned: !!versions,
      versions: (versions ?? []).map((version, i) => ({
        version,
        content:
          i === versions.length - 1
            ? bytes
            : toBytes(`${textOf(bytes)}/* version ${version} */\n`),
        created: now(),
        createdBy: "admin",
        comment: `Version ${version}`,
      })),
    });
  }

  addWsFolder(path: string) {
    const p = norm(path);
    if (p === "/") {
      return;
    }
    if (!this.workspace.has(parentOf(p))) {
      this.addWsFolder(parentOf(p));
    }
    if (!this.workspace.has(p)) {
      this.workspace.set(p, { type: "folder", lastModified: now() });
    }
  }

  addWsFile(path: string, content: string | Uint8Array) {
    const p = norm(path);
    this.addWsFolder(parentOf(p));
    this.workspace.set(p, {
      type: "file",
      content: toBytes(content),
      lastModified: now(),
    });
  }

  private seed() {
    const adsl =
      "data work.adsl; set sashelp.class; run;\nproc print data=work.adsl; run;\n";
    this.addRepoFolder("/Org", "context");
    this.addRepoFolder("/Org/Study1", "context");
    this.addRepoFile("/Org/Study1/programs/adsl.sas", adsl, ["1.0", "2.0"]);
    this.addRepoFile(
      "/Org/Study1/programs/adae.sas",
      "proc means data=sashelp.class; run;\n",
    );
    this.addRepoFile(
      "/Org/Study1/jobs/report.job",
      JSON.stringify({ programs: ["../programs/adae.sas"] }, null, 2),
      ["1.0"],
    );
    this.addWsFile("/Org/Study1/programs/adsl.sas", adsl);
    this.addWsFile("/Org/Study1/scratch/test.sas", "proc options; run;\n");
  }

  // --- HTTP ---

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    const query = Object.fromEntries(url.searchParams.entries());
    const path = decodeURIComponent(url.pathname);
    const method = req.method ?? "GET";
    this.requests.push({ method, path, query, headers: req.headers, body });
    if (!path.startsWith(API)) {
      return this.error(res, 404, 404, "Not an LSAF API path.");
    }
    const route = path.slice(API.length) || "/";

    if (method === "GET" && route === "/") {
      return this.json(res, 200, {
        links: [
          { rel: "logon", method: "POST", uri: "/logon" },
          { rel: "logoff", method: "POST", uri: "/logoff" },
        ],
      });
    }
    if (route === "/encrypt" && method === "GET") {
      const user = this.basicUser(req);
      if (!user) {
        return this.error(res, 401, 1001, "Invalid credentials.");
      }
      const encrypted = view(toBytes(user.password)).toString("base64");
      return this.json(res, 200, `{P21}${encrypted}`);
    }
    if (route === "/logon" && method === "POST") {
      const user = this.basicUser(req);
      if (!user) {
        return this.error(res, 401, 1001, "Invalid credentials.");
      }
      const token = `api_sk_${newId().replace(/-/g, "")}`;
      this.tokens.add(token);
      res.writeHead(200, { "X-Auth-Token": token, "Content-Length": "0" });
      return res.end();
    }
    const token = String(req.headers["x-auth-token"] ?? "");
    if (!this.tokens.has(token)) {
      return this.error(
        res,
        401,
        1002,
        "Session token was not provided or was invalid.",
      );
    }
    if (route === "/logoff" && method === "POST") {
      this.tokens.delete(token);
      res.writeHead(200);
      return res.end();
    }
    if (route === "/apiMeta") {
      return this.json(res, 200, { name: "LSAF REST API", version: "1.0" });
    }
    const user = Object.keys(this.users)[0];

    let m = /^\/repository\/(files|containers)(\/.*)?$/.exec(route);
    if (m) {
      return this.repositoryRoute(
        res,
        method,
        m[1],
        norm(m[2] ?? "/"),
        query,
        req,
        body,
        user,
      );
    }
    m = /^\/workspace\/(files|folders)(\/.*)?$/.exec(route);
    if (m) {
      return this.workspaceRoute(
        res,
        method,
        m[1],
        norm(m[2] ?? "/"),
        query,
        req,
        body,
        user,
      );
    }
    m = /^\/jobs\/(repository|workspace)(\/.*)$/.exec(route);
    if (m) {
      const area: Area = m[1] === "repository" ? "repository" : "workspace";
      return this.jobRoute(res, method, area, norm(m[2]), query, body, user);
    }
    m = /^\/jobs\/submissions\/([^/]+)(?:\/(status|job|manifest))?$/.exec(
      route,
    );
    if (m && method === "GET") {
      return this.submissionRoute(res, m[1], m[2], query);
    }
    return this.error(res, 404, 404, `No route for ${method} ${route}.`);
  }

  private basicUser(req: http.IncomingMessage) {
    const header = String(req.headers.authorization ?? "");
    if (!header.startsWith("Basic ")) {
      return undefined;
    }
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    const user = decoded.slice(0, colon);
    let password = decoded.slice(colon + 1);
    if (password.startsWith("{P21}")) {
      password = Buffer.from(password.slice(5), "base64").toString("utf8");
    }
    return this.users[user] === password ? { user, password } : undefined;
  }

  private repoItem(path: string, expand: boolean) {
    const entry = this.repository.get(path);
    const schemaType =
      entry.type === "file"
        ? nameOf(path).endsWith(".job")
          ? "executable"
          : "file"
        : entry.type;
    if (!expand) {
      return { schemaType, schemaVersion: 1, path };
    }
    const base = {
      schemaType,
      schemaVersion: 1,
      typeId: `sas:${schemaType === "executable" ? "job" : entry.type}`,
      id: entry.id,
      name: nameOf(path),
      path,
      created: entry.created,
      createdBy: entry.createdBy,
      lastModified: entry.lastModified,
      lastModifiedBy: entry.createdBy,
      syncable: "ALLOW",
      state: "ACTIVE",
    };
    if (entry.type !== "file") {
      return {
        ...base,
        container: true,
        context: entry.type === "context",
        shared: false,
      };
    }
    const latest = entry.versions?.[entry.versions.length - 1];
    return {
      ...base,
      versioned: !!entry.versioned,
      version: latest?.version,
      checkedOut: !!entry.checkedOutBy,
      checkedOutBy: entry.checkedOutBy,
      checkedOutDate: entry.checkedOutDate,
      locked: false,
      size: entry.content?.length ?? 0,
      digest: "9CA792FEAD14C502C321906E7085E790",
      signingStatus: "NONE",
    };
  }

  private repositoryRoute(
    res: http.ServerResponse,
    method: string,
    kind: string,
    path: string,
    query: Record<string, string>,
    req: http.IncomingMessage,
    body: Uint8Array,
    user: string,
  ) {
    const entry = this.repository.get(path);
    const expandItem = (query.expand ?? "").split(",").includes("item");
    if (method === "GET" && kind === "containers") {
      if (path !== "/" && (!entry || entry.type === "file")) {
        return this.error(
          res,
          404,
          2001,
          `The container ${path} was not found.`,
        );
      }
      if (query.component === "children") {
        const children = [...this.repository.keys()].filter(
          (p) => parentOf(p) === path,
        );
        // The real default is not documented; the mock truncates at 100.
        const limit = query.limit ? Number(query.limit) : 100;
        return this.json(res, 200, {
          schemaVersion: 1,
          items: children
            .slice(0, limit)
            .map((p) => this.repoItem(p, expandItem)),
        });
      }
      if (query.component === "properties") {
        return this.json(res, 200, this.repoItem(path, true));
      }
      if (query.component === "contents") {
        const prefix = path === "/" ? "/" : `${path}/`;
        const files = [...this.repository.entries()]
          .filter(([p, e]) => e.type === "file" && p.startsWith(prefix))
          .map(([p, e]) => ({
            name: p.slice(prefix.length),
            content: e.content,
          }));
        res.writeHead(200, { "Content-Type": "application/zip" });
        return res.end(buildZip(files));
      }
      return this.error(res, 400, 4000, "Bad component.");
    }
    if (method === "GET" && kind === "files") {
      if (!entry || entry.type !== "file") {
        return this.error(res, 404, 2002, `The file ${path} was not found.`);
      }
      const version = query.version
        ? entry.versions?.find((v) => v.version === query.version)
        : undefined;
      if (query.version && !version) {
        return this.error(
          res,
          404,
          2003,
          `Version ${query.version} of ${path} was not found.`,
        );
      }
      switch (query.component) {
        case "properties":
          return this.json(res, 200, this.repoItem(path, true));
        case "contents":
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          return res.end(version?.content ?? entry.content);
        case "versions":
          return this.json(res, 200, {
            items: (entry.versions ?? []).map((v, i, all) => ({
              schemaVersion: 1,
              version: v.version,
              path,
              comment: v.comment,
              created: v.created,
              createdBy: v.createdBy,
              size: v.content.length,
              digest: "9CA792FEAD14C502C321906E7085E790",
              latest: i === all.length - 1,
              signed: false,
            })),
          });
        case "signatures":
          return this.json(res, 200, { items: [] });
      }
      return this.error(res, 400, 4000, "Bad component.");
    }
    if (method === "PUT" && kind === "files") {
      return this.repositoryAction(res, path, query, req, body, user);
    }
    return this.error(res, 405, 4050, "Method not allowed.");
  }

  private repositoryAction(
    res: http.ServerResponse,
    path: string,
    query: Record<string, string>,
    req: http.IncomingMessage,
    body: Uint8Array,
    user: string,
  ) {
    const entry = this.repository.get(path);
    const result = (type: string, message: string, code = 0) =>
      this.json(res, 200, {
        schemaType: "RepositoryActionResult",
        schemaVersion: 1,
        action: query.action,
        status: { schemaVersion: 1, code, type, message },
        item: this.repository.has(path)
          ? this.repoItem(path, true)
          : { schemaType: "file", path },
      });
    switch (query.action) {
      case "upload": {
        const file = parseMultipart(req, body).find((p) => p.name === "file");
        if (!file) {
          return this.error(res, 400, 4001, "No file part.");
        }
        if (
          parentOf(path) !== "/" &&
          !this.repository.has(parentOf(path)) &&
          query.createParents !== "true"
        ) {
          return this.error(
            res,
            404,
            2001,
            "The parent folder does not exist.",
          );
        }
        this.addRepoFolder(parentOf(path));
        if (entry?.versioned) {
          if (entry.checkedOutBy && entry.checkedOutBy !== user) {
            return result(
              "failure",
              `${path} is checked out by ${entry.checkedOutBy}.`,
              30010,
            );
          }
          const next = nextVersion(entry.versions, query.version);
          entry.versions.push({
            version: next,
            content: file.data,
            created: now(),
            createdBy: user,
            comment: query.comment,
          });
          entry.content = file.data;
          entry.lastModified = now();
          return result("success", `Version ${next} was created.`, 10001);
        }
        if (entry && query.overwrite !== "true") {
          return result(
            "warning",
            "File was not updated because it exists and overwrite is set to false.",
            20012,
          );
        }
        const first = query.version
          ? /^major$/i.test(query.version)
            ? "1.0"
            : /^minor$/i.test(query.version)
              ? "0.1"
              : query.version
          : undefined;
        this.repository.set(path, {
          type: "file",
          id: entry?.id ?? newId(),
          created: entry?.created ?? now(),
          createdBy: user,
          lastModified: now(),
          content: file.data,
          versioned: !!first,
          versions: first
            ? [
                {
                  version: first,
                  content: file.data,
                  created: now(),
                  createdBy: user,
                  comment: query.comment,
                },
              ]
            : [],
        });
        return result("success", "File was uploaded.", 10000);
      }
      case "checkout": {
        if (!entry || entry.type !== "file") {
          return this.error(res, 404, 2002, `The file ${path} was not found.`);
        }
        if (entry.checkedOutBy) {
          return result(
            "failure",
            `${path} is already checked out by ${entry.checkedOutBy}.`,
            30001,
          );
        }
        entry.checkedOutBy = user;
        entry.checkedOutDate = now();
        if (query.copyToWorkspace !== "false") {
          this.addWsFile(path, entry.content);
        }
        return result("success", "File was checked out.", 10002);
      }
      case "checkin": {
        if (!entry || entry.checkedOutBy !== user) {
          return result("failure", `${path} is not checked out to you.`, 30002);
        }
        const ws = this.workspace.get(path);
        if (!ws?.content) {
          return result("failure", `${path} is not in your workspace.`, 30003);
        }
        entry.content = ws.content;
        if (entry.versioned) {
          // A versioned check-in increments the major version by default.
          entry.versions.push({
            version: nextVersion(entry.versions, query.version ?? "MAJOR"),
            content: ws.content,
            created: now(),
            createdBy: user,
            comment: query.comment,
          });
        }
        entry.checkedOutBy = undefined;
        entry.checkedOutDate = undefined;
        entry.lastModified = now();
        return result("success", "File was checked in.", 10003);
      }
      case "undocheckout": {
        if (!entry || entry.checkedOutBy !== user) {
          return result("failure", `${path} is not checked out to you.`, 30002);
        }
        entry.checkedOutBy = undefined;
        entry.checkedOutDate = undefined;
        return result("success", "Checkout was cancelled.", 10004);
      }
      case "run":
        return this.submit(res, "repository", path, body, user);
    }
    return this.error(res, 400, 4000, `Unknown action ${query.action}.`);
  }

  private wsItem(path: string, expand: boolean) {
    const entry = this.workspace.get(path);
    if (!expand) {
      return { schemaType: entry.type, schemaVersion: 1, path };
    }
    return {
      schemaType: entry.type,
      schemaVersion: 1,
      name: nameOf(path),
      path,
      lastModified: entry.lastModified,
      symbolicLink: false,
      folder: entry.type === "folder",
      ...(entry.type === "file" ? { size: entry.content?.length ?? 0 } : {}),
    };
  }

  private workspaceRoute(
    res: http.ServerResponse,
    method: string,
    kind: string,
    path: string,
    query: Record<string, string>,
    req: http.IncomingMessage,
    body: Uint8Array,
    user: string,
  ) {
    const entry = this.workspace.get(path);
    const expandItem = (query.expand ?? "").split(",").includes("item");
    if (method === "GET" && kind === "folders") {
      if (path !== "/" && entry?.type !== "folder") {
        return this.error(res, 404, 3001, `The folder ${path} was not found.`);
      }
      if (query.component === "children") {
        const children = [...this.workspace.keys()].filter(
          (p) => parentOf(p) === path,
        );
        return this.json(res, 200, {
          schemaVersion: 1,
          items: children.map((p) => this.wsItem(p, expandItem)),
        });
      }
      if (query.component === "properties") {
        return this.json(
          res,
          200,
          path === "/"
            ? { schemaType: "folder", path: "/" }
            : this.wsItem(path, true),
        );
      }
      if (query.component === "contents") {
        const prefix = path === "/" ? "/" : `${path}/`;
        const files = [...this.workspace.entries()]
          .filter(([p, e]) => e.type === "file" && p.startsWith(prefix))
          .map(([p, e]) => ({
            name: p.slice(prefix.length),
            content: e.content,
          }));
        res.writeHead(200, { "Content-Type": "application/zip" });
        return res.end(buildZip(files));
      }
    }
    if (method === "PUT" && kind === "folders") {
      const zip = parseMultipart(req, body)[0];
      if (!zip) {
        return this.error(res, 400, 4001, "No zip part.");
      }
      const entries = readZip(zip.data);
      for (const e of entries) {
        const target = norm(`${path}/${e.name}`);
        if (e.name.endsWith("/")) {
          this.addWsFolder(target);
        } else {
          this.addWsFile(target, e.data);
        }
      }
      return this.json(res, 200, {
        action: "upload",
        successes: { count: entries.length },
        warnings: { count: 0 },
        failures: { count: 0 },
      });
    }
    if (method === "GET" && kind === "files") {
      if (entry?.type !== "file") {
        return this.error(res, 404, 3002, `The file ${path} was not found.`);
      }
      if (query.component === "properties") {
        return this.json(res, 200, this.wsItem(path, true));
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(entry.content);
    }
    if (method === "PUT" && kind === "files") {
      if (query.action === "upload") {
        const file = parseMultipart(req, body).find((p) => p.name === "file");
        if (!file) {
          return this.error(res, 400, 4001, "No file part.");
        }
        if (entry && query.overwrite !== "true") {
          return this.json(res, 200, {
            schemaType: "WorkspaceActionResult",
            action: "upload",
            status: {
              code: 20012,
              type: "warning",
              message:
                "File was not updated because it exists and overwrite is set to false.",
            },
            item: this.wsItem(path, true),
          });
        }
        if (
          parentOf(path) !== "/" &&
          !this.workspace.has(parentOf(path)) &&
          query.createParents !== "true"
        ) {
          return this.error(
            res,
            404,
            3001,
            "The parent folder does not exist.",
          );
        }
        this.addWsFile(path, file.data);
        return this.json(res, 200, {
          schemaType: "WorkspaceActionResult",
          action: "upload",
          status: {
            code: 10000,
            type: "success",
            message: "File was uploaded.",
          },
          item: this.wsItem(path, true),
        });
      }
      if (query.action === "run") {
        return this.submit(res, "workspace", path, body, user);
      }
    }
    return this.error(res, 405, 4050, "Method not allowed.");
  }

  private jobRoute(
    res: http.ServerResponse,
    method: string,
    area: Area,
    path: string,
    query: Record<string, string>,
    body: Uint8Array,
    user: string,
  ) {
    if (method === "POST") {
      const programs: unknown = JSON.parse(textOf(body) || "[]");
      if (
        !Array.isArray(programs) ||
        programs.some((p) => typeof p !== "string")
      ) {
        return this.error(
          res,
          400,
          4002,
          "The body must be an array of program paths.",
        );
      }
      const exists =
        area === "workspace"
          ? this.workspace.has(path)
          : this.repository.has(path);
      if (exists) {
        return this.error(res, 409, 4090, `A job already exists at ${path}.`);
      }
      const content = JSON.stringify({ programs }, null, 2);
      if (area === "workspace") {
        if (
          parentOf(path) !== "/" &&
          !this.workspace.has(parentOf(path)) &&
          query.createParents !== "true"
        ) {
          return this.error(
            res,
            404,
            3001,
            "The parent folder does not exist.",
          );
        }
        this.addWsFile(path, content);
      } else {
        this.addRepoFile(path, content, query.version ? ["1.0"] : undefined);
      }
      return this.json(res, 201, {
        resource: { schemaType: area, schemaVersion: 1, path, id: newId() },
        programs,
      });
    }
    if (method === "PUT") {
      return this.submit(res, area, path, body, user);
    }
    return this.error(res, 405, 4050, "Method not allowed.");
  }

  private submit(
    res: http.ServerResponse,
    area: Area,
    path: string,
    body: Uint8Array,
    user: string,
  ) {
    const exists =
      area === "workspace"
        ? this.workspace.get(path)?.type === "file"
        : this.repository.get(path)?.type === "file";
    if (!exists) {
      return this.error(res, 404, 2002, `The job ${path} was not found.`);
    }
    const text = textOf(body).trim();
    const parameters = text ? JSON.parse(text) : {};
    const id = newId();
    const submission: Submission = {
      id,
      area,
      jobPath: path,
      state: "running",
      submittedBy: user,
      submittedTimestamp: now(),
      message: "Job run started.",
      parameters,
    };
    this.submissions.set(id, submission);
    setTimeout(() => this.finish(submission), this.jobDurationMs).unref();
    return this.json(res, 200, {
      schemaType:
        area === "workspace"
          ? "WorkspaceExecuteActionResult"
          : "RepositoryExecuteActionResult",
      schemaVersion: 1,
      action: "run",
      status: {
        schemaVersion: 1,
        code: 40001,
        type: "started",
        message: "Job run started.",
      },
      item: {
        schemaType: area === "workspace" ? "file" : "executable",
        schemaVersion: 1,
        path,
      },
      submissionId: id,
    });
  }

  /** Complete a run: write `<job>.log`, `.lst` and `.mnf` next to the job. */
  private finish(submission: Submission) {
    const stem = submission.jobPath.replace(/\.job$/, "");
    const log = `NOTE: Fake LSAF job ${submission.jobPath}\nNOTE: Parameters ${JSON.stringify(submission.parameters)}\nNOTE: The SAS System used 0.01 seconds.\n`;
    const manifestPath = `${stem}.mnf`;
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <job path="${submission.jobPath}"/>
  <outputs>
    <file path="${stem}.log" type="log"/>
    <file path="${stem}.lst" type="listing"/>
  </outputs>
</manifest>
`;
    const add = (path: string, content: string) =>
      submission.area === "workspace"
        ? this.addWsFile(path, content)
        : this.addRepoFile(path, content);
    add(`${stem}.log`, log);
    add(`${stem}.lst`, "The SAS System\n");
    add(manifestPath, manifest);
    submission.state = "completed";
    submission.completedTimestamp = now();
    submission.message = "Job completed successfully.";
    submission.manifestPath = manifestPath;
  }

  private submissionRoute(
    res: http.ServerResponse,
    id: string,
    part: string | undefined,
    query: Record<string, string>,
  ) {
    const s = this.submissions.get(id);
    if (!s) {
      return this.error(res, 404, 5001, `Submission ${id} was not found.`);
    }
    switch (part) {
      case "status":
        return this.json(res, 200, {
          schemaVersion: 1,
          code: s.state === "completed" ? 30300 : 30100,
          type: s.state === "completed" ? "COMPLETED" : "RUNNING",
          ...(query.expand === "status" ? { message: s.message } : {}),
        });
      case "job":
        return this.json(res, 200, {
          schemaType: s.area,
          schemaVersion: 1,
          path: s.jobPath,
        });
      case "manifest":
        if (!s.manifestPath) {
          return this.error(res, 409, 5002, "The job has not completed.");
        }
        return this.json(res, 200, {
          schemaType: s.area,
          schemaVersion: 1,
          path: s.manifestPath,
        });
      default:
        return this.json(res, 200, {
          id: s.id,
          state: s.state,
          submittedBy: s.submittedBy,
          submittedTimestamp: s.submittedTimestamp,
          completedTimestamp: s.completedTimestamp,
          message: s.message,
        });
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private error(
    res: http.ServerResponse,
    status: number,
    errorCode: number,
    message: string,
  ) {
    res.writeHead(status, { "Content-Type": ERROR_TYPE });
    res.end(
      JSON.stringify({
        schemaVersion: 1,
        httpStatusCode: status,
        errorCode,
        message,
      }),
    );
  }
}

function nextVersion(versions: RepoVersion[], spec: string | undefined) {
  const last = versions[versions.length - 1]?.version ?? "0.0";
  const [major, minor] = last.split(".").map(Number);
  if (!spec || /^minor$/i.test(spec)) {
    return `${major}.${minor + 1}`;
  }
  if (/^major$/i.test(spec)) {
    return `${major + 1}.0`;
  }
  return spec;
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
    req.on("end", () => resolve(concat(chunks)));
    req.on("error", reject);
  });
}

export interface Part {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array;
}

/** Parse a multipart/form-data body. */
export function parseMultipart(
  req: http.IncomingMessage,
  body: Uint8Array,
): Part[] {
  const type = String(req.headers["content-type"] ?? "");
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!/^multipart\/form-data/i.test(type) || !match) {
    return [];
  }
  const boundary = `--${match[1] ?? match[2]}`;
  const buf = view(body);
  const parts: Part[] = [];
  let start = buf.indexOf(boundary);
  while (start >= 0) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next < 0) {
      break;
    }
    const chunk = buf.subarray(start + boundary.length + 2, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const headers = chunk.subarray(0, headerEnd).toString("utf8");
      parts.push({
        name: /name="([^"]*)"/i.exec(headers)?.[1] ?? "",
        filename: /filename="([^"]*)"/i.exec(headers)?.[1],
        contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1],
        data: new Uint8Array(chunk.subarray(headerEnd + 4)),
      });
    }
    start = next;
  }
  return parts;
}

/** A zip of stored (uncompressed) entries; readers here don't check CRCs. */
function buildZip(files: Array<{ name: string; content: Uint8Array }>) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = toBytes(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(file.content.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(file.content.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(new Uint8Array(local), name, file.content);
    centrals.push(new Uint8Array(central), name);
    offset += 30 + name.length + file.content.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return concat([...locals, ...centrals, new Uint8Array(end)]);
}

/** The entries of a zip of stored entries, through its central directory. */
export function readZip(
  bytes: Uint8Array,
): Array<{ name: string; data: Uint8Array }> {
  const buf = view(bytes);
  const eocd = buf.lastIndexOf("PK\x05\x06", undefined, "latin1");
  if (eocd < 0) {
    throw new Error("Not a zip file.");
  }
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Bad central directory.");
    }
    const method = buf.readUInt16LE(offset + 10);
    const size = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (method !== 0) {
      throw new Error("Only stored entries are supported.");
    }
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.push({
      name,
      data: new Uint8Array(buf.subarray(start, start + size)),
    });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

if (require.main === module) {
  const port = Number(process.argv[2] ?? 8765);
  const mock = new LsafMockServer({ jobDurationMs: 5000 });
  mock.start(port).then((url) => {
    console.log(
      `LSAF mock server: set "SAS.lsaf.url" to ${url} and sign in as demo / demo.`,
    );
  });
}
