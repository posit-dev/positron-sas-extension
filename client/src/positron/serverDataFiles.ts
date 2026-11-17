// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Open SAS data files on the SAS server (SAS Server Files in the Data
// Connections or Connections pane) in the Data Explorer. The session reads
// them where they are: a library on the file's folder for datasets and
// views; transport files are unpacked into WORK, as local ones are.
import { ProgressLocation, window } from "vscode";

import type { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import { fileExtension } from "./dataFileReaders";
import {
  type DataFile,
  assignDataFileLibrary,
  loadTransportFile,
} from "./dataFiles";
import type { ServerFilesBrowser } from "./sasServerFilesConnection";
import { TRANSPORT_HEADER_BYTES } from "./xptFormat";

/** Open a data file on the SAS server, given by its path segments. */
export async function openServerDataFile(
  session: SASLanguageRuntimeSession,
  browser: Pick<ServerFilesBrowser, "sasPath" | "readBytes">,
  segments: string[],
): Promise<void> {
  const fileName = segments[segments.length - 1] ?? "";
  const sasPath = browser.sasPath(segments);
  const file: DataFile = {
    key: `sasServer:${sasPath}`,
    local: true,
    filePath: sasPath,
    read: () => browser.readBytes(segments),
    readHeader: async () =>
      (await browser.readBytes(segments)).subarray(0, TRANSPORT_HEADER_BYTES),
  };
  try {
    if (fileExtension(fileName) !== "xpt") {
      const { libref, member } = await window.withProgress(
        { location: ProgressLocation.Window, title: `Opening ${fileName}` },
        () => assignDataFileLibrary(session, file),
      );
      session.openDataExplorer(libref, member, fileName);
      return;
    }
    const { libref, members } = await window.withProgress(
      { location: ProgressLocation.Notification, title: `Reading ${fileName}` },
      () => loadTransportFile(session, file),
    );
    if (members.length === 0) {
      void window.showWarningMessage(`${fileName} contains no datasets.`);
      return;
    }
    const selected =
      members.length === 1
        ? members
        : ((await window.showQuickPick(members, {
            canPickMany: true,
            title: `${fileName} contains ${members.length} datasets`,
            placeHolder: "Select the datasets to open in the Data Explorer",
          })) ?? []);
    for (const member of selected) {
      session.openDataExplorer(libref, member, `${fileName}: ${member}`);
    }
  } catch (error) {
    void window.showErrorMessage(
      `Failed to open ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
