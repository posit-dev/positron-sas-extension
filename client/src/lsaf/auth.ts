// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Signing in to LSAF. The password is asked for once and exchanged for its
// encrypted form (`GET /encrypt`); only that is kept, in VS Code's secret
// storage, so expired API sessions are renewed without asking again. If the
// server can't encrypt, the clear password is used for that session only.
import {
  Disposable,
  EventEmitter,
  ExtensionContext,
  LogOutputChannel,
  ProgressLocation,
  commands,
  l10n,
  window,
  workspace,
} from "vscode";

import { getSecretStorage } from "../components/ExtensionContext";
import { LsafClient, LsafError, describeError } from "./LsafClient";
import { SECRET_NAMESPACE, SIGNED_IN_CONTEXT_KEY, USER_SETTING } from "./const";
import { Messages } from "./messages";
import { axiosTransport } from "./transport";

const lastUserKey = (apiUrl: string) => `lsaf.lastUser:${apiUrl}`;
const secretKey = (apiUrl: string, userId: string) => `${apiUrl}|${userId}`;

export class LsafSession implements Disposable {
  private client: LsafClient | undefined;
  private url: string | undefined;
  private readonly secrets = getSecretStorage<string>(SECRET_NAMESPACE);
  private readonly _onDidChange = new EventEmitter<void>();
  /** Fires on sign-in, sign-out and server changes. */
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: ExtensionContext,
    private readonly output: LogOutputChannel,
  ) {}

  get apiUrl(): string | undefined {
    return this.url;
  }

  get userId(): string | undefined {
    return this.client?.signedIn ? this.client.userId : undefined;
  }

  get signedIn(): boolean {
    return !!this.client?.signedIn;
  }

  /** The signed-in client; throws when not signed in. */
  getClient(): LsafClient {
    if (!this.client?.signedIn) {
      throw new Error(Messages.NotSignedIn);
    }
    return this.client;
  }

  /** The detected server changed: drop the old session, resume the new one. */
  async setApiUrl(apiUrl: string | undefined): Promise<void> {
    if (apiUrl === this.url) {
      return;
    }
    await this.client?.logoff();
    this.client = undefined;
    this.url = apiUrl;
    await this.update();
    if (apiUrl) {
      await this.restore();
    }
  }

  /** Log on silently with a stored encrypted password, if there is one. */
  private async restore(): Promise<boolean> {
    const apiUrl = this.url;
    if (!apiUrl) {
      return false;
    }
    const userId = this.context.globalState.get<string>(lastUserKey(apiUrl));
    if (!userId) {
      return false;
    }
    const secret = await this.secrets.get(secretKey(apiUrl, userId));
    if (!secret) {
      return false;
    }
    const client = this.newClient(apiUrl);
    client.setCredentials({ userId, secret });
    try {
      await client.logon();
    } catch (error) {
      this.output.warn(
        `Resuming the LSAF session of ${userId} failed: ${describeError(error)}`,
      );
      if (error instanceof LsafError && error.status === 401) {
        // The stored password no longer works (changed, or the account is
        // locked): forget it, so the next sign-in asks.
        await this.deleteSecret(apiUrl, userId);
      }
      return false;
    }
    if (this.url !== apiUrl) {
      return false;
    }
    this.client = client;
    await this.update();
    return true;
  }

  async signIn(): Promise<boolean> {
    const apiUrl = this.url;
    if (!apiUrl) {
      window.showErrorMessage(Messages.NotDetected);
      return false;
    }
    // The stored password may still work if resuming at startup failed only
    // because the server was unreachable then.
    if (await this.restore()) {
      return true;
    }
    const userId = await window.showInputBox({
      title: Messages.SignInTitle,
      prompt: l10n.t(Messages.UserIdPrompt, { url: apiUrl }),
      value:
        this.context.globalState.get<string>(lastUserKey(apiUrl)) ??
        workspace.getConfiguration().get<string>(USER_SETTING, ""),
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() ? undefined : Messages.UserIdRequired,
    });
    if (!userId?.trim()) {
      return false;
    }
    const password = await window.showInputBox({
      title: Messages.SignInTitle,
      prompt: l10n.t(Messages.PasswordPrompt, { user: userId.trim() }),
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) {
      return false;
    }
    return window.withProgress(
      { location: ProgressLocation.Notification, title: Messages.SigningIn },
      () => this.logon(apiUrl, userId.trim(), password),
    );
  }

  private async logon(
    apiUrl: string,
    userId: string,
    password: string,
  ): Promise<boolean> {
    const client = this.newClient(apiUrl);
    let secret: string | undefined;
    try {
      secret = await client.encrypt(userId, password);
    } catch (error) {
      if (error instanceof LsafError && error.status === 401) {
        window.showErrorMessage(
          l10n.t(Messages.SignInFailed, { message: describeError(error) }),
        );
        return false;
      }
      // Encryption unavailable: log on with the clear password, keep nothing.
      this.output.warn(
        `Encrypting the password failed, so it won't be remembered: ${describeError(error)}`,
      );
    }
    client.setCredentials({ userId, secret: secret ?? password });
    try {
      await client.logon();
    } catch (error) {
      window.showErrorMessage(
        l10n.t(Messages.SignInFailed, { message: describeError(error) }),
      );
      return false;
    }
    await this.client?.logoff();
    this.client = client;
    await this.context.globalState.update(lastUserKey(apiUrl), userId);
    if (secret) {
      await this.secrets.store(secretKey(apiUrl, userId), secret);
    } else {
      await this.deleteSecret(apiUrl, userId);
      window.showWarningMessage(Messages.PasswordNotRemembered);
    }
    await this.update();
    return true;
  }

  async signOut(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) {
      await client.logoff();
      if (this.url && client.userId) {
        await this.deleteSecret(this.url, client.userId);
      }
    }
    await this.update();
  }

  private newClient(apiUrl: string): LsafClient {
    return new LsafClient(apiUrl, axiosTransport(apiUrl), undefined, (m) =>
      this.output.info(m),
    );
  }

  private async deleteSecret(apiUrl: string, userId: string): Promise<void> {
    const data = (await this.secrets.getNamespaceData()) ?? {};
    const key = secretKey(apiUrl, userId);
    if (key in data) {
      delete data[key];
      await this.secrets.setNamespaceData(data);
    }
  }

  private async update(): Promise<void> {
    await commands.executeCommand(
      "setContext",
      SIGNED_IN_CONTEXT_KEY,
      this.signedIn,
    );
    this._onDidChange.fire();
  }

  dispose(): void {
    void this.client?.logoff();
    this._onDidChange.dispose();
  }
}
