// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { SessionIdentity } from "./sessionIdentity";

export type AuditRecord =
  | ({
      event: "input";
      ts: string;
      executionId: string;
      code: string;
    } & SessionIdentity)
  | {
      event: "complete";
      ts: string;
      positronSessionId: string;
      executionId: string;
      status: "ok" | "error";
      errorCount: number;
      warningCount: number;
      durationMs: number;
    };

export function expandHome(file: string): string {
  if (file === "~") {
    return os.homedir();
  }
  if (file.startsWith("~/") || file.startsWith("~\\")) {
    return path.join(os.homedir(), file.slice(2));
  }
  return file;
}

/**
 * Appends console submissions to a JSON Lines file (one record per line).
 * Writes are serialised so records never interleave, and a failed write never
 * throws into the caller: it is reported once through `onError`.
 */
export class AuditLog {
  private queue: Promise<void> = Promise.resolve();
  private reportedError = false;

  constructor(
    private readonly getFile: () => string | undefined,
    private readonly onError: (error: Error, file: string) => void,
  ) {}

  write(record: AuditRecord): Promise<void> {
    const file = this.getFile()?.trim();
    if (!file) {
      return this.queue;
    }
    const target = expandHome(file);
    const line = JSON.stringify(record) + "\n";
    this.queue = this.queue.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.appendFile(target, line, { encoding: "utf8" });
      } catch (error) {
        if (!this.reportedError) {
          this.reportedError = true;
          this.onError(
            error instanceof Error ? error : new Error(String(error)),
            target,
          );
        }
      }
    });
    return this.queue;
  }
}
