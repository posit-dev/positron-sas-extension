// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The audit history of SAS Clinical Acceleration Repository: what was done
// to an item (Show Audit History) or a search by name, location, action,
// mode and period (Search Audit History), as a report in the Viewer, and its
// export as HTML or CSV. The server lists administrators every user's
// actions and other users only their own.
import {
  Disposable,
  LogOutputChannel,
  ProgressLocation,
  QuickPickItem,
  env,
  l10n,
  window,
} from "vscode";

import { getItemUri } from "./RepositoryDataProvider";
import type { RepositoryModel } from "./RepositoryModel";
import {
  AuditMode,
  AuditQuery,
  buildAuditFilter,
  itemAuditFilter,
  parseDay,
  periodStart,
} from "./auditQuery";
import {
  QueryRows,
  auditCsv,
  auditReportTitle,
  renderAuditReport,
} from "./auditReport";
import type { ItemPicker } from "./jobs/ItemPicker";
import { askLocation } from "./locationPrompt";
import { AuditLabelText, Messages, errorMessage } from "./messages";
import { formatDate } from "./properties";
import { ReportPresenter, stem } from "./report/ReportPresenter";
import type { AuditAction, AuditEntry, RepositoryItem } from "./types";

/** At most this many entries per report, newest first. */
export const MAX_AUDIT_ENTRIES = 1000;
/** The details (what changed) of at most this many entries are read. */
export const MAX_AUDIT_DETAILS = 100;

const STEPS = 5;

interface Shown {
  entries: AuditEntry[];
  query: QueryRows;
  subject?: string;
  total?: number;
  detailsRead: number;
}

interface Choice<T> extends QuickPickItem {
  value: T;
}

export class AuditHistory implements Disposable {
  private readonly presenter: ReportPresenter;
  private last: Shown | undefined;
  // The previous search, offered again.
  private query: AuditQuery = {};
  private days: number | undefined = 7;

  constructor(
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
    private readonly picker: ItemPicker,
  ) {
    this.presenter = new ReportPresenter(
      output,
      "sas.clinicalAudit",
      "Audit history",
    );
  }

  /** What was done to an item; for a folder, also to what is in it. */
  async showItem(item: RepositoryItem): Promise<void> {
    await this.run(
      itemAuditFilter(item),
      [[AuditLabelText.item, `<code>${escapeHtml(item.path)}</code>`]],
      item.name,
    );
  }

  /** Ask for the conditions, then show the matching entries. */
  async search(): Promise<void> {
    const query = await this.ask();
    if (!query) {
      return;
    }
    await this.run(buildAuditFilter(query), describe(query, this.actionNames));
  }

  /** Save the last report (.html) or its entries (.csv). */
  async exportLast(): Promise<void> {
    const last = this.last;
    if (!last) {
      window.showInformationMessage(Messages.AuditNothingToExport);
      return;
    }
    let saved;
    try {
      saved = await this.presenter.save({
        title: Messages.AuditExportTitle,
        defaultName: `audit-history${last.subject ? `-${stem(last.subject, "item")}` : ""}`,
        filters: { HTML: ["html"], CSV: ["csv"] },
        content: (extension) =>
          extension === "csv"
            ? auditCsv(last.entries, AuditLabelText)
            : this.render(last, false),
      });
    } catch (error) {
      this.fail(Messages.AuditExportError, error);
      return;
    }
    if (saved) {
      this.output.info(`Exported the audit history to ${saved.fsPath}.`);
      window.showInformationMessage(
        l10n.t(Messages.AuditExported, { path: saved.fsPath }),
      );
    }
  }

  private async run(
    filter: string | undefined,
    query: QueryRows,
    subject?: string,
  ): Promise<void> {
    this.output.info(`Audit history: filter ${filter ?? "(none)"}`);
    let shown: Shown;
    try {
      shown = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: Messages.AuditSearching,
        },
        async () => {
          const { entries, total } = await this.model.getAuditEntries(
            filter,
            MAX_AUDIT_ENTRIES,
          );
          const detailed = await this.model.loadAuditDetails(
            entries,
            MAX_AUDIT_DETAILS,
          );
          return {
            entries: detailed,
            query,
            subject,
            total,
            detailsRead: Math.min(entries.length, MAX_AUDIT_DETAILS),
          };
        },
      );
    } catch (error) {
      this.fail(Messages.AuditError, error);
      return;
    }
    this.last = shown;
    await this.presenter.show({
      render: (links) => this.render(shown, links),
      title: auditReportTitle(AuditLabelText, subject),
      name: `audit-${stem(subject ?? "history", "history")}`,
    });
  }

  private render(shown: Shown, links: boolean): string {
    return renderAuditReport(
      shown.entries,
      shown.query,
      AuditLabelText,
      {
        locale: env.language,
        total: shown.total,
        detailsRead: shown.detailsRead,
        linkFor: links ? linkFor : undefined,
      },
      shown.subject,
    );
  }

  // Display names of the actions picked in the last search.
  private actionNames = new Map<string, string>();

  private async ask(): Promise<AuditQuery | undefined> {
    const previous = this.query;
    const name = await window.showInputBox({
      title: step(1),
      prompt: Messages.AuditNamePrompt,
      value: previous.name ?? "",
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return undefined;
    }
    const location = await askLocation(this.picker, {
      title: step(2),
      previous: previous.location,
    });
    if (location === undefined) {
      return undefined;
    }
    const actions = await this.askActions(previous.actions ?? []);
    if (actions === undefined) {
      return undefined;
    }
    const modes = await this.askModes(previous.modes ?? []);
    if (modes === undefined) {
      return undefined;
    }
    const period = await this.askPeriod();
    if (period === undefined) {
      return undefined;
    }
    const query: AuditQuery = {
      name: name.trim() || undefined,
      location: location || undefined,
      actions,
      modes,
      ...period,
    };
    this.query = query;
    return query;
  }

  /** The action ids; [] for any; undefined when cancelled. */
  private async askActions(previous: string[]): Promise<string[] | undefined> {
    let actions: AuditAction[];
    try {
      actions = await this.model.getAuditActions();
    } catch (error) {
      // Searching without an action filter still works.
      this.output.warn(
        `The audit actions are unavailable: ${errorMessage(error)}`,
      );
      return [];
    }
    const picks = await window.showQuickPick(
      actions
        .map((a) => ({
          label: a.displayName || a.action,
          description: a.action,
          picked: previous.includes(a.action),
          value: a.action,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      {
        title: step(3),
        placeHolder: Messages.AuditActionsPlaceholder,
        canPickMany: true,
        matchOnDescription: true,
        ignoreFocusOut: true,
      },
    );
    if (!picks) {
      return undefined;
    }
    this.actionNames = new Map(picks.map((p) => [p.value, p.label]));
    return picks.map((p) => p.value);
  }

  private async askModes(
    previous: AuditMode[],
  ): Promise<AuditMode[] | undefined> {
    const modes: AuditMode[] = ["USER", "ADMIN", "SYSTEM"];
    const picks = await window.showQuickPick(
      modes.map((mode) => ({
        label: AuditLabelText.modes[mode],
        picked: previous.includes(mode),
        value: mode,
      })),
      {
        title: step(4),
        placeHolder: Messages.AuditModesPlaceholder,
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    return picks?.map((p) => p.value);
  }

  private async askPeriod(): Promise<
    Pick<AuditQuery, "from" | "to"> | undefined
  > {
    const periods: Choice<number | "any" | "custom">[] = [
      { label: Messages.AuditLastDay, value: 1 },
      { label: Messages.AuditLast7Days, value: 7 },
      { label: Messages.AuditLast30Days, value: 30 },
      { label: Messages.AuditLast90Days, value: 90 },
      { label: Messages.AuditAnyTime, value: "any" },
      { label: Messages.AuditCustomRange, value: "custom" },
    ];
    const quick = window.createQuickPick<Choice<number | "any" | "custom">>();
    quick.title = step(5);
    quick.placeholder = Messages.AuditPeriodPlaceholder;
    quick.items = periods;
    quick.ignoreFocusOut = true;
    const active = periods.find((p) => p.value === (this.days ?? "any"));
    if (active) {
      quick.activeItems = [active];
    }
    const choice = await new Promise<
      Choice<number | "any" | "custom"> | undefined
    >((resolve) => {
      quick.onDidAccept(() => resolve(quick.selectedItems[0]));
      quick.onDidHide(() => resolve(undefined));
      quick.show();
    });
    quick.dispose();
    if (!choice) {
      return undefined;
    }
    if (typeof choice.value === "number") {
      this.days = choice.value;
      return { from: periodStart(choice.value) };
    }
    if (choice.value === "any") {
      this.days = undefined;
      return {};
    }
    const from = await window.showInputBox({
      title: step(5),
      prompt: Messages.AuditFromPrompt,
      placeHolder: "YYYY-MM-DD",
      ignoreFocusOut: true,
      validateInput: (value) =>
        parseDay(value) ? undefined : Messages.AuditDateInvalid,
    });
    if (from === undefined) {
      return undefined;
    }
    const to = await window.showInputBox({
      title: step(5),
      prompt: Messages.AuditToPrompt,
      placeHolder: "YYYY-MM-DD",
      ignoreFocusOut: true,
      validateInput: (value) =>
        !value.trim() || parseDay(value, true)
          ? undefined
          : Messages.AuditDateInvalid,
    });
    if (to === undefined) {
      return undefined;
    }
    return {
      from: parseDay(from),
      to: to.trim() ? parseDay(to, true) : undefined,
    };
  }

  private fail(template: string, error: unknown): void {
    const message = l10n.t(template, { message: errorMessage(error) });
    this.output.error(message);
    window.showErrorMessage(message);
  }

  dispose(): void {
    this.presenter.dispose();
  }
}

const step = (n: number): string =>
  l10n.t(Messages.AuditStep, { step: n, total: STEPS });

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The search conditions as report rows (values already escaped). */
function describe(
  query: AuditQuery,
  actionNames: Map<string, string>,
): QueryRows {
  const any = escapeHtml(AuditLabelText.any);
  const date = (d: Date | undefined) =>
    d ? escapeHtml(formatDate(d.toISOString(), env.language)) : "";
  return [
    [
      AuditLabelText.name,
      query.name ? `<code>${escapeHtml(query.name)}</code>` : any,
    ],
    [
      AuditLabelText.location,
      query.location ? `<code>${escapeHtml(query.location)}</code>` : any,
    ],
    [
      AuditLabelText.action,
      query.actions?.length
        ? escapeHtml(
            query.actions.map((a) => actionNames.get(a) ?? a).join(", "),
          )
        : any,
    ],
    [
      AuditLabelText.mode,
      query.modes?.length
        ? escapeHtml(query.modes.map((m) => AuditLabelText.modes[m]).join(", "))
        : any,
    ],
    [AuditLabelText.from, date(query.from)],
    [AuditLabelText.to, date(query.to)],
  ];
}

/** Files of the entries open from the report; folders and others don't. */
function linkFor(entry: AuditEntry): string | undefined {
  if (
    !entry.sourceId ||
    !entry.sourceName ||
    (entry.sourcePrimaryType !== "FILE" &&
      entry.sourcePrimaryType !== "JOB_FILE")
  ) {
    return undefined;
  }
  const location = entry.sourceLocation ?? "";
  return ReportPresenter.linkTo(
    getItemUri({
      id: entry.sourceId,
      name: entry.sourceName,
      path: `${location === "/" ? "" : location}/${entry.sourceName}`,
    }),
  );
}
