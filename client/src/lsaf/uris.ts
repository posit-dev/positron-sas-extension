// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// URIs of LSAF files, and the "CO" badge of checked-out files.
import {
  Disposable,
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  ThemeColor,
  ThemeIcon,
  Uri,
  l10n,
} from "vscode";

import { REPOSITORY_SCHEME, WORKSPACE_SCHEME } from "./const";
import { CheckoutState } from "./items";
import { Messages } from "./messages";
import { normalizePath } from "./paths";
import type { Area } from "./types";

/** `sasLsaf:/<path>`, or `sasLsaf:/<path>?version=<v>` for one version. */
export const repositoryUri = (path: string, version?: string): Uri =>
  Uri.from({
    scheme: REPOSITORY_SCHEME,
    path: normalizePath(path),
    query: version ? `version=${encodeURIComponent(version)}` : "",
  });

export const workspaceUri = (path: string): Uri =>
  Uri.from({ scheme: WORKSPACE_SCHEME, path: normalizePath(path) });

export const areaUri = (area: Area, path: string): Uri =>
  area === "workspace" ? workspaceUri(path) : repositoryUri(path);

export const versionOf = (uri: Uri): string | undefined =>
  new URLSearchParams(uri.query).get("version") || undefined;

/** The area and path of an LSAF URI; undefined for other schemes. */
export function lsafLocation(
  uri: Uri | undefined,
): { area: Area; path: string } | undefined {
  if (uri?.scheme === REPOSITORY_SCHEME) {
    return { area: "repository", path: uri.path };
  }
  if (uri?.scheme === WORKSPACE_SCHEME) {
    return { area: "workspace", path: uri.path };
  }
  return undefined;
}

/** An icon from `items.fileIcon`/`containerIcon` as a tree item icon. */
export function iconPath(
  extensionUri: Uri,
  name: string,
): ThemeIcon | { light: Uri; dark: Uri } {
  if (name.startsWith("$")) {
    return new ThemeIcon(name.slice(1));
  }
  return {
    light: Uri.joinPath(extensionUri, "icons", "light", `${name}Light.svg`),
    dark: Uri.joinPath(extensionUri, "icons", "dark", `${name}Dark.svg`),
  };
}

/** Marks checked-out files in both LSAF views with a "CO" badge. */
export class CheckoutDecorator implements FileDecorationProvider, Disposable {
  private readonly states = new Map<
    string,
    { state: CheckoutState; by?: string }
  >();
  private readonly _onDidChange = new EventEmitter<Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  set(uri: Uri, state: CheckoutState, by?: string): void {
    const key = uri.toString();
    const previous = this.states.get(key);
    if (previous?.state === state && previous.by === by) {
      return;
    }
    if (state === "none") {
      this.states.delete(key);
    } else {
      this.states.set(key, { state, by });
    }
    this._onDidChange.fire([uri]);
  }

  provideFileDecoration(uri: Uri): FileDecoration | undefined {
    if (uri.scheme !== REPOSITORY_SCHEME && uri.scheme !== WORKSPACE_SCHEME) {
      return undefined;
    }
    const entry = this.states.get(uri.toString());
    if (!entry) {
      return undefined;
    }
    const self = entry.state === "self";
    return {
      badge: "CO",
      tooltip: self
        ? Messages.CheckedOutBySelf
        : l10n.t(Messages.CheckedOutBy, { user: entry.by ?? "?" }),
      color: new ThemeColor(
        self
          ? "gitDecoration.modifiedResourceForeground"
          : "gitDecoration.ignoredResourceForeground",
      ),
      propagate: false,
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
