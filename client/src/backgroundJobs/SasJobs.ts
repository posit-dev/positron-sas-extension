// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Saved SAS jobs (#150, phase 2): save a program as a named SAS job with
// parameters, and run any of the user's SAS jobs with prompts for them. A run
// is an ordinary background job and shows up in the Background Jobs view.
import {
  Disposable,
  QuickPickItem,
  Uri,
  commands,
  env,
  l10n,
  window,
} from "vscode";

import { getActiveViyaEndpoint } from "../viya/endpoint";
import { JobsModel, PreconditionFailedError } from "./JobsModel";
import {
  SasJobNode,
  SasJobsDataProvider,
  fromSubmit,
} from "./SasJobsDataProvider";
import { codeFor, documentFor, keepResultsFor } from "./code";
import type { ComputeContextResolver } from "./computeContext";
import { DEFINITIONS, FOLDERS, SOURCE_PROPERTY } from "./const";
import type { JobLogDocuments } from "./jobLog";
import { BackgroundJobMessages, backgroundJobErrorMessage } from "./messages";
import {
  argumentsFor,
  buildParameters,
  ownContext,
  parameterValueProblem,
  promptableParameters,
  suggestParameters,
} from "./parameters";
import type {
  ExecutionJob,
  JobDefinition,
  JobDefinitionParameter,
} from "./types";
import { jobNameFor, nextName } from "./utils";

export interface SasJobsHost {
  model: JobsModel;
  contexts: ComputeContextResolver;
  documents: JobLogDocuments;
  log: (message: string) => void;
  /** Whether the server runs the Job Definitions service. */
  definitionsAvailable(): boolean;
  /** Show a run that just started in the Background Jobs view, and follow it. */
  track(job: ExecutionJob): Promise<void>;
}

const uriOf = (id: string) => `${DEFINITIONS}/${id}`;

export class SasJobs implements Disposable {
  readonly provider: SasJobsDataProvider;
  private readonly disposables: Disposable[];

  constructor(private readonly host: SasJobsHost) {
    this.provider = new SasJobsDataProvider(host.model, host.log);
    const onDefinition =
      (action: (definition: JobDefinition) => unknown) =>
      (node?: SasJobNode) =>
        node?.kind === "definition" ? action(node.definition) : undefined;
    this.disposables = [
      this.provider,
      commands.registerCommand("SAS.sasJob.saveAs", (uri?: Uri) =>
        this.saveAs(uri),
      ),
      commands.registerCommand(
        "SAS.sasJob.run",
        onDefinition((d) => this.run(d, false)),
      ),
      commands.registerCommand(
        "SAS.sasJob.runWithDefaults",
        onDefinition((d) => this.run(d, true)),
      ),
      commands.registerCommand(
        "SAS.sasJob.showCode",
        onDefinition((d) => this.showCode(d)),
      ),
      commands.registerCommand(
        "SAS.sasJob.copyUri",
        onDefinition((d) => d.id && env.clipboard.writeText(uriOf(d.id))),
      ),
      commands.registerCommand(
        "SAS.sasJob.delete",
        (node?: SasJobNode, nodes?: SasJobNode[]) =>
          this.delete(selected(node, nodes)),
      ),
      commands.registerCommand("SAS.sasJobs.refresh", () =>
        this.provider.refresh(),
      ),
      commands.registerCommand("SAS.sasJobs.loadMore", () =>
        this.provider.loadMore(),
      ),
    ];
  }

  refresh(): void {
    this.provider.refresh();
  }

  // ---------------------------------------------------------------- save

  /** Save the program in the editor as a named SAS job with parameters. */
  private async saveAs(uri?: Uri): Promise<void> {
    const document = await documentFor(uri);
    if (!document) {
      return;
    }
    if (!getActiveViyaEndpoint()) {
      window.showWarningMessage(BackgroundJobMessages.NotViya);
      return;
    }
    if (!this.host.definitionsAvailable()) {
      window.showWarningMessage(BackgroundJobMessages.NoDefinitionsService);
      return;
    }
    // A saved job is the whole program, whatever is selected.
    const code = codeFor(document, []);
    if (!code.trim()) {
      window.showInformationMessage(BackgroundJobMessages.NothingToSubmit);
      return;
    }

    let name = await window.showInputBox({
      title: BackgroundJobMessages.SaveTitle,
      prompt: BackgroundJobMessages.SaveNamePrompt,
      value: jobNameFor({
        fileName: document.fileName,
        untitled: document.isUntitled,
      }),
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return BackgroundJobMessages.SaveNameEmpty;
        }
        if (trimmed.length > 255 || /[/\\]/.test(trimmed)) {
          return BackgroundJobMessages.SaveNameInvalid;
        }
        return undefined;
      },
    });
    name = name?.trim();
    if (!name) {
      return;
    }

    const folder = await this.pickFolder();
    if (!folder) {
      return;
    }

    try {
      // A name already in the folder: replace that SAS job, or pick another.
      const members = await this.host.model.listFolderMembers(folder.id);
      const clash = members.find((m) => m.name === name);
      let replaceId: string | undefined;
      if (clash) {
        const isJob = clash.uri.startsWith(`${DEFINITIONS}/`);
        const free = nextName(name, new Set(members.map((m) => m.name)));
        const choice = await window.showQuickPick(
          [
            ...(isJob
              ? [
                  {
                    label: l10n.t(BackgroundJobMessages.ReplaceExisting, {
                      name,
                    }),
                    action: "replace",
                  },
                ]
              : []),
            {
              label: l10n.t(BackgroundJobMessages.SaveUnderName, {
                name: free,
              }),
              action: "rename",
            },
          ],
          {
            title: BackgroundJobMessages.SaveTitle,
            placeHolder: l10n.t(BackgroundJobMessages.NameTaken, {
              name,
              folder: folder.label,
            }),
            ignoreFocusOut: true,
          },
        );
        if (!choice) {
          return;
        }
        if (choice.action === "replace") {
          replaceId = clash.uri.slice(clash.uri.lastIndexOf("/") + 1);
        } else {
          name = free;
        }
      }

      const parameters = await this.askParameters(code);
      if (!parameters) {
        return;
      }

      const definition: JobDefinition = {
        name,
        description: l10n.t("Saved from Positron: {path}", {
          path: document.isUntitled ? name : document.uri.fsPath,
        }),
        type: "Compute",
        code,
        parameters,
        properties: [{ name: SOURCE_PROPERTY, value: document.uri.toString() }],
      };
      const saved = replaceId
        ? await this.replace(replaceId, definition)
        : (
            await this.host.model.createDefinition(
              definition,
              `${FOLDERS}/${folder.id}`,
            )
          ).definition;
      this.provider.refresh();

      const choice = await window.showInformationMessage(
        l10n.t(BackgroundJobMessages.Saved, { name, folder: folder.label }),
        BackgroundJobMessages.RunNow,
      );
      if (choice && saved.id) {
        await this.run({ ...definition, id: saved.id }, false);
      }
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SaveError, {
          name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  /** Replace a SAS job's code and parameters, with its current ETag. */
  private async replace(
    id: string,
    definition: JobDefinition,
  ): Promise<JobDefinition> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.host.model.getDefinition(id);
      if (!current?.etag) {
        throw new Error(BackgroundJobMessages.ReplaceGone);
      }
      try {
        return (
          await this.host.model.updateDefinition(id, definition, current.etag)
        ).definition;
      } catch (error) {
        if (!(error instanceof PreconditionFailedError) || attempt > 0) {
          throw error;
        }
      }
    }
  }

  /** My Folder, or a SAS Content folder the user names by path. */
  private async pickFolder(): Promise<
    { id: string; label: string } | undefined
  > {
    const myFolder = await this.host.model.getMyFolderId();
    const items: (QuickPickItem & { path?: string })[] = [
      ...(myFolder
        ? [{ label: BackgroundJobMessages.MyFolder, path: "@myFolder" }]
        : []),
      { label: BackgroundJobMessages.OtherFolder },
    ];
    const choice = await window.showQuickPick(items, {
      title: BackgroundJobMessages.SaveTitle,
      placeHolder: BackgroundJobMessages.PickFolder,
      ignoreFocusOut: true,
    });
    if (!choice) {
      return undefined;
    }
    if (choice.path === "@myFolder" && myFolder) {
      return { id: myFolder, label: BackgroundJobMessages.MyFolder };
    }
    // A path such as /Public/Reports. Its form is checked while typing; the
    // server is asked once the user presses Enter, and asked again if needed.
    let value = "";
    let problem: string | undefined;
    for (;;) {
      const path = await window.showInputBox({
        title: BackgroundJobMessages.SaveTitle,
        prompt: problem ?? BackgroundJobMessages.EnterFolderPath,
        placeHolder: "/Public/Reports",
        value,
        ignoreFocusOut: true,
        validateInput: (v) =>
          v.trim().startsWith("/")
            ? undefined
            : BackgroundJobMessages.FolderPathAbsolute,
      });
      if (!path) {
        return undefined;
      }
      value = path.trim();
      const id = await this.host.model.getFolderIdByPath(value);
      if (id) {
        return { id, label: value };
      }
      problem = l10n.t(BackgroundJobMessages.FolderNotFound, { path: value });
    }
  }

  /**
   * Which macro variables become parameters, and their defaults. Undefined
   * when the user cancels; [] when there are none.
   */
  private async askParameters(
    code: string,
  ): Promise<JobDefinitionParameter[] | undefined> {
    const suggested = suggestParameters(code);
    if (!suggested.length) {
      return [];
    }
    const picked = await window.showQuickPick(
      suggested.map((name) => ({ label: `&${name}`, name, picked: true })),
      {
        title: BackgroundJobMessages.SaveTitle,
        placeHolder: BackgroundJobMessages.PickParameters,
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    if (!picked) {
      return undefined;
    }
    const answers: { name: string; defaultValue: string }[] = [];
    for (const { name } of picked) {
      const value = await window.showInputBox({
        title: BackgroundJobMessages.SaveTitle,
        prompt: l10n.t(BackgroundJobMessages.DefaultFor, { name }),
        ignoreFocusOut: true,
      });
      if (value === undefined) {
        return undefined;
      }
      answers.push({ name, defaultValue: value.trim() });
    }
    // A default that is a number makes a numeric parameter.
    return buildParameters(
      answers.map(({ name, defaultValue }) => ({
        name,
        defaultValue,
        type:
          defaultValue !== "" && Number.isFinite(Number(defaultValue))
            ? "NUMERIC"
            : "CHARACTER",
      })),
    );
  }

  // ---------------------------------------------------------------- run

  /**
   * Run a SAS job as a background job: ask for each parameter, prefilled with
   * its default, or take the defaults straight away.
   */
  async run(definition: JobDefinition, useDefaults: boolean): Promise<void> {
    const endpoint = getActiveViyaEndpoint();
    if (!endpoint || !definition.id) {
      window.showWarningMessage(BackgroundJobMessages.NotViya);
      return;
    }
    const parameters = promptableParameters(definition);
    const answers = await promptParameterValues(definition, {
      useDefaults,
      title: l10n.t(BackgroundJobMessages.RunTitle, { name: definition.name }),
    });
    if (!answers) {
      return;
    }

    // A job with its own _contextName (as SAS Studio's jobs have) keeps it.
    const own = ownContext(definition);
    const contextName = own
      ? undefined
      : await this.host.contexts.resolve(endpoint);
    if (!own && !contextName) {
      return;
    }
    try {
      const job = await this.host.model.submit({
        name: definition.name,
        description: definition.description,
        definitionUri: uriOf(definition.id),
        contextName,
        extraArguments: argumentsFor(parameters, answers),
        expiresAfter: keepResultsFor(),
      });
      await this.host.track(job);
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.SubmitError, {
          name: definition.name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  // ---------------------------------------------------------------- other

  private async showCode(definition: JobDefinition): Promise<void> {
    if (!definition.id) {
      return;
    }
    try {
      // The list may leave the code out; read the definition itself.
      const full = await this.host.model.getDefinition(definition.id);
      await this.host.documents.showText(
        definition.id,
        `${definition.name}.sas`,
        full?.definition.code ?? "",
        "sas",
      );
    } catch (error) {
      window.showErrorMessage(
        l10n.t(BackgroundJobMessages.FileError, {
          name: definition.name,
          message: backgroundJobErrorMessage(error),
        }),
      );
    }
  }

  private async delete(definitions: JobDefinition[]): Promise<void> {
    const targets = definitions.filter((d) => d.id);
    if (!targets.length) {
      return;
    }
    const prompt =
      targets.length === 1
        ? l10n.t(BackgroundJobMessages.DeleteSasJobConfirm, {
            name: targets[0].name,
          })
        : l10n.t(BackgroundJobMessages.DeleteSasJobsConfirm, {
            count: targets.length,
          });
    const detail = [
      targets.some(fromSubmit)
        ? BackgroundJobMessages.DeleteFromSubmitDetail
        : "",
      BackgroundJobMessages.DeleteSasJobSchedulesDetail,
    ]
      .filter(Boolean)
      .join(" ");
    const ok = await window.showWarningMessage(
      prompt,
      { modal: true, detail },
      BackgroundJobMessages.Delete,
    );
    if (ok !== BackgroundJobMessages.Delete) {
      return;
    }
    for (const definition of targets) {
      try {
        await this.host.model.deleteDefinition(definition.id!);
      } catch (error) {
        window.showErrorMessage(
          l10n.t(BackgroundJobMessages.DeleteError, {
            name: definition.name,
            message: backgroundJobErrorMessage(error),
          }),
        );
      }
    }
    this.provider.refresh();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function selected(node?: SasJobNode, nodes?: SasJobNode[]): JobDefinition[] {
  const all = nodes?.length ? nodes : node ? [node] : [];
  return all.flatMap((n) => (n.kind === "definition" ? [n.definition] : []));
}

/**
 * Ask for the value of each parameter of a SAS job, starting from its default,
 * or take the defaults. Defaults can't stand in for a required parameter that
 * has none, so then the user is asked anyway. Undefined when cancelled.
 */
export async function promptParameterValues(
  definition: JobDefinition,
  options: { useDefaults: boolean; title: string },
): Promise<Record<string, string> | undefined> {
  const parameters = promptableParameters(definition);
  const ask =
    !options.useDefaults ||
    parameters.some((p) => p.required && !p.defaultValue?.trim());
  const answers: Record<string, string> = {};
  for (const parameter of parameters) {
    if (!ask) {
      answers[parameter.name] = parameter.defaultValue ?? "";
      continue;
    }
    const value = await window.showInputBox({
      title: options.title,
      prompt: l10n.t(BackgroundJobMessages.ParameterPrompt, {
        label: parameter.label || parameter.name,
        name: parameter.name,
        type: parameter.type,
      }),
      value: parameter.defaultValue ?? "",
      ignoreFocusOut: true,
      validateInput: (v) => {
        switch (parameterValueProblem(parameter, v)) {
          case "required":
            return BackgroundJobMessages.ValueRequired;
          case "number":
            return BackgroundJobMessages.ValueNumber;
          default:
            return undefined;
        }
      },
    });
    if (value === undefined) {
      return undefined;
    }
    answers[parameter.name] = value;
  }
  return answers;
}
