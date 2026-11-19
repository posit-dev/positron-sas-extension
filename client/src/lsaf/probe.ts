// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Detect an LSAF server. The LSAF views and commands stay hidden until the
// URL in the SAS.lsaf.url setting (or the SAS_LSAF_URL environment variable,
// which a Posit Workbench administrator can set) answers like the LSAF REST
// API.
import { Disposable, commands, workspace } from "vscode";

import axios from "axios";

import {
  AVAILABLE_CONTEXT_KEY,
  ERROR_MEDIA_TYPE,
  URL_ENV_VAR,
  URL_SETTING,
} from "./const";
import { normalizeApiUrl } from "./paths";
import {
  LsafProbeResult,
  classifyLsafProbe,
  combineProbes,
} from "./probeResult";

/** The API URL from the setting, else from the environment variable. */
export function configuredApiUrl(): string | undefined {
  const setting = workspace.getConfiguration().get<string>(URL_SETTING, "");
  return normalizeApiUrl(setting || process.env[URL_ENV_VAR]);
}

async function probeUrl(url: string): Promise<LsafProbeResult> {
  try {
    const response = await axios.get(url, {
      headers: { Accept: `application/json, ${ERROR_MEDIA_TYPE}` },
      maxRedirects: 0,
      timeout: 10_000,
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true,
    });
    return classifyLsafProbe(
      response.status,
      String(response.headers["content-type"] ?? ""),
      typeof response.data === "string" ? response.data : "",
    );
  } catch {
    // Unreachable for now: retried.
    return "error";
  }
}

/** Probe `<api>/apiMeta`, then the API root if that wasn't conclusive. */
export async function probeLsaf(apiUrl: string): Promise<LsafProbeResult> {
  const meta = await probeUrl(`${apiUrl}/apiMeta`);
  if (meta === "lsaf") {
    return meta;
  }
  return combineProbes(meta, await probeUrl(`${apiUrl}/`));
}

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

/**
 * Keeps SAS.lsaf.available in sync with the configured URL, re-probing when
 * the setting changes and retrying while the server doesn't answer.
 */
export class LsafDetector implements Disposable {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private current: string | undefined;
  private readonly disposables: Disposable[];

  /** `onChange` gets the detected API URL, or undefined when there is none. */
  constructor(
    private readonly onChange: (apiUrl: string | undefined) => void,
    private readonly log: (message: string) => void,
  ) {
    this.disposables = [
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(URL_SETTING)) {
          this.schedule();
        }
      }),
    ];
    this.schedule(0);
  }

  /** The detected LSAF API URL. */
  get apiUrl(): string | undefined {
    return this.current;
  }

  schedule(delayMs = 300, resetRetries = true): void {
    if (resetRetries) {
      this.retries = 0;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.update().catch((error) =>
        this.log(`LSAF detection failed: ${error}`),
      );
    }, delayMs);
  }

  async update(): Promise<string | undefined> {
    const generation = ++this.generation;
    const apiUrl = configuredApiUrl();
    let detected: string | undefined;
    if (apiUrl) {
      const result = await probeLsaf(apiUrl);
      this.log(`LSAF at ${apiUrl}: ${result}`);
      if (generation !== this.generation) {
        return this.current;
      }
      if (result === "lsaf") {
        detected = apiUrl;
        this.retries = 0;
      } else if (result === "error" && this.retries < RETRY_DELAYS_MS.length) {
        this.schedule(RETRY_DELAYS_MS[this.retries++], false);
      }
    }
    await commands.executeCommand(
      "setContext",
      AVAILABLE_CONTEXT_KEY,
      detected !== undefined,
    );
    if (detected !== this.current) {
      this.current = detected;
      this.onChange(detected);
    }
    return detected;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
