// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  AgentAuthMethod,
  AuthHandlerMiddleware,
  AuthenticationType,
  ConnectConfig,
  KeyboardInteractiveAuthMethod,
  PasswordAuthMethod,
  PublicKeyAuthMethod,
} from "ssh2";

import { AuthHandler } from "./auth";
import {
  CONNECT_READY_TIMEOUT,
  KEEPALIVE_INTERVAL,
  KEEPALIVE_UNANSWERED_THRESHOLD,
} from "./const";

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKeyFilePath?: string;
}

/**
 * The ssh2 connect options for a profile, with the same timeouts,
 * keepalives and authentication as the SSH session: a private key file,
 * then the SSH agent, a password or keyboard-interactive prompts.
 * `onError` gets errors from the prompts.
 */
export function sshConnectConfig(
  config: SSHConnectionConfig,
  onError: (error: unknown) => void,
  authHandler = new AuthHandler(),
): ConnectConfig {
  const authenticate = createAuthMiddleware(config, authHandler, onError);
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: CONNECT_READY_TIMEOUT,
    keepaliveInterval: KEEPALIVE_INTERVAL,
    keepaliveCountMax: KEEPALIVE_UNANSWERED_THRESHOLD,
    authHandler: (methodsLeft, partialSuccess, callback) => (
      authenticate(methodsLeft, partialSuccess, callback),
      undefined
    ),
  };
}

/** The authentication of `SSHSession.handleSSHAuthentication`, for one connection. */
function createAuthMiddleware(
  config: SSHConnectionConfig,
  authHandler: AuthHandler,
  onError: (error: unknown) => void,
): AuthHandlerMiddleware {
  // ssh2 stops authenticating when it's given false.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const END_AUTH = false as unknown as AuthenticationType;
  let remaining: AuthenticationType[] = [];
  return async (authsLeft, partialSuccess, nextAuth) => {
    if (!authsLeft) {
      // "none" makes the server send the methods it supports.
      return nextAuth({ type: "none", username: config.username });
    }
    if (authsLeft.length === 0) {
      return nextAuth(END_AUTH);
    }
    if (remaining.length === 0 || partialSuccess) {
      remaining = [...authsLeft];
    }
    const authMethod = remaining.shift();
    try {
      let authPayload:
        | PublicKeyAuthMethod
        | AgentAuthMethod
        | PasswordAuthMethod
        | KeyboardInteractiveAuthMethod
        | undefined;
      switch (authMethod) {
        case "publickey":
          if (config.privateKeyFilePath) {
            authPayload = await authHandler.privateKeyAuth(
              config.privateKeyFilePath,
              config.username,
            );
          } else if (process.env.SSH_AUTH_SOCK) {
            authPayload = authHandler.sshAgentAuth(config.username);
          }
          break;
        case "password":
          authPayload = await authHandler.passwordAuth(config.username);
          break;
        case "keyboard-interactive":
          authPayload = await authHandler.keyboardInteractiveAuth(
            config.username,
          );
          break;
        default:
          return nextAuth(authMethod);
      }
      // Without a key file or agent, the payload is undefined, and ssh2
      // skips to the next method.
      return nextAuth(authPayload);
    } catch (e) {
      onError(e);
      return nextAuth(END_AUTH);
    }
  };
}
