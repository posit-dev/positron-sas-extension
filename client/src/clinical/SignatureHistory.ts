// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Signature History of a repository file or of one version of it: a report
// in the Viewer, and its export as HTML or CSV. Read-only; files are signed
// in SAS Clinical Acceleration Repository.
import { Disposable, LogOutputChannel, Uri, env, l10n, window } from "vscode";

import { getItemUri } from "./RepositoryDataProvider";
import type { RepositoryModel } from "./RepositoryModel";
import { getVersionUri } from "./VersionHistoryProvider";
import { Messages, SignatureLabelText, errorMessage } from "./messages";
import { ReportPresenter, stem } from "./report/ReportPresenter";
import {
  SignatureSubject,
  renderSignatureReport,
  signatureReportTitle,
  signaturesCsv,
} from "./signatureReport";
import type { RepositoryItem, Signature, VersionRow } from "./types";
import { isVersionRow } from "./utils";

/** A repository file, or a row of the Version History view. */
export type SignatureTarget = RepositoryItem | VersionRow;

interface Loaded {
  subject: SignatureSubject;
  signatures: Signature[];
  /** Opens the file or version from the report. */
  uri: Uri;
}

export class SignatureHistory implements Disposable {
  private readonly presenter: ReportPresenter;

  constructor(
    private readonly model: RepositoryModel,
    private readonly output: LogOutputChannel,
  ) {
    this.presenter = new ReportPresenter(
      output,
      "sas.clinicalSignatures",
      "Signature history",
    );
  }

  async show(target: SignatureTarget): Promise<void> {
    const loaded = await this.load(target);
    if (!loaded) {
      return;
    }
    await this.presenter.show({
      render: (links) => this.render(loaded, links),
      title: signatureReportTitle(loaded.subject, SignatureLabelText),
      name: `signatures-${stem(loaded.subject.name, "file")}`,
    });
  }

  /** Save the report (.html) or the signatures (.csv). */
  async export(target: SignatureTarget): Promise<void> {
    const loaded = await this.load(target);
    if (!loaded) {
      return;
    }
    const { subject } = loaded;
    let saved: Uri | undefined;
    try {
      saved = await this.presenter.save({
        title: Messages.SignatureExportTitle,
        defaultName: `${stem(subject.name, "file")}${subject.version ? `-v${subject.version}` : ""}-signatures`,
        filters: { HTML: ["html"], CSV: ["csv"] },
        content: (extension) =>
          extension === "csv"
            ? signaturesCsv(loaded.signatures, SignatureLabelText)
            : this.render(loaded, false),
      });
    } catch (error) {
      this.fail(Messages.SignatureExportError, error);
      return;
    }
    if (saved) {
      this.output.info(
        `Exported the signature history of ${subject.path} to ${saved.fsPath}.`,
      );
      window.showInformationMessage(
        l10n.t(Messages.SignatureExported, { path: saved.fsPath }),
      );
    }
  }

  private render(loaded: Loaded, links: boolean): string {
    return renderSignatureReport(
      loaded.subject,
      loaded.signatures,
      SignatureLabelText,
      {
        locale: env.language,
        link: links ? ReportPresenter.linkTo(loaded.uri) : undefined,
      },
    );
  }

  /** The signatures, or undefined after reporting why they can't be read. */
  private async load(target: SignatureTarget): Promise<Loaded | undefined> {
    try {
      if (isVersionRow(target)) {
        return {
          subject: {
            name: target.name,
            path: target.path,
            versioned: true,
            version: target.fileVersion,
          },
          signatures: await this.signatures(
            target.fileId,
            target.path,
            target.fileVersion,
          ),
          uri: getVersionUri(target),
        };
      }
      // The tree can be stale: the status shown must match the list.
      const [item, signatures] = await Promise.all([
        this.model.getItem(target.id),
        this.signatures(target.id, target.path),
      ]);
      return {
        subject: {
          name: item.name,
          path: item.path,
          versioned: item.versioned,
          signingStatus: item.signingStatus,
        },
        signatures,
        uri: getItemUri(item),
      };
    } catch (error) {
      this.fail(Messages.SignatureHistoryError, error);
      return undefined;
    }
  }

  private signatures(
    id: string,
    path: string,
    version?: string,
  ): Promise<Signature[]> {
    return this.model.getSignatures(id, version, (reason) =>
      this.output.warn(
        `The signature history of ${path} was truncated: ${reason}`,
      ),
    );
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
