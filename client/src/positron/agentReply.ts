// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Replies to external coding agents (#156). Positron's MCP server refuses a
 * command result over 32768 bytes of JSON unless it can shorten an array, so
 * long log text has to be clipped here.
 * Kept free of `vscode` imports so it can be unit tested.
 */

/**
 * The message of a failed run. Positron rejects with the runtime's error
 * message, a plain `{ name, message, traceback }` object, not an Error.
 */
export function errorText(e: unknown): string {
  if (e && typeof e === "object") {
    const message: unknown = Reflect.get(e, "message");
    if (typeof message === "string" && message) {
      return message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      // Fall through to String().
    }
  }
  return String(e);
}

/** Byte budget for the text fields of one reply, below the 32 KB limit. */
export const AGENT_REPLY_TEXT_BYTES = 28000;

/** UTF-8 size of a string as it travels in JSON. */
export function jsonBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text));
}

/**
 * Shorten `text` to at most `maxBytes` (counted as a JSON string) by keeping
 * its first and last lines and replacing the middle with a marker. SAS logs
 * have the setup at the top and the errors and summary at the bottom, so
 * both ends matter.
 */
export function clipForAgent(
  text: string,
  maxBytes: number,
): { text: string; clipped: boolean } {
  if (jsonBytes(text) <= maxBytes) {
    return { text, clipped: false };
  }
  const lines = text.split("\n");
  const marker = (n: number) => `[... ${n} lines clipped ...]`;
  // Reserve room for the quotes and the marker, then take lines alternately
  // from both ends. Each kept line also pays for one newline, which JSON
  // escapes to two bytes.
  let budget = maxBytes - jsonBytes(marker(lines.length));
  const head: string[] = [];
  const tail: string[] = [];
  let i = 0;
  let j = lines.length - 1;
  let fromHead = true;
  while (i <= j) {
    const line = fromHead ? lines[i] : lines[j];
    const cost = jsonBytes(line); // content plus escaped newline
    if (cost > budget) {
      break;
    }
    budget -= cost;
    if (fromHead) {
      head.push(line);
      i++;
    } else {
      tail.unshift(line);
      j--;
    }
    fromHead = !fromHead;
  }
  const dropped = j - i + 1;
  if (dropped <= 0) {
    return { text, clipped: false };
  }
  return {
    text: [...head, marker(dropped), ...tail].join("\n"),
    clipped: true,
  };
}

/**
 * Fit the log and the report text of one run into the reply budget. The log
 * gets at least half, the report what the log leaves over.
 */
export function clipRunReply(
  log: string,
  result: string,
  maxBytes: number = AGENT_REPLY_TEXT_BYTES,
): { log: string; result: string; clipped: boolean } {
  const resultShare = Math.max(
    Math.floor(maxBytes / 2),
    maxBytes - jsonBytes(log),
  );
  const r = clipForAgent(result, resultShare);
  const l = clipForAgent(log, maxBytes - jsonBytes(r.text));
  return { log: l.text, result: r.text, clipped: l.clipped || r.clipped };
}
