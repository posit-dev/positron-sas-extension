// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  type Disposable,
  ProgressLocation,
  type QuickPickItem,
  QuickPickItemKind,
  type Tab,
  Uri,
  commands,
  window,
  workspace,
} from "vscode";

import * as path from "path";

import type { SASLanguageRuntimeSession } from "./PositronLanguageRuntimeSession";
import { HIGHLIGHT_MAX_ROWS, buildHighlightHtml } from "./compareHighlight";
import { assignDataFileLibrary, loadTransportFile } from "./dataFiles";
import {
  COMPARE_OUT,
  COMPARE_PREP_CODE,
  COMPARE_STATUS_CODE,
  type CompareOptions,
  type DatasetRef,
  buildCompareCode,
  commonColumns,
  dataExplorerTabLabel,
  describeCompareResult,
  parseCompareStatus,
} from "./datasetCompare";
import { getActiveSession, getPositronApi } from "./index";

const SELECTED_KEY = "SAS.datasetSelectedForCompare";
const DATA_FILE = /\.(sas7bdat|xpt)$/i;

let selectedFile: Uri | undefined;

function sameDataset(a: DatasetRef, b: { lib: string; mem: string }): boolean {
  return (
    a.lib.toUpperCase() === b.lib.toUpperCase() &&
    a.mem.toUpperCase() === b.mem.toUpperCase()
  );
}

/** The SAS console the datasets live in, or a message saying there is none. */
export function requireSession(): SASLanguageRuntimeSession | undefined {
  const session = getActiveSession();
  if (!session) {
    void window.showErrorMessage(
      "Start a SAS console first: datasets are read through the SAS session.",
    );
  }
  return session;
}

/** The datasets open in a SAS Data Explorer, without duplicates. */
function openDatasets(session: SASLanguageRuntimeSession): DatasetRef[] {
  const refs: DatasetRef[] = [];
  for (const { title, lib, mem } of session.listDataExplorers()) {
    const ref = { lib, mem, label: title };
    if (
      !sameDataset(ref, COMPARE_OUT) &&
      !refs.some((other) => sameDataset(other, ref))
    ) {
      refs.push(ref);
    }
  }
  return refs;
}

/** The SAS dataset in the Data Explorer in front, if any. */
export async function activeDataExplorerDataset(
  session: SASLanguageRuntimeSession,
): Promise<DatasetRef | undefined> {
  const getContext = getPositronApi()?.dataExplorer?.getContext;
  if (!getContext) {
    return undefined;
  }
  const context = await getContext();
  if (!context) {
    return undefined;
  }
  const explorer = session
    .listDataExplorers()
    .find(({ title }) => title === context.displayName);
  return explorer
    ? { lib: explorer.lib, mem: explorer.mem, label: explorer.title }
    : undefined;
}

type DatasetItem = QuickPickItem & { ref?: DatasetRef; browse?: boolean };

/** Pick a dataset: one open in a Data Explorer, or one from a library. */
export async function pickDataset(
  session: SASLanguageRuntimeSession,
  title: string,
  first?: DatasetRef,
): Promise<DatasetRef | undefined> {
  const open = openDatasets(session);
  if (first) {
    open.sort((a, b) =>
      sameDataset(a, first) ? -1 : sameDataset(b, first) ? 1 : 0,
    );
  }
  if (open.length > 0) {
    const items: DatasetItem[] = [
      { label: "Open in the Data Explorer", kind: QuickPickItemKind.Separator },
      ...open.map((ref) => ({
        label: `$(table) ${ref.label}`,
        description:
          ref.label === `${ref.lib}.${ref.mem}`
            ? undefined
            : `${ref.lib}.${ref.mem}`,
        ref,
      })),
      { label: "", kind: QuickPickItemKind.Separator },
      { label: "$(library) Choose from a library...", browse: true },
    ];
    const picked = await window.showQuickPick(items, {
      title,
      placeHolder: "Pick a dataset",
    });
    if (!picked || picked.ref) {
      return picked?.ref;
    }
  }

  const libraries = await session.listLibraries();
  const lib = await window.showQuickPick(libraries, {
    title,
    placeHolder: "Pick a library",
  });
  if (!lib) {
    return undefined;
  }
  const members = await session.listMembers(lib);
  if (members.length === 0) {
    void window.showInformationMessage(`The library ${lib} has no datasets.`);
    return undefined;
  }
  const mem = await window.showQuickPick(
    members.map((m) => ({
      label: m.name,
      description: m.type === "VIEW" ? "view" : undefined,
    })),
    { title, placeHolder: `Pick a dataset in ${lib}` },
  );
  return mem
    ? { lib, mem: mem.label, label: `${lib}.${mem.label}` }
    : undefined;
}

/** Ask for the ID variables and the numeric tolerance. */
async function pickOptions(
  session: SASLanguageRuntimeSession,
  base: DatasetRef,
  compare: DatasetRef,
): Promise<CompareOptions | undefined> {
  const [baseColumns, compareColumns] = await Promise.all([
    session.getDatasetColumns(base.lib, base.mem),
    session.getDatasetColumns(compare.lib, compare.mem),
  ]);
  const common = commonColumns(baseColumns, compareColumns);
  let idVars: string[] = [];
  if (common.length > 0) {
    const picked = await window.showQuickPick(
      common.map((name) => ({ label: name })),
      {
        title: `Compare ${base.label} with ${compare.label}: ID variables`,
        placeHolder:
          "Pick the variables that identify an observation, or none to match observations by position",
        canPickMany: true,
      },
    );
    if (!picked) {
      return undefined;
    }
    idVars = picked.map((item) => item.label);
  }

  const tolerance = await window.showInputBox({
    title: `Compare ${base.label} with ${compare.label}: numeric tolerance`,
    prompt:
      "Numeric values that differ by at most this much count as equal. Leave empty to compare exactly.",
    placeHolder: "e.g. 0.00001",
    validateInput: (value) =>
      value.trim() === "" ||
      (Number.isFinite(Number(value)) && Number(value) >= 0)
        ? undefined
        : "Enter a number of 0 or more, or leave it empty.",
  });
  if (tolerance === undefined) {
    return undefined;
  }
  return {
    base,
    compare,
    idVars,
    tolerance: tolerance.trim() === "" ? undefined : Number(tolerance),
  };
}

/** The open tabs, in all editor groups. */
function allTabs(): Tab[] {
  return window.tabGroups.all.flatMap((group) => group.tabs);
}

/**
 * Resolves with the first tab, not open before, that gets the label `label`.
 * A Data Explorer tab opens as "Data Explorer" and is renamed once its data
 * loads, so renamed tabs count too.
 */
function nextTab(label: string, timeoutMs = 60_000): Promise<Tab | undefined> {
  const before = new Set(allTabs());
  return new Promise((resolve) => {
    let listener: Disposable | undefined = undefined;
    const timer = setTimeout(() => {
      listener?.dispose();
      resolve(undefined);
    }, timeoutMs);
    listener = window.tabGroups.onDidChangeTabs(({ opened, changed }) => {
      const tab = [...opened, ...changed].find(
        (t) => t.label === label && !before.has(t),
      );
      if (tab) {
        clearTimeout(timer);
        listener?.dispose();
        resolve(tab);
      }
    });
  });
}

/** Open a dataset in a Data Explorer and wait for its tab. */
async function openExplorerTab(
  session: SASLanguageRuntimeSession,
  dataset: DatasetRef,
): Promise<Tab | undefined> {
  const tab = nextTab(dataExplorerTabLabel(dataset.label));
  session.openDataExplorer(dataset.lib, dataset.mem, dataset.label);
  const opened = await tab;
  // Keep the editor if it opened as a preview, so the next one doesn't
  // replace it.
  await commands.executeCommand("workbench.action.keepEditor");
  return opened;
}

/**
 * Open two datasets in Data Explorers next to each other. The left one is
 * reused if it is already open, as when the compare started from its Data
 * Explorer.
 */
export async function openSideBySide(
  session: SASLanguageRuntimeSession,
  left: DatasetRef,
  right: DatasetRef,
): Promise<void> {
  const leftLabel = dataExplorerTabLabel(left.label);
  const leftOpen =
    session.listDataExplorers().some(({ title }) => title === left.label) &&
    allTabs().find((t) => t.label === leftLabel);
  const leftTab = leftOpen || (await openExplorerTab(session, left));
  const rightTab = await openExplorerTab(session, right);
  if (
    leftTab &&
    rightTab &&
    leftTab.group.viewColumn === rightTab.group.viewColumn
  ) {
    // The right one is the active editor: it was opened last.
    await commands.executeCommand("workbench.action.moveEditorToRightGroup");
  }
}

/**
 * Show the differing observations of WORK._COMPARE in the Viewer, base and
 * compare values paired and the values that differ in color.
 */
async function showHighlightedDifferences(
  session: SASLanguageRuntimeSession,
  options: CompareOptions,
  totalRows: number,
): Promise<void> {
  const html = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Reading the differences...",
    },
    async () => {
      const columns = await session.getDatasetColumns(
        COMPARE_OUT.lib,
        COMPARE_OUT.mem,
      );
      const rows = await session.getDatasetRows(
        COMPARE_OUT.lib,
        COMPARE_OUT.mem,
        columns.map((c) => c.name),
        HIGHLIGHT_MAX_ROWS,
      );
      return buildHighlightHtml({ options, columns, rows, totalRows });
    },
  );
  await session.showHtml(
    html,
    `Differences: ${options.base.label} vs ${options.compare.label}`,
    "sas-differences",
  );
}

/** Run the compare in the console, then report what differs. */
async function runCompare(
  session: SASLanguageRuntimeSession,
  options: CompareOptions,
): Promise<void> {
  const api = getPositronApi();
  if (!api) {
    return;
  }
  const code = buildCompareCode(options);
  await session.runSilent(COMPARE_PREP_CODE);
  await api.runtime.executeCode(
    "sas",
    code,
    false,
    true,
    undefined,
    undefined,
    undefined,
    session.sessionId,
  );
  const status = parseCompareStatus(
    await session.runSilent(COMPARE_STATUS_CODE),
  );
  const { base, compare } = options;
  const names = `${base.label} and ${compare.label}`;
  if (status?.returnCode === undefined) {
    void window.showErrorMessage(
      `${names} could not be compared. The SAS log in the console says why.`,
    );
    return;
  }
  const result = describeCompareResult(status.returnCode);
  if (result.fatal) {
    void window.showErrorMessage(
      `PROC COMPARE stopped with an error comparing ${names}. The SAS log in the console says why.`,
    );
    return;
  }

  const highlight = "Highlight Differences";
  const openDifferences = "Open Differences";
  const sideBySide = "Open Side by Side";
  const actions =
    status.differenceRows > 0
      ? [highlight, openDifferences, sideBySide]
      : [sideBySide];
  const message = result.identical
    ? `${names} are identical. The report is in the Viewer.`
    : `${names} differ: ${result.differences.join(", ")}. The report is in the Viewer.`;
  const choice = await (result.identical
    ? window.showInformationMessage(message, ...actions)
    : window.showWarningMessage(message, ...actions));
  if (choice === highlight) {
    await showHighlightedDifferences(session, options, status.differenceRows);
  } else if (choice === openDifferences) {
    session.openDataExplorer(
      COMPARE_OUT.lib,
      COMPARE_OUT.mem,
      `Differences: ${base.label} vs ${compare.label}`,
    );
  } else if (choice === sideBySide) {
    await openSideBySide(session, base, compare);
  }
}

/**
 * Compare two datasets with PROC COMPARE. Datasets not given are picked;
 * the Data Explorer in front is offered first as the base.
 */
export async function compareDatasets(
  base?: DatasetRef,
  compare?: DatasetRef,
): Promise<void> {
  const session = requireSession();
  if (!session) {
    return;
  }
  try {
    base ??= await pickDataset(
      session,
      "Compare Datasets (1/2): base dataset",
      await activeDataExplorerDataset(session),
    );
    if (!base) {
      return;
    }
    compare ??= await pickDataset(
      session,
      `Compare Datasets (2/2): compare ${base.label} with`,
    );
    if (!compare) {
      return;
    }
    const options = await pickOptions(session, base, compare);
    if (options) {
      await runCompare(session, options);
    }
  } catch (error) {
    void window.showErrorMessage(
      `Compare Datasets failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Compare the dataset in the Data Explorer in front with another. */
export async function compareActiveDataset(): Promise<void> {
  const session = requireSession();
  if (!session) {
    return;
  }
  await compareDatasets(await activeDataExplorerDataset(session));
}

/** A .sas7bdat or .xpt file as a dataset in the SAS session. */
export async function datasetFromFile(
  session: SASLanguageRuntimeSession,
  uri: Uri,
  label?: string,
): Promise<DatasetRef | undefined> {
  const local = uri.scheme === "file";
  const file = {
    key: uri.toString(),
    local,
    filePath: local ? uri.fsPath : uri.path,
    read: () => workspace.fs.readFile(uri),
  };
  const fileName = label ?? path.basename(file.filePath);
  if (path.extname(file.filePath).toLowerCase() !== ".xpt") {
    const { libref, member } = await assignDataFileLibrary(session, file);
    return { lib: libref, mem: member, label: fileName };
  }
  const { libref, members } = await loadTransportFile(session, file);
  if (members.length === 0) {
    void window.showErrorMessage(`${fileName} contains no datasets.`);
    return undefined;
  }
  const member =
    members.length === 1
      ? members[0]
      : await window.showQuickPick(members, {
          title: `${fileName} contains ${members.length} datasets`,
          placeHolder: "Pick a dataset",
        });
  return member
    ? { lib: libref, mem: member, label: `${fileName}: ${member}` }
    : undefined;
}

/**
 * Compare two .sas7bdat or .xpt files: from the Explorer's multi-selection,
 * or from the Clinical Repository's compare commands, with their labels.
 */
export async function compareDatasetFiles(
  first: Uri,
  second?: Uri | Uri[],
  labels?: [string, string],
): Promise<void> {
  const uris = Array.isArray(second)
    ? second
    : second
      ? [first, second]
      : [first];
  if (uris.length !== 2 || !uris.every((uri) => DATA_FILE.test(uri.path))) {
    void window.showErrorMessage(
      "Select two .sas7bdat or .xpt files to compare.",
    );
    return;
  }
  const session = requireSession();
  if (!session) {
    return;
  }
  try {
    const base = await datasetFromFile(session, uris[0], labels?.[0]);
    const compare =
      base && (await datasetFromFile(session, uris[1], labels?.[1]));
    if (base && compare) {
      await compareDatasets(base, compare);
    }
  } catch (error) {
    void window.showErrorMessage(
      `Compare Datasets failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Explorer: remember a .sas7bdat or .xpt file to compare with later. */
export async function selectDatasetFileForCompare(uri: Uri): Promise<void> {
  selectedFile = uri;
  await commands.executeCommand("setContext", SELECTED_KEY, true);
}

/** Explorer: compare a file with the one selected for compare. */
export async function compareDatasetFileWithSelected(uri: Uri): Promise<void> {
  if (!selectedFile) {
    return;
  }
  await compareDatasetFiles(selectedFile, uri);
}
