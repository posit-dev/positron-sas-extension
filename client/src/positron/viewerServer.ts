// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// A small local HTTP server for HTML pages shown in Positron's Viewer whose
// links act in Positron. A page is opened as a URL preview (which Posit
// Assistant can read, unlike a webview); its links point back to this server,
// which hands the link target to the extension and answers 204 No Content,
// so the page stays where it is.
//
// It listens on 127.0.0.1 only, and every path starts with a random token, so
// other local pages cannot use it. No vscode import: it is tested directly.
import { randomBytes } from "crypto";
import { IncomingMessage, Server, ServerResponse, createServer } from "http";

/** Response to one request; separate from HTTP so it is easy to test. */
export interface ViewerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Pages are static: inline styles, no scripts, nothing loaded from elsewhere.
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export class ViewerServer {
  private readonly token = randomBytes(16).toString("hex");
  private readonly pages = new Map<string, string>();
  private count = 0;
  private listening: Promise<number> | undefined;
  private server: Server | undefined;

  constructor(
    /** Act on a link target; false when the target is not acceptable. */
    private readonly onOpen: (target: string) => Promise<boolean> | boolean,
    private readonly keep = 10,
  ) {}

  /**
   * Store a page and return its URL on this machine. Turn it into the URL
   * the Viewer can reach with env.asExternalUri (port forwarding in Posit
   * Workbench). Links in the page reach `onOpen` through `linkTo`.
   */
  async publish(html: string, name = "page"): Promise<string> {
    const port = await this.start();
    const id = `${++this.count}-${name.replace(/[^\w.-]+/g, "-")}.html`;
    this.pages.set(id, html);
    for (const old of this.pages.keys()) {
      if (this.pages.size <= this.keep) {
        break;
      }
      this.pages.delete(old);
    }
    return `http://127.0.0.1:${port}/${this.token}/page/${encodeURIComponent(id)}`;
  }

  /**
   * The href for a link to `target` in a published page. Relative, so it
   * also works when the page is reached through a forwarding proxy.
   */
  static linkTo(target: string): string {
    return `../open?target=${encodeURIComponent(target)}`;
  }

  /** Answer a request; the HTTP server calls this. */
  async handle(method: string, url: string): Promise<ViewerResponse> {
    const notFound = { status: 404, headers: {}, body: "" };
    if (method !== "GET" && method !== "HEAD") {
      return { status: 405, headers: { Allow: "GET, HEAD" }, body: "" };
    }
    const parsed = new URL(url, "http://127.0.0.1");
    const [token, kind, id] = parsed.pathname.split("/").filter(Boolean);
    if (token !== this.token) {
      return notFound;
    }
    if (kind === "page" && id) {
      const html = this.pages.get(decodeURIComponent(id));
      return html === undefined
        ? notFound
        : { status: 200, headers: PAGE_HEADERS, body: html };
    }
    if (kind === "open" && !id) {
      const target = parsed.searchParams.get("target");
      const ok = !!target && (await this.onOpen(target));
      // 204: the browser stays on the page that had the link.
      return { status: ok ? 204 : 400, headers: {}, body: "" };
    }
    return notFound;
  }

  dispose(): void {
    this.server?.close();
    this.server = undefined;
    this.listening = undefined;
    this.pages.clear();
  }

  private start(): Promise<number> {
    this.listening ??= new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => this.respond(req, res));
      server.once("error", (error) => {
        this.listening = undefined;
        reject(error);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          this.listening = undefined;
          reject(new Error("The Viewer server has no port."));
          return;
        }
        this.server = server;
        // Let the extension host exit with the server still open.
        server.unref();
        resolve(address.port);
      });
    });
    return this.listening;
  }

  private respond(req: IncomingMessage, res: ServerResponse): void {
    this.handle(req.method ?? "GET", req.url ?? "/")
      .catch(() => ({ status: 500, headers: {}, body: "" }))
      .then(({ status, headers, body }) => {
        res.writeHead(status, headers);
        res.end(req.method === "HEAD" ? undefined : body);
      });
  }
}
