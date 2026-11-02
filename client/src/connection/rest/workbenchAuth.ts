// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Sign in to SAS Viya with the OAuth token that Posit Workbench manages for
// the user (a Workbench custom OAuth integration). This module talks to the
// Workbench session RPC and does not use the vscode API, so it can be unit
// tested without a VS Code host.
import axios from "axios";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type ViyaAuthenticationMode = "auto" | "workbench" | "sasLogon";

const DEFAULT_RPC_SOCKET =
  "/run/rstudio-server/rstudio-rserver/session-server-rpc.socket";
const COOKIE_HEADER = "X-RS-Session-Server-RPC-Cookie";
const RPC_TIMEOUT_MS = 15000;
/** A token that expires within this window is treated as expired. */
export const EXPIRY_MARGIN_MS = 30 * 1000;

export interface WorkbenchRpcTarget {
  /** Base URL (RS_SERVER_ADDRESS), or undefined when using the socket. */
  baseUrl?: string;
  /** Unix socket path, when RS_SERVER_ADDRESS is not set. */
  socketPath?: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

const nullLogger: Logger = { info: () => {}, warn: () => {} };

/**
 * Read the session RPC cookie. The file in PWB_SESSION_RUNTIME_DIR wins over
 * the environment because Workbench rotates it; read it on every call.
 */
export function readRpcCookie(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.PWB_SESSION_RUNTIME_DIR) {
    try {
      const cookie = readFileSync(
        join(env.PWB_SESSION_RUNTIME_DIR, "rpc_cookie"),
        "utf8",
      ).trim();
      if (cookie) {
        return cookie;
      }
    } catch {
      // Fall back to the environment.
    }
  }
  return env.RS_SESSION_RPC_COOKIE || undefined;
}

/**
 * Where to send session RPCs, or undefined outside Posit Workbench (no RPC
 * cookie, or neither a server address nor the RPC socket).
 */
export function detectWorkbench(
  env: NodeJS.ProcessEnv = process.env,
  socketExists: (path: string) => boolean = existsSync,
): WorkbenchRpcTarget | undefined {
  if (!readRpcCookie(env)) {
    return undefined;
  }
  if (env.RS_SERVER_ADDRESS) {
    return { baseUrl: env.RS_SERVER_ADDRESS.replace(/\/+$/, "") };
  }
  const socketPath = env.RS_SERVER_RPC_SOCKET_PATH || DEFAULT_RPC_SOCKET;
  return socketExists(socketPath) ? { socketPath } : undefined;
}

export class WorkbenchRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchRpcError";
  }
}

/** Remove the given secrets, bearer tokens, and JWTs from text before logging. */
export function redact(text: string, secrets: (string | undefined)[] = []) {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("<redacted>");
    }
  }
  return out
    .replace(/(Bearer\s+)[^\s"',]+/gi, "$1<redacted>")
    .replace(
      /("?(?:access_token|refresh_token|id_token|rpc_cookie)"?\s*[:=]\s*"?)[^"&\s,}]+/gi,
      "$1<redacted>",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
      "<redacted>",
    );
}

/** POST a session RPC and return the parsed JSON body. */
export async function rpc(
  target: WorkbenchRpcTarget,
  method: string,
  kwparams: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const cookie = readRpcCookie(env);
  if (!cookie) {
    throw new WorkbenchRpcError(
      "No Posit Workbench session RPC cookie available",
    );
  }
  let response;
  try {
    response = await axios.request<string>({
      method: "POST",
      url: target.socketPath
        ? `http://localhost${method}`
        : `${target.baseUrl}${method}`,
      socketPath: target.socketPath,
      headers: {
        "Content-Type": "application/json",
        [COOKIE_HEADER]: cookie,
      },
      data: JSON.stringify({ method, kwparams }),
      responseType: "text",
      transformResponse: (data) => data,
      validateStatus: () => true,
      // The Workbench server is reached directly, never through a proxy.
      proxy: false,
      timeout: RPC_TIMEOUT_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkbenchRpcError(
      `Workbench RPC ${method} failed: ${redact(message, [cookie])}`,
    );
  }
  if (response.status !== 200) {
    throw new WorkbenchRpcError(
      `Workbench RPC ${method} returned HTTP ${response.status}`,
    );
  }
  const contentType = String(response.headers?.["content-type"] ?? "");
  if (!contentType.startsWith("application/json")) {
    throw new WorkbenchRpcError(
      `Workbench RPC ${method} returned a non-JSON response`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(response.data);
  } catch {
    throw new WorkbenchRpcError(
      `Workbench RPC ${method} returned invalid JSON`,
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WorkbenchRpcError(
      `Workbench RPC ${method} returned an unexpected response`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return body as Record<string, unknown>;
}

function rpcErrorMessage(method: string, error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : JSON.stringify(error);
  return `Workbench RPC ${method} returned an error: ${redact(message)}`;
}

export interface WorkbenchIntegration {
  uid?: string;
  name?: string;
  display_name?: string;
  type?: string;
  client_id?: string;
  auth_url?: string;
  token_url?: string;
  scopes?: string[];
  issuer?: string;
  authenticated?: boolean;
}

/** List the user's OAuth integrations (all providers, flattened). */
export async function listIntegrations(
  target: WorkbenchRpcTarget,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkbenchIntegration[]> {
  const method = "/oauth_integrations";
  const body = await rpc(target, method, {}, env);
  if (body.error) {
    throw new WorkbenchRpcError(rpcErrorMessage(method, body.error));
  }
  const providers = Array.isArray(body.providers) ? body.providers : [];
  const integrations: WorkbenchIntegration[] = [];
  for (const provider of providers) {
    if (provider && Array.isArray(provider.integrations)) {
      integrations.push(...provider.integrations);
    }
  }
  return integrations;
}

export interface WorkbenchToken {
  accessToken: string;
  /** Milliseconds since the epoch, or undefined if Workbench sent none. */
  expiry?: number;
}

/**
 * Get the access token for an integration. Returns undefined when the user
 * has no token for it.
 */
export async function getToken(
  target: WorkbenchRpcTarget,
  uuid: string,
  options: { force?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkbenchToken | undefined> {
  const method = "/oauth_token";
  const body = await rpc(
    target,
    method,
    { uuid, force_refresh: !!options.force },
    env,
  );
  if (body.error) {
    throw new WorkbenchRpcError(rpcErrorMessage(method, body.error));
  }
  if (body.result !== true || typeof body.access_token !== "string") {
    return undefined;
  }
  if (!body.access_token) {
    return undefined;
  }
  const expiry =
    typeof body.expiry === "string" ? Date.parse(body.expiry) : NaN;
  return {
    accessToken: body.access_token,
    expiry: isNaN(expiry) ? undefined : expiry,
  };
}

export function isExpired(token: WorkbenchToken, now = Date.now()): boolean {
  return token.expiry !== undefined && token.expiry - EXPIRY_MARGIN_MS <= now;
}

function normalizeUrl(value: string, base?: string): string | undefined {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    // URL lowercases the scheme and host and drops default ports.
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

/** The SAS Logon token URL for a SAS Viya endpoint. */
export function sasLogonTokenUrl(endpoint: string): string | undefined {
  return normalizeUrl("/SASLogon/oauth/token", endpoint);
}

export type IntegrationMatch =
  | { kind: "match"; integration: WorkbenchIntegration & { uid: string } }
  | { kind: "none" }
  | { kind: "ambiguous"; integrations: WorkbenchIntegration[] }
  | { kind: "notFound"; guid: string };

/**
 * Find the integration for a SAS Viya endpoint. An explicit GUID wins;
 * otherwise exactly one integration whose token URL is the endpoint's SAS
 * Logon token URL.
 */
export function findIntegration(
  endpoint: string,
  integrations: WorkbenchIntegration[],
  explicitGuid?: string,
): IntegrationMatch {
  const withUid = integrations.filter(
    (i): i is WorkbenchIntegration & { uid: string } =>
      typeof i.uid === "string" && i.uid !== "",
  );
  if (explicitGuid) {
    const guid = explicitGuid.trim().toLowerCase();
    const found = withUid.find((i) => i.uid.toLowerCase() === guid);
    return found
      ? { kind: "match", integration: found }
      : { kind: "notFound", guid: explicitGuid };
  }
  const expected = sasLogonTokenUrl(endpoint);
  if (!expected) {
    return { kind: "none" };
  }
  const matches = withUid.filter(
    (i) => i.token_url && normalizeUrl(i.token_url) === expected,
  );
  if (matches.length === 1) {
    return { kind: "match", integration: matches[0] };
  }
  return matches.length === 0
    ? { kind: "none" }
    : { kind: "ambiguous", integrations: matches };
}

export function integrationLabel(integration: WorkbenchIntegration): string {
  return integration.display_name || integration.name || integration.uid || "";
}

export type WorkbenchAuthOutcome =
  /** Use this Workbench token. */
  | {
      kind: "token";
      integration: WorkbenchIntegration & { uid: string };
      token: WorkbenchToken;
    }
  /** auto: a matching integration exists but the user is not signed in. */
  | { kind: "signInRequired"; integration: WorkbenchIntegration }
  /** Use SAS Logon (auto mode without a usable integration, or sasLogon). */
  | { kind: "sasLogon" }
  /** workbench mode: no token, with the reason. */
  | { kind: "error"; reason: WorkbenchAuthErrorReason; detail?: string };

export type WorkbenchAuthErrorReason =
  | "notInWorkbench"
  | "rpcFailed"
  | "noIntegration"
  | "ambiguous"
  | "notFound"
  | "signInRequired";

export interface ResolveOptions {
  mode: ViyaAuthenticationMode | undefined;
  endpoint: string;
  workbenchIntegration?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  socketExists?: (path: string) => boolean;
  log?: Logger;
  now?: () => number;
}

/** Decide how to authenticate a SAS Viya profile and get the Workbench token. */
export async function resolveWorkbenchAuth(
  options: ResolveOptions,
): Promise<WorkbenchAuthOutcome> {
  const mode = options.mode ?? "auto";
  const log = options.log ?? nullLogger;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  if (mode === "sasLogon") {
    return { kind: "sasLogon" };
  }
  const strict = mode === "workbench";
  const fail = (
    reason: WorkbenchAuthErrorReason,
    detail?: string,
  ): WorkbenchAuthOutcome =>
    strict ? { kind: "error", reason, detail } : { kind: "sasLogon" };

  const target = detectWorkbench(env, options.socketExists);
  if (!target) {
    if (strict) {
      log.warn("Not running in Posit Workbench (no session RPC credentials)");
    }
    return fail("notInWorkbench");
  }

  let integrations: WorkbenchIntegration[];
  try {
    integrations = await listIntegrations(target, env);
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err));
    log.warn(`Could not list Posit Workbench OAuth integrations: ${detail}`);
    return fail("rpcFailed", detail);
  }

  const match = findIntegration(
    options.endpoint,
    integrations,
    options.workbenchIntegration,
  );
  if (match.kind !== "match") {
    if (match.kind === "ambiguous") {
      const names = match.integrations.map(integrationLabel).join(", ");
      log.warn(
        `Several Posit Workbench OAuth integrations match ${options.endpoint} (${names}); set "workbenchIntegration" in the profile`,
      );
      return fail("ambiguous", names);
    }
    if (match.kind === "notFound") {
      log.warn(`Posit Workbench OAuth integration ${match.guid} not found`);
      return fail("notFound", match.guid);
    }
    log.info(`No Posit Workbench OAuth integration for ${options.endpoint}`);
    return fail("noIntegration");
  }

  const integration = match.integration;
  const label = integrationLabel(integration);
  const signInRequired = (): WorkbenchAuthOutcome =>
    strict
      ? { kind: "error", reason: "signInRequired", detail: label }
      : { kind: "signInRequired", integration };

  // Workbench reports authenticated=false only after it tried a refresh.
  if (integration.authenticated === false) {
    log.info(`Not signed in to Posit Workbench OAuth integration ${label}`);
    return signInRequired();
  }

  try {
    let token = await getToken(
      target,
      integration.uid,
      { force: options.force },
      env,
    );
    if (token && isExpired(token, now())) {
      // Workbench returns the old token when a refresh fails; try once more.
      token = await getToken(target, integration.uid, { force: true }, env);
    }
    if (!token || isExpired(token, now())) {
      log.info(`No valid token from Posit Workbench integration ${label}`);
      return signInRequired();
    }
    log.info(`Using the Posit Workbench OAuth integration ${label}`);
    return { kind: "token", integration, token };
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err));
    log.warn(`Could not get a token from Posit Workbench: ${detail}`);
    return fail("rpcFailed", detail);
  }
}
