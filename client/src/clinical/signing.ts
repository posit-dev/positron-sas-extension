// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Signing repository files: the request body and the checks around it. No
// vscode import, so it is unit-tested directly.
//
// The request is the SIGN batch action of SAS Clinical Acceleration
// Repository's web app: POST repository/items/batch?action=SIGN with
// { pin, role, reason, comment, paths }. It isn't in the public API
// documentation.
import type { RepositoryItem } from "./types";
import { isContainer } from "./utils";

export const SIGN_ACTION = "SIGN";

/** At most this many files in one signing, also when folders are expanded. */
export const MAX_SIGN_FILES = 500;

export interface SignRequest {
  /** The current PIN of the signer's authenticator app. */
  pin: string;
  role: string;
  reason: string;
  comment: string;
  /** Repository paths of the files. */
  paths: string[];
}

export function buildSignRequest(
  files: Pick<RepositoryItem, "path">[],
  choice: { role: string; reason: string; comment?: string },
  pin: string,
): SignRequest {
  return {
    pin: pin.trim(),
    role: choice.role,
    reason: choice.reason,
    comment: choice.comment?.trim() ?? "",
    paths: files.map((f) => f.path),
  };
}

/**
 * What the output channel says about a signing: never the PIN, which is a
 * one-time credential.
 */
export function describeSignRequest(request: SignRequest): string {
  return `role "${request.role}", reason "${request.reason}"${request.comment ? `, comment "${request.comment}"` : ""}: ${request.paths.join(", ")}`;
}

/** An authenticator PIN: 6 to 8 digits (spaces ignored). */
export function isValidPin(value: string): boolean {
  return /^\d{6,8}$/.test(value.replace(/\s/g, ""));
}

/** The PIN as sent: digits only. */
export const normalizePin = (value: string): string => value.replace(/\s/g, "");

/**
 * Split files into those that can be signed and those that can't: SAS
 * refuses files that are checked out. Duplicates (a file selected on its
 * own and through its folder) are dropped.
 */
export function partitionSignable(files: RepositoryItem[]): {
  signable: RepositoryItem[];
  checkedOut: RepositoryItem[];
} {
  const seen = new Set<string>();
  const signable: RepositoryItem[] = [];
  const checkedOut: RepositoryItem[] = [];
  for (const file of files) {
    if (isContainer(file) || seen.has(file.id)) {
      continue;
    }
    seen.add(file.id);
    (file.checkedOut ? checkedOut : signable).push(file);
  }
  return { signable, checkedOut };
}

/** The server's lists of signature reasons and roles: plain string arrays. */
export function parseStringList(data: unknown): string[] {
  const items =
    data && typeof data === "object" && "items" in data ? data.items : data;
  return Array.isArray(items)
    ? items.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
}
