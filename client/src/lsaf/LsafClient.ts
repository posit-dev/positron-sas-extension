// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// An authenticated SAS Life Science Analytics Framework REST API session.
//
// Logon is HTTP Basic (`POST /logon`) with the user id and either the clear
// or the encrypted password (`GET /encrypt`); the response's X-Auth-Token
// header authenticates every later request. API sessions expire after a
// period of inactivity, so a 401 logs on again once and replays the request.
//
// The HTTP layer is a plain function so this is unit tested without a server
// and without `vscode`.
import { ERROR_MEDIA_TYPE } from "./const";
import type { ActionResult, ActionResults, ErrorBody } from "./types";

export type Params = Record<string, string | number | boolean | undefined>;

export interface HttpRequest {
  method: "GET" | "POST" | "PUT";
  /** Relative to the API root, such as `/repository/files/a/b.sas`. */
  url: string;
  params?: Params;
  headers?: Record<string, string>;
  /** A JSON value, a FormData, or nothing. */
  data?: unknown;
}

export interface HttpResponse {
  status: number;
  /** Header names in lower case. */
  headers: Record<string, string>;
  data: Uint8Array;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export interface Credentials {
  userId: string;
  /** The `{P21}…` encrypted password, or the clear one. */
  secret: string;
}

/** An error response from LSAF, or a response that can't be used. */
export class LsafError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ErrorBody,
  ) {
    super(message);
    this.name = "LsafError";
  }

  get errorCode(): number | undefined {
    return this.body?.errorCode;
  }

  get remediation(): string | undefined {
    return this.body?.remediation;
  }
}

/** An action the server answered 200 to, but with a warning or failure. */
export class LsafActionError extends Error {
  constructor(
    message: string,
    readonly kind: "warning" | "failure",
    readonly code?: number,
  ) {
    super(message);
    this.name = "LsafActionError";
  }
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof LsafError && error.status === 404;

/** The best message for an error, with the server's remediation if any. */
export function describeError(error: unknown): string {
  if (error instanceof LsafError) {
    const parts = [error.message];
    if (error.body?.details?.length) {
      parts.push(error.body.details.join(" "));
    }
    if (error.remediation) {
      parts.push(error.remediation);
    }
    return parts.join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

export const basicAuth = (userId: string, secret: string): string =>
  `Basic ${Buffer.from(`${userId}:${secret}`, "utf8").toString("base64")}`;

const decoder = new TextDecoder();

export const textOf = (data: Uint8Array): string => decoder.decode(data);

/** Parse a JSON response body; undefined when it is empty. */
export function parseJson<T>(response: HttpResponse, url: string): T {
  const text = textOf(response.data).trim();
  if (!text) {
    return undefined;
  }
  try {
    const value: T = JSON.parse(text);
    return value;
  } catch {
    throw new LsafError(
      `The LSAF server's answer to ${url} is not JSON.`,
      response.status,
    );
  }
}

/** The error a failed response stands for. */
export function errorFromResponse(
  request: Pick<HttpRequest, "method" | "url">,
  response: HttpResponse,
): LsafError {
  let body: ErrorBody | undefined;
  const contentType = response.headers["content-type"] ?? "";
  if (/json/i.test(contentType)) {
    try {
      const parsed = JSON.parse(textOf(response.data));
      if (parsed && typeof parsed === "object") {
        body = parsed;
      }
    } catch {
      body = undefined;
    }
  }
  const message =
    body?.message ||
    `${request.method} ${request.url} failed with HTTP status ${response.status}.`;
  return new LsafError(message, response.status, body);
}

/**
 * The encrypted password from a `GET /encrypt` body. The spec gives both a
 * bare JSON string and `{ "encryptedPassword": … }` as examples, and a server
 * may send it as plain text.
 */
export function parseEncryptedPassword(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  let value: unknown = trimmed;
  try {
    value = JSON.parse(trimmed);
  } catch {
    value = trimmed;
  }
  if (
    value &&
    typeof value === "object" &&
    "encryptedPassword" in value &&
    typeof value.encryptedPassword === "string"
  ) {
    value = value.encryptedPassword;
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Throw when an action result reports a warning or failure: action
 * endpoints answer 200 either way. "success" and "started" pass, as do
 * status types the spec doesn't list.
 */
export function checkAction(result: ActionResult | undefined, what: string) {
  const type = (result?.status?.type ?? "").toLowerCase();
  if (type === "warning" || type === "failure" || type === "error") {
    const message = result?.status?.message
      ? `${what}: ${result.status.message}`
      : `${what}: the server reported ${type}${result?.status?.code ? ` (${result.status.code})` : ""}.`;
    throw new LsafActionError(
      message,
      type === "warning" ? "warning" : "failure",
      result?.status?.code,
    );
  }
}

/** The same for a batch result, such as uploading and expanding a zip. */
export function checkActions(result: ActionResults | undefined, what: string) {
  for (const [outcome, kind] of [
    [result?.failures, "failure"],
    [result?.warnings, "warning"],
  ] as const) {
    if (outcome?.count) {
      const messages = (outcome.items ?? [])
        .map((item) => item.status?.message)
        .filter(Boolean);
      throw new LsafActionError(
        `${what}: ${messages.length ? messages.join(" ") : `${outcome.count} ${kind === "failure" ? "failures" : "warnings"}.`}`,
        kind,
      );
    }
  }
}

export class LsafClient {
  private token: string | undefined;
  private pendingLogon: Promise<string> | undefined;

  constructor(
    readonly apiUrl: string,
    private readonly transport: HttpTransport,
    private credentials?: Credentials,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get userId(): string | undefined {
    return this.credentials?.userId;
  }

  get signedIn(): boolean {
    return this.token !== undefined;
  }

  setCredentials(credentials: Credentials | undefined): void {
    this.credentials = credentials;
    this.token = undefined;
  }

  /** Encrypt a password for later logons (`GET /encrypt`). */
  async encrypt(userId: string, password: string): Promise<string> {
    const request: HttpRequest = {
      method: "GET",
      url: "/encrypt",
      headers: {
        Authorization: basicAuth(userId, password),
        Accept: `application/json, text/plain, ${ERROR_MEDIA_TYPE}`,
      },
    };
    const response = await this.transport(request);
    if (response.status >= 400) {
      throw errorFromResponse(request, response);
    }
    const encrypted = parseEncryptedPassword(textOf(response.data));
    if (!encrypted) {
      throw new LsafError(
        "The LSAF server did not return an encrypted password.",
        response.status,
      );
    }
    return encrypted;
  }

  /** Log on with the credentials and keep the session token. */
  async logon(): Promise<void> {
    this.token = undefined;
    await this.ensureToken();
  }

  private ensureToken(): Promise<string> {
    if (this.token) {
      return Promise.resolve(this.token);
    }
    // Requests that find the token expired at the same time share one logon.
    this.pendingLogon ??= this.doLogon().finally(() => {
      this.pendingLogon = undefined;
    });
    return this.pendingLogon;
  }

  private async doLogon(): Promise<string> {
    const credentials = this.credentials;
    if (!credentials) {
      throw new LsafError("Not signed in to LSAF.", 401);
    }
    const request: HttpRequest = {
      method: "POST",
      url: "/logon",
      headers: {
        Authorization: basicAuth(credentials.userId, credentials.secret),
        Accept: `application/json, ${ERROR_MEDIA_TYPE}`,
      },
    };
    const response = await this.transport(request);
    if (response.status >= 400) {
      throw errorFromResponse(request, response);
    }
    const token = response.headers["x-auth-token"];
    if (!token) {
      throw new LsafError(
        "The LSAF server accepted the logon but sent no X-Auth-Token header.",
        response.status,
      );
    }
    this.log(`Logged on to ${this.apiUrl} as ${credentials.userId}.`);
    this.token = token;
    return token;
  }

  /** End the session (`POST /logoff`); errors are only logged. */
  async logoff(): Promise<void> {
    const token = this.token;
    this.token = undefined;
    if (!token) {
      return;
    }
    try {
      await this.transport({
        method: "POST",
        url: "/logoff",
        headers: { "X-Auth-Token": token },
      });
    } catch (error) {
      this.log(`Logoff failed: ${describeError(error)}`);
    }
  }

  /**
   * Send an authenticated request. A 401 logs on again once and replays the
   * request; any other status of 400 or above throws an LsafError.
   */
  async request(request: HttpRequest): Promise<HttpResponse> {
    let token = await this.ensureToken();
    let response = await this.send(request, token);
    if (response.status === 401) {
      this.log(
        `${request.method} ${request.url}: session expired, logging on again.`,
      );
      if (this.token === token) {
        this.token = undefined;
      }
      token = await this.ensureToken();
      response = await this.send(request, token);
    }
    if (response.status >= 400) {
      throw errorFromResponse(request, response);
    }
    return response;
  }

  private send(request: HttpRequest, token: string): Promise<HttpResponse> {
    return this.transport({
      ...request,
      headers: {
        Accept: `application/json, ${ERROR_MEDIA_TYPE}`,
        ...request.headers,
        "X-Auth-Token": token,
      },
    });
  }

  async getJson<T>(url: string, params?: Params): Promise<T> {
    const response = await this.request({ method: "GET", url, params });
    return parseJson<T>(response, url);
  }

  async getBytes(url: string, params?: Params): Promise<Uint8Array> {
    const response = await this.request({
      method: "GET",
      url,
      params,
      headers: { Accept: "*/*" },
    });
    return response.data;
  }

  async putJson<T>(url: string, params?: Params, data?: unknown): Promise<T> {
    const response = await this.request({ method: "PUT", url, params, data });
    return parseJson<T>(response, url);
  }

  async postJson<T>(url: string, params?: Params, data?: unknown): Promise<T> {
    const response = await this.request({ method: "POST", url, params, data });
    return parseJson<T>(response, url);
  }
}
