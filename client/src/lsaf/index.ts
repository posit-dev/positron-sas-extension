// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// SAS Life Science Analytics Framework (LSAF): repository and workspace
// views, check-out and check-in, and jobs, over the LSAF REST API 1.0.
// Everything is hidden until the configured URL answers like an LSAF server
// (SAS.lsaf.available), and is independent of the active SAS profile.
import { ExtensionContext, commands, window } from "vscode";

import { LsafSession } from "./auth";
import { LsafDetector } from "./probe";

export function registerLsaf(context: ExtensionContext): void {
  const output = window.createOutputChannel("SAS LSAF", { log: true });
  const log = (message: string) => output.info(message);
  const session = new LsafSession(context, output);
  const detector = new LsafDetector(
    (apiUrl) =>
      session
        .setApiUrl(apiUrl)
        .catch((error) => output.error(`LSAF session: ${error}`)),
    log,
  );

  context.subscriptions.push(
    output,
    session,
    detector,
    commands.registerCommand("SAS.lsaf.signIn", () => session.signIn()),
    commands.registerCommand("SAS.lsaf.signOut", () => session.signOut()),
    commands.registerCommand("SAS.lsaf.refresh", () => detector.schedule(0)),
  );
}
