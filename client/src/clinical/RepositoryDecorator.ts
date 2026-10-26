// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/RepositoryDecorator.ts (Apache-2.0).
import {
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  ThemeColor,
  Uri,
} from "vscode";

import { CLINICAL_SCHEME } from "./const";
import { Messages } from "./messages";
import type { CheckoutState } from "./types";

/** Marks checked-out repository files with a "CO" badge. */
export class RepositoryDecorator implements FileDecorationProvider {
  private readonly states = new Map<
    string,
    { state: CheckoutState; by?: string }
  >();
  private readonly _onDidChange = new EventEmitter<Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** Record the checkout state of a file shown in the tree. */
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
    if (uri.scheme !== CLINICAL_SCHEME) {
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
        : Messages.CheckedOutBy.replace("{name}", entry.by ?? "?"),
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
