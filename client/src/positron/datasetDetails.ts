// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { ProgressLocation, type Uri, window } from "vscode";

import type { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import {
  activeDataExplorerDataset,
  datasetFromFile,
  pickDataset,
  requireSession,
} from "./compareDatasets";
import type { DatasetRef } from "./datasetCompare";
import { buildPropertiesHtml } from "./datasetProperties";

/** Read a dataset's properties and columns and show them in the Viewer. */
async function showProperties(
  session: SASLanguageRuntimeSession,
  dataset: DatasetRef,
): Promise<void> {
  const html = await window.withProgress(
    {
      location: ProgressLocation.Window,
      title: `Reading the properties of ${dataset.label}...`,
    },
    async () => {
      const [props, columns] = await Promise.all([
        session.getDatasetProperties(dataset.lib, dataset.mem),
        session.getDatasetColumns(dataset.lib, dataset.mem),
      ]);
      return props && buildPropertiesHtml(props, columns, dataset.label);
    },
  );
  if (!html) {
    void window.showErrorMessage(`${dataset.label} doesn't exist.`);
    return;
  }
  await session.showHtml(
    html,
    `Properties: ${dataset.label}`,
    "sas-properties",
  );
}

async function run(
  getDataset: (
    session: SASLanguageRuntimeSession,
  ) => Promise<DatasetRef | undefined>,
): Promise<void> {
  const session = requireSession();
  if (!session) {
    return;
  }
  try {
    const dataset = await getDataset(session);
    if (dataset) {
      await showProperties(session, dataset);
    }
  } catch (error) {
    void window.showErrorMessage(
      `Dataset Properties failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Show the properties of a dataset: the one in the Data Explorer in front,
 * or else one picked.
 */
export function showDatasetProperties(): Promise<void> {
  return run(
    async (session) =>
      (await activeDataExplorerDataset(session)) ??
      (await pickDataset(
        session,
        "Dataset Properties",
        undefined,
      )),
  );
}

/** Show the properties of a .sas7bdat or .xpt file. */
export function showDatasetFileProperties(uri: Uri): Promise<void> {
  return run((session) => datasetFromFile(session, uri));
}
