// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, authentication, commands, workspace } from "vscode";

import axios from "axios";

import { SASAuthProvider } from "../components/AuthProvider";
import { getActiveViyaEndpoint } from "./RepositoryModel";
import { API_MEDIA_TYPE, AVAILABLE_CONTEXT_KEY, SERVICE_ROOT } from "./const";
import { ProbeResult, classifyProbe, isAvailable } from "./utils";

/** Ask a SAS Viya server whether it runs the Clinical Repository service. */
export async function probeClinicalRepository(
  endpoint: string,
  accessToken?: string,
): Promise<ProbeResult> {
  try {
    const response = await axios.get(`${endpoint}${SERVICE_ROOT}`, {
      headers: {
        Accept: API_MEDIA_TYPE,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      maxRedirects: 0,
      timeout: 5000,
      validateStatus: () => true,
    });
    return classifyProbe(
      response.status,
      String(response.headers["content-type"] ?? ""),
    );
  } catch {
    // Network errors and timeouts: the server may just be unreachable now.
    return "error";
  }
}

// Retry delays after a 5xx or network error, so a service that was briefly
// down at startup still shows up without a profile switch or sign-in.
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

/**
 * Keeps the `SAS.clinicalAvailable` context key in sync with the active
 * profile: true when it is a SAS Viya profile whose server has SAS Clinical
 * Acceleration. Detection needs no configuration; it re-runs when profiles or
 * the SAS sign-in change.
 */
export class ClinicalAvailability implements Disposable {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private available = false;
  private retries = 0;
  private readonly disposables: Disposable[];

  constructor(
    private readonly onChange: (available: boolean) => void,
    private readonly log: (message: string) => void,
  ) {
    this.disposables = [
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("SAS.connectionProfiles")) {
          this.schedule();
        }
      }),
      authentication.onDidChangeSessions((event) => {
        if (event.provider.id === SASAuthProvider.id) {
          this.schedule();
        }
      }),
    ];
    this.schedule();
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Re-check soon. Profile switches fire several events at once. */
  schedule(delayMs = 300, resetRetries = true): void {
    if (resetRetries) {
      this.retries = 0;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.update().catch((error) =>
        this.log(`Clinical Repository detection failed: ${error}`),
      );
    }, delayMs);
  }

  async update(): Promise<boolean> {
    const generation = ++this.generation;
    const endpoint = getActiveViyaEndpoint();
    let available = false;
    if (endpoint) {
      let token: string | undefined;
      try {
        token = (
          await authentication.getSession(SASAuthProvider.id, [], {
            silent: true,
          })
        )?.accessToken;
      } catch {
        token = undefined;
      }
      const result = await probeClinicalRepository(endpoint, token);
      available = isAvailable(result, !!token);
      this.log(
        `Clinical Repository at ${endpoint}: ${result}${token ? "" : " (not signed in)"}`,
      );
      if (generation !== this.generation) {
        // A newer check started while this one was waiting on the network.
        return this.available;
      }
      if (result === "error" && this.retries < RETRY_DELAYS_MS.length) {
        this.schedule(RETRY_DELAYS_MS[this.retries++], false);
      } else if (result !== "error") {
        this.retries = 0;
      }
    } else {
      this.retries = 0;
    }
    await commands.executeCommand(
      "setContext",
      AVAILABLE_CONTEXT_KEY,
      available,
    );
    if (available !== this.available) {
      this.available = available;
      this.onChange(available);
    }
    return available;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}
