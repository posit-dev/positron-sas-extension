// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationSession,
  ConfigurationChangeEvent,
  Disposable,
  Event,
  EventEmitter,
  commands,
  l10n,
  window,
  workspace,
} from "vscode";

import { profileConfig } from "../commands/profile";
import { ConnectionType, ViyaProfile } from "../components/profile";
import { getAuthLog, getTokens, refreshToken } from "../connection/rest/auth";
import { getApiConfig } from "../connection/rest/common";
import { getCurrentUser } from "../connection/rest/identities";
import {
  WorkbenchAuthErrorReason,
  WorkbenchAuthOutcome,
  integrationLabel,
  resolveWorkbenchAuth,
} from "../connection/rest/workbenchAuth";
import { getSecretStorage } from "./ExtensionContext";

const SECRET_KEY = "SASAuth";

interface SASAuthSession extends AuthenticationSession {
  refreshToken?: string;
}

/** Refresh a Workbench token this long before it expires. */
const WORKBENCH_REFRESH_LEAD_MS = 5 * 60 * 1000;
const WORKBENCH_REFRESH_MIN_DELAY_MS = 30 * 1000;

/**
 * A session backed by a Posit Workbench OAuth integration. The token lives
 * only in memory: Workbench stores and refreshes it.
 */
interface WorkbenchSessionState {
  profileName: string;
  integrationUid: string;
  session: SASAuthSession;
  expiry?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const isUnauthorized = (err: unknown) =>
  !!err &&
  typeof err === "object" &&
  "response" in err &&
  !!err.response &&
  typeof err.response === "object" &&
  "status" in err.response &&
  err.response.status === 401;

export class SASAuthProvider implements AuthenticationProvider, Disposable {
  static id = "SAS";

  private readonly secretStorage;
  private _disposables: Disposable[];
  private _lastSession: SASAuthSession | undefined;
  private _workbench: WorkbenchSessionState | undefined;
  /** Profiles signed out of their Workbench session in this window. */
  private _workbenchSignedOut = new Set<string>();
  /** Profiles where the user chose SAS Logon over Workbench in this window. */
  private _useSasLogon = new Set<string>();
  private _onDidChangeSessions =
    new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
  get onDidChangeSessions(): Event<AuthenticationProviderAuthenticationSessionsChangeEvent> {
    return this._onDidChangeSessions.event;
  }

  constructor() {
    this._disposables = [
      this._onDidChangeSessions,
      workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
        if (event.affectsConfiguration("SAS.connectionProfiles")) {
          this.clearWorkbenchSession();
        }
        if (
          event.affectsConfiguration("SAS.connectionProfiles") &&
          this._lastSession
        ) {
          this._onDidChangeSessions.fire({
            added: [],
            changed: [],
            removed: [this._lastSession],
          });
          this._lastSession = undefined;
        }
      }),
    ];
    this.secretStorage = getSecretStorage<SASAuthSession>(SECRET_KEY);
  }

  dispose(): void {
    this.clearWorkbenchSession();
    for (const d of this._disposables) {
      d.dispose();
    }
  }

  async getSessions(): Promise<AuthenticationSession[]> {
    const sessions = await this._getSessions();
    if (sessions.length === 0) {
      commands.executeCommand("setContext", "SAS.authorized", false);
    } else {
      if (this._lastSession?.id !== sessions[0].id) {
        // have to fire change event so that the Accounts menu can update after switching profile
        this._lastSession = sessions[0];
        this._onDidChangeSessions.fire({
          added: [],
          changed: sessions,
          removed: [],
        });
      }
      commands.executeCommand("setContext", "SAS.authorized", true);
    }
    return [...sessions];
  }

  private async _getSessions(): Promise<readonly AuthenticationSession[]> {
    const activeProfile = profileConfig.getActiveProfileDetail();
    const profile = activeProfile?.profile;
    if (!profile || profile.connectionType !== ConnectionType.Rest) {
      return [];
    }
    const profileName = profileConfig.getActiveProfile();

    const outcome = await this.resolveWorkbench(profile, profileName);
    if (outcome.kind === "token") {
      if (this._workbenchSignedOut.has(profileName)) {
        return [];
      }
      const session = await this.workbenchSession(
        profile,
        profileName,
        outcome,
      );
      return session ? [session] : [];
    }
    this.clearWorkbenchSession();
    if (outcome.kind === "error") {
      return [];
    }

    const sessions = await this.secretStorage.getNamespaceData();
    if (!sessions) {
      return [];
    }
    const session = sessions[profileName];
    if (!session) {
      return [];
    }

    const tokens = await refreshToken(profile, {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (!tokens) {
      // refresh token failed, the stored session is not valid anymore
      await this.removeSession(session.id, true);
      return [];
    }
    const accessToken = tokens.access_token;
    if (accessToken === session.accessToken) {
      return [session];
    }
    const newSession = { ...session, accessToken: tokens.access_token };
    await this.writeSession(newSession);

    return [newSession];
  }

  async createSession(): Promise<AuthenticationSession> {
    const activeProfile = profileConfig.getActiveProfileDetail();
    const profile = activeProfile.profile;

    if (profile.connectionType !== ConnectionType.Rest) {
      return;
    }
    const activeProfileName = profileConfig.getActiveProfile();

    for (;;) {
      const outcome = await this.resolveWorkbench(profile, activeProfileName);
      if (outcome.kind === "token") {
        this._workbenchSignedOut.delete(activeProfileName);
        const session = await this.workbenchSession(
          profile,
          activeProfileName,
          outcome,
        );
        if (!session) {
          throw new Error(
            l10n.t("SAS Viya did not accept the Posit Workbench token."),
          );
        }
        this._lastSession = session;
        this._onDidChangeSessions.fire({
          added: [session],
          changed: [],
          removed: [],
        });
        commands.executeCommand("setContext", "SAS.authorized", true);
        return session;
      }
      if (outcome.kind === "error") {
        throw new Error(workbenchErrorMessage(outcome.reason, outcome.detail));
      }
      if (outcome.kind === "signInRequired") {
        const tryAgain = l10n.t("Try Again");
        const useSasLogon = l10n.t("Use SAS Logon");
        const choice = await window.showWarningMessage(
          l10n.t(
            'Sign in to "{name}" in Posit Workbench (Managed Credentials), then try again.',
            { name: integrationLabel(outcome.integration) },
          ),
          tryAgain,
          useSasLogon,
        );
        if (choice === tryAgain) {
          continue;
        }
        if (choice !== useSasLogon) {
          throw new Error(l10n.t("Sign-in cancelled"));
        }
        this._useSasLogon.add(activeProfileName);
      }
      break;
    }

    const { access_token: accessToken, refresh_token: refreshToken } =
      await getTokens(profile);
    const user = await getCurrentUser({
      endpoint: profile.endpoint,
      accessToken,
    });
    const profileName = profileConfig.getActiveProfile();
    const session: SASAuthSession = {
      id: profileName,
      account: { id: user.id, label: user.name },
      accessToken,
      refreshToken,
      scopes: [],
    };

    await this.writeSession(session);
    this._lastSession = session;
    this._onDidChangeSessions.fire({
      added: [session],
      changed: [],
      removed: [],
    });

    commands.executeCommand("setContext", "SAS.authorized", true);

    return session;
  }

  private async writeSession(session: SASAuthSession): Promise<void> {
    this.secretStorage.store(session.id, session);
  }

  async removeSession(sessionId: string, silent?: boolean): Promise<void> {
    const workbench = this._workbench;
    if (
      workbench &&
      (workbench.session.id === sessionId ||
        workbench.profileName === profileConfig.getActiveProfile())
    ) {
      // Workbench owns the token: forget it here, but do not revoke it.
      this._workbenchSignedOut.add(workbench.profileName);
      this.clearWorkbenchSession();
      this._lastSession = undefined;
      this._onDidChangeSessions.fire({
        added: [],
        changed: [],
        removed: [workbench.session],
      });
      if (!silent) {
        commands.executeCommand("setContext", "SAS.authorized", false);
      }
      return;
    }

    const sessions = await this.secretStorage.getNamespaceData();
    if (!sessions) {
      return;
    }
    const profileName = profileConfig.getActiveProfile();
    const id = sessions[sessionId] ? sessionId : profileName;
    const session = sessions[id];
    if (!session) {
      return;
    }
    delete sessions[id];

    if (!silent) {
      // Triggered by user sign out from the Accounts menu
      // VS Code will sign out all sessions by this account
      Object.values(sessions).forEach((s: SASAuthSession) => {
        if (s.account.id === session.account.id) {
          delete sessions[s.id];
        }
      });
    }

    await this.secretStorage.setNamespaceData(sessions);

    this._lastSession = undefined;
    this._onDidChangeSessions.fire({
      added: [],
      changed: [],
      removed: [session],
    });

    if (!silent) {
      commands.executeCommand("setContext", "SAS.authorized", false);
    }
  }

  private resolveWorkbench(
    profile: ViyaProfile,
    profileName: string,
    force = false,
  ): Promise<WorkbenchAuthOutcome> {
    if (this._useSasLogon.has(profileName)) {
      return Promise.resolve({ kind: "sasLogon" });
    }
    return resolveWorkbenchAuth({
      mode: profile.authentication,
      endpoint: profile.endpoint,
      workbenchIntegration: profile.workbenchIntegration,
      force,
      log: getAuthLog(),
    });
  }

  /**
   * Turn a Workbench token into a session. A token SAS Viya rejects is force
   * refreshed once; returns undefined if SAS Viya rejects that one too.
   */
  private async workbenchSession(
    profile: ViyaProfile,
    profileName: string,
    outcome: Extract<WorkbenchAuthOutcome, { kind: "token" }>,
  ): Promise<SASAuthSession | undefined> {
    let { token } = outcome;
    const currentUser = (accessToken: string) =>
      getCurrentUser({ endpoint: profile.endpoint, accessToken }).catch(
        (err) => {
          if (isUnauthorized(err)) {
            return undefined;
          }
          throw err;
        },
      );
    let user = await currentUser(token.accessToken);
    if (!user) {
      getAuthLog().warn(
        "SAS Viya rejected the Posit Workbench token; refreshing it",
      );
      const forced = await this.resolveWorkbench(profile, profileName, true);
      if (forced.kind !== "token") {
        return undefined;
      }
      token = forced.token;
      user = await currentUser(token.accessToken);
      if (!user) {
        getAuthLog().warn("SAS Viya rejected the Posit Workbench token");
        return undefined;
      }
    }

    const session: SASAuthSession = {
      id: profileName,
      account: { id: user.id, label: user.name },
      accessToken: token.accessToken,
      scopes: [],
    };
    const previous = this._workbench;
    if (
      previous?.profileName === profileName &&
      previous.integrationUid === outcome.integration.uid &&
      previous.session.accessToken === session.accessToken &&
      previous.session.account.id === session.account.id
    ) {
      return previous.session;
    }
    this.clearWorkbenchSession();
    this._workbench = {
      profileName,
      integrationUid: outcome.integration.uid,
      session,
      expiry: token.expiry,
    };
    this.scheduleWorkbenchRefresh(profile);
    return session;
  }

  /**
   * Fetch a new token from Workbench shortly before the current one expires,
   * so long-running connections keep working.
   */
  private scheduleWorkbenchRefresh(profile: ViyaProfile): void {
    const state = this._workbench;
    if (!state || state.expiry === undefined) {
      return;
    }
    const delay = Math.max(
      state.expiry - WORKBENCH_REFRESH_LEAD_MS - Date.now(),
      WORKBENCH_REFRESH_MIN_DELAY_MS,
    );
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.refreshWorkbenchToken(profile, state).catch((err) =>
        getAuthLog().warn(
          `Posit Workbench token refresh failed: ${err instanceof Error ? err.name : "error"}`,
        ),
      );
    }, delay);
    state.timer.unref?.();
  }

  private async refreshWorkbenchToken(
    profile: ViyaProfile,
    state: WorkbenchSessionState,
  ): Promise<void> {
    if (
      this._workbench !== state ||
      profileConfig.getActiveProfile() !== state.profileName
    ) {
      return;
    }
    const outcome = await this.resolveWorkbench(profile, state.profileName);
    if (this._workbench !== state) {
      return;
    }
    if (
      outcome.kind !== "token" ||
      outcome.integration.uid !== state.integrationUid
    ) {
      // Leave the current token in place; the next request re-resolves.
      return;
    }
    const oldToken = state.session.accessToken;
    const newToken = outcome.token.accessToken;
    if (newToken !== oldToken) {
      state.session = { ...state.session, accessToken: newToken };
      const apiConfig = getApiConfig();
      if (apiConfig.accessToken === oldToken) {
        apiConfig.accessToken = newToken;
      }
      getAuthLog().info("Refreshed the Posit Workbench token");
      this._lastSession = state.session;
      this._onDidChangeSessions.fire({
        added: [],
        changed: [state.session],
        removed: [],
      });
    }
    state.expiry = outcome.token.expiry;
    this.scheduleWorkbenchRefresh(profile);
  }

  private clearWorkbenchSession(): void {
    if (this._workbench?.timer) {
      clearTimeout(this._workbench.timer);
    }
    this._workbench = undefined;
  }
}

function workbenchErrorMessage(
  reason: WorkbenchAuthErrorReason,
  detail?: string,
): string {
  switch (reason) {
    case "notInWorkbench":
      return l10n.t(
        'The profile uses "authentication": "workbench", but this is not a Posit Workbench session.',
      );
    case "rpcFailed":
      return l10n.t("Could not get a token from Posit Workbench: {detail}", {
        detail: detail ?? "",
      });
    case "noIntegration":
      return l10n.t(
        "Posit Workbench has no OAuth integration for this SAS Viya server. Ask your administrator to configure one.",
      );
    case "ambiguous":
      return l10n.t(
        'Several Posit Workbench OAuth integrations match this SAS Viya server ({names}). Set "workbenchIntegration" in the profile.',
        { names: detail ?? "" },
      );
    case "notFound":
      return l10n.t(
        "Posit Workbench has no OAuth integration with the GUID {guid}.",
        { guid: detail ?? "" },
      );
    case "signInRequired":
      return l10n.t(
        'Sign in to "{name}" in Posit Workbench (Managed Credentials), then try again.',
        { name: detail ?? "" },
      );
  }
}
