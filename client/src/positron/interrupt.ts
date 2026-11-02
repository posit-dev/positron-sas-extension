// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// No VS Code imports: this module is unit-tested without VS Code.

/** Where the "interrupt not supported" message says SAS runs. */
function connectionLabel(connectionType: string): string {
  switch (connectionType) {
    case "ssh":
      return "SSH connections";
    case "stdio":
      return "local stdio connections";
    default:
      return "this connection";
  }
}

/**
 * Message shown when the console is interrupted but the connection has no
 * way to cancel a running submission (SSH and stdio, #90). SAS runs there
 * with -nodms -noterminal; SAS's attention handler (SIGINT) answers with an
 * interactive menu that needs a terminal, so there is no reliable way to
 * cancel a submission and keep the session. The console stays busy, because
 * SAS keeps running the code; restarting the session ends SAS.
 */
export function interruptNotSupportedMessage(connectionType: string): string {
  return (
    `SAS cannot interrupt running code on ${connectionLabel(connectionType)}. ` +
    "SAS keeps running it, and the console stays busy until it finishes. " +
    "To stop it now, restart the session. This ends the SAS session, so WORK " +
    "tables, macro variables and librefs are lost."
  );
}
