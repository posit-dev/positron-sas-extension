// Copyright © 2026, Posit Software, PBC.
// SPDX-License-Identifier: Apache-2.0

/** HTTP status carried by an axios-style error, or 0 when there is none. */
export function httpStatus(err: unknown): number {
  const response =
    err && typeof err === "object" ? Reflect.get(err, "response") : undefined;
  const status =
    response && typeof response === "object"
      ? Reflect.get(response, "status")
      : undefined;
  return typeof status === "number" ? status : 0;
}

export interface KeepAliveOptions {
  /** Time between pings. */
  intervalMs: number;
  /** Touches the server session. A rejection with HTTP 404 means it is gone. */
  ping: () => Promise<void>;
  /** A running job keeps the session active, so no ping is needed. */
  isBusy: () => boolean;
  /** Called once when the server reports the session no longer exists. */
  onGone: () => void;
  /**
   * Stop pinging after this long without activity (a submit or a running
   * job), so an abandoned console does not hold a server session forever.
   */
  maxIdleMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Pings a Viya compute session while it is idle. The server reaps compute
 * sessions that see no requests for the inactivity timeout, and any request
 * to the session (verified for GET state and GET session) resets that timer.
 */
export class KeepAlive {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastActivity = 0;
  // Bumped by stop() so a ping still in flight cannot reschedule afterwards.
  private generation = 0;
  private active = false;

  constructor(private readonly options: KeepAliveOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  start(): void {
    if (this.active || !(this.options.intervalMs > 0)) {
      return;
    }
    this.active = true;
    this.lastActivity = this.now();
    this.schedule(this.generation);
  }

  /** Record user activity (a submit), which restarts the max-idle window. */
  touch(): void {
    this.lastActivity = this.now();
  }

  stop(): void {
    this.active = false;
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(generation: number): void {
    this.timer = setTimeout(
      () => void this.tick(generation),
      this.options.intervalMs,
    );
    // Never keep the extension host alive just for this timer.
    const unref =
      typeof this.timer === "object"
        ? Reflect.get(this.timer, "unref")
        : undefined;
    if (typeof unref === "function") {
      unref.call(this.timer);
    }
  }

  private async tick(generation: number): Promise<void> {
    this.timer = undefined;
    if (generation !== this.generation) {
      return;
    }

    if (this.options.isBusy()) {
      this.touch();
    } else if (
      this.options.maxIdleMs !== undefined &&
      this.now() - this.lastActivity > this.options.maxIdleMs
    ) {
      this.options.log?.("Session keep-alive stopped after a long idle period");
      this.stop();
      return;
    } else {
      try {
        await this.options.ping();
      } catch (err) {
        if (generation !== this.generation) {
          return;
        }
        if (httpStatus(err) === 404) {
          this.options.log?.("SAS session no longer exists on the server");
          this.stop();
          this.options.onGone();
          return;
        }
        // Transient (network, 5xx, expired token): try again next tick.
        this.options.log?.(
          `Session keep-alive ping failed (${httpStatus(err) || "no response"})`,
        );
      }
    }

    if (generation === this.generation) {
      this.schedule(generation);
    }
  }
}
