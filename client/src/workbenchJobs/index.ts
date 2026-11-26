// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Run SAS programs as Posit Workbench Jobs. The Posit Workbench extension owns
// the "Run Script in a Workbench Job" command, its dialog and the Workbench
// Jobs view; this registers SAS programs with it, to run with `sasjob`.
import { ExtensionContext, Uri, extensions, workspace } from "vscode";

import { profileConfig } from "../commands/profile";
import { ConnectionType, toAutoExecLines } from "../components/profile";
import {
  PositWorkbenchApi,
  WORKBENCH_EXTENSION_ID,
} from "./posit-workbench-api";
import { DEFAULT_SASJOB, resolveSasJob } from "./sasjob";

export function registerWorkbenchJobs(context: ExtensionContext): void {
  // Only Posit Workbench sessions (Positron Pro, VS Code) have the extension.
  const workbench = extensions.getExtension<PositWorkbenchApi | undefined>(
    WORKBENCH_EXTENSION_ID,
  );
  if (!workbench) {
    return;
  }
  // Don't wait for it: the Workbench extension can take a while to activate.
  workbench.activate().then(
    (api) => {
      if (api?.apiVersion !== 1) {
        console.log(
          "The Posit Workbench extension does not support other script types; SAS programs can't run as Workbench Jobs.",
        );
        return;
      }
      try {
        context.subscriptions.push(
          api.registerScriptType({
            id: "sas",
            label: "SAS",
            languageIds: ["sas"],
            fileExtensions: [".sas"],
            runtimeTag: "sas",
            iconPath: Uri.joinPath(
              context.extensionUri,
              "icons",
              "light",
              "sasProgramFileLight.svg",
            ),
            allowCustomExecutable: true,
            resolve: async (_script, { cluster }) => {
              const detail = profileConfig.getActiveProfileDetail();
              const profile = detail?.profile;
              const autoExec =
                profile?.connectionType === ConnectionType.Rest
                  ? profile.autoExec
                  : undefined;
              return resolveSasJob({
                profile,
                profileName: detail?.name,
                autoExecLines: autoExec ? toAutoExecLines(autoExec) : [],
                executable:
                  workspace
                    .getConfiguration("SAS")
                    .get<string>("workbenchJobs.sasjobPath") || DEFAULT_SASJOB,
                cluster,
              });
            },
          }),
        );
      } catch (error) {
        console.warn(
          "Could not register SAS programs for Workbench Jobs:",
          error,
        );
      }
    },
    (error) => {
      console.warn("The Posit Workbench extension did not activate:", error);
    },
  );
}
