// Copyright © 2022-2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  CancellationTokenSource,
  LogOutputChannel,
  Uri,
  env,
  l10n,
  window,
} from "vscode";

import axios from "axios";
import { createHash } from "crypto";
import { URLSearchParams } from "url";

import { Config } from ".";
import { getExtensionId } from "../../components/ExtensionContext";
import { RootApi } from "./api/compute";
import { Configuration } from "./api/configuration";

let authLog: LogOutputChannel | undefined;
const getAuthLog = () =>
  (authLog ??= window.createOutputChannel("SAS Authentication", { log: true }));

/** Mask OAuth codes and PKCE values before logging a URI or query string. */
const redact = (value: string) =>
  value.replace(/(code(?:_challenge)?=)[^&]+/g, "$1<redacted>");

interface Tokens {
  access_token: string;
  refresh_token: string;
}

export async function refreshToken(
  config: Config,
  tokens: Tokens,
): Promise<Tokens | undefined> {
  const clientId = config.clientId || "vscode";
  const clientSecret = config.clientSecret ?? "";
  const rootApi = RootApi(
    new Configuration({
      basePath: config.endpoint + "/compute",
      accessToken: tokens.access_token,
    }),
  );
  await rootApi.headersForRoot({ timeout: 15000 }).catch((err) => {
    if (err.response?.status === 401) {
      // token expired, try refresh token
      return axios
        .post(
          `${config.endpoint}/SASLogon/oauth/token`,
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: tokens?.refresh_token,
          }).toString(),
          { timeout: 15000 },
        )
        .then(
          (res) => {
            tokens = res.data;
          },
          () => {
            // refresh token failed, has to login again
            tokens = undefined;
          },
        );
    }
    throw err;
  });

  return tokens;
}

export async function getTokens(
  config: Config,
  tokens?: Tokens,
): Promise<Tokens> {
  const clientId = config.clientId || "vscode";
  const clientSecret = config.clientSecret ?? "";

  const { codeVerifier, codeChallenge } = getPKCE();

  // URI handler callbacks are routed by extension ID, so this must match the
  // running extension (not the upstream SAS.sas-lsp ID).
  const callbackUrl = await env.asExternalUri(
    Uri.parse(`${env.uriScheme}://${getExtensionId()}`),
  );

  const log = getAuthLog();
  log.info(`Callback URL: ${callbackUrl.toString(true)}`);

  // Register before opening the browser: with an existing SSO session
  // SASLogon may redirect back before openExternal resolves.
  const cancellationToken = new CancellationTokenSource();
  let authCode: string | undefined;
  const handler = window.registerUriHandler({
    handleUri: (uri) => {
      log.info(`Received URI: ${redact(uri.toString(true))}`);
      const code = new URLSearchParams(uri.query).get("code");
      if (code) {
        authCode = code;
        cancellationToken.cancel();
      } else {
        log.warn("Received URI has no authorization code");
      }
    },
  });
  log.info("URI handler registered");

  const params = new URLSearchParams([
    ["client_id", clientId],
    ["response_type", "code"],
    ["code_challenge_method", "S256"],
    ["code_challenge", codeChallenge],
    ["state", encodeURIComponent(callbackUrl.toString(true))],
  ]);
  const authorizeUrl = `${config.endpoint}/SASLogon/oauth/authorize?${params.toString()}`;
  log.info(`Opening ${redact(authorizeUrl)}`);
  await env.openExternal(Uri.parse(authorizeUrl));

  const inputCode = await window.showInputBox(
    {
      placeHolder: l10n.t("Paste authorization code here"),
      password: true,
      ignoreFocusOut: true,
    },
    cancellationToken.token,
  );
  handler.dispose();
  log.info(
    authCode
      ? "Authorization code received via URI handler"
      : inputCode
        ? "Authorization code pasted by user"
        : "Sign-in cancelled: no authorization code",
  );
  if (!authCode && inputCode) {
    authCode = inputCode;
  }
  if (!authCode) {
    throw new Error(l10n.t("No authorization code"));
  }

  tokens = (
    await axios.post(
      `${config.endpoint}/SASLogon/oauth/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: codeVerifier,
      }).toString(),
      { timeout: 15000 },
    )
  ).data;
  return tokens;
}

function getPKCE() {
  // Refers to https://www.rfc-editor.org/rfc/rfc7636
  const LENGTH = 128;
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let codeVerifier = "";
  for (let i = 0; i < LENGTH; i++) {
    codeVerifier += possible.charAt(
      Math.floor(Math.random() * possible.length),
    );
  }
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return { codeVerifier, codeChallenge };
}
