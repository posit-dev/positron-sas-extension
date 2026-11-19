// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// SAS Life Science Analytics Framework (LSAF): repository and workspace
// views, check-out and check-in, and jobs, over the LSAF REST API 1.0.
// Everything is hidden until the configured URL answers like an LSAF server
// (SAS.lsaf.available), and is independent of the active SAS profile.
import { ExtensionContext, commands, window, workspace } from "vscode";

import { JobsDataProvider } from "./JobsDataProvider";
import { JobsModel } from "./JobsModel";
import { RepositoryDataProvider } from "./RepositoryDataProvider";
import { RepositoryModel } from "./RepositoryModel";
import { WorkspaceDataProvider } from "./WorkspaceDataProvider";
import { WorkspaceModel } from "./WorkspaceModel";
import { LsafSession } from "./auth";
import { REPOSITORY_SCHEME, WORKSPACE_SCHEME } from "./const";
import { JobCommands } from "./jobCommands";
import { JobOutputs } from "./jobOutputs";
import { LsafDetector } from "./probe";
import { RepositoryCommands } from "./repositoryCommands";
import { CheckoutDecorator } from "./uris";
import { WorkspaceCommands } from "./workspaceCommands";

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
  const client = () => session.getClient();
  const repositoryModel = new RepositoryModel(client);
  const decorator = new CheckoutDecorator();
  const repository = new RepositoryDataProvider(
    repositoryModel,
    session,
    decorator,
    context.extensionUri,
    log,
  );
  const workspaceModel = new WorkspaceModel(client);
  const workspaceView = new WorkspaceDataProvider(
    workspaceModel,
    repositoryModel,
    session,
    decorator,
    context.extensionUri,
    log,
  );
  const refreshAll = () => {
    repository.refresh();
    workspaceView.refresh();
  };
  const jobsModel = new JobsModel(client);
  const outputs = new JobOutputs(
    jobsModel,
    repositoryModel,
    workspaceModel,
    log,
  );
  const jobsView = new JobsDataProvider(
    session,
    jobsModel,
    outputs,
    context.globalState,
    output,
    context.extensionUri,
    (run) => {
      // Runs finish on a later poll, after jobCommands below exists.
      jobCommands.notifyFinished(run);
      // A run writes logs, listings and outputs into the trees.
      refreshAll();
    },
  );
  const jobCommands = new JobCommands(
    jobsView,
    jobsModel,
    outputs,
    workspaceModel,
    output,
    refreshAll,
  );

  context.subscriptions.push(
    output,
    session,
    detector,
    decorator,
    repository,
    workspaceView,
    new RepositoryCommands(
      repository,
      repositoryModel,
      workspaceView,
      workspaceModel,
      session,
      output,
    ),
    new WorkspaceCommands(
      repository,
      workspaceView,
      repositoryModel,
      workspaceModel,
      output,
      refreshAll,
    ),
    window.registerFileDecorationProvider(decorator),
    workspace.registerFileSystemProvider(REPOSITORY_SCHEME, repository, {
      isCaseSensitive: true,
      isReadonly: true,
    }),
    workspace.registerFileSystemProvider(WORKSPACE_SCHEME, workspaceView, {
      isCaseSensitive: true,
    }),
    jobsView,
    jobCommands,
    session.onDidChange(() => {
      refreshAll();
      jobsView.refresh();
    }),
    commands.registerCommand("SAS.lsaf.signIn", () => session.signIn()),
    commands.registerCommand("SAS.lsaf.signOut", () => session.signOut()),
    commands.registerCommand("SAS.lsaf.refresh", () => {
      detector.schedule(0);
      refreshAll();
    }),
  );
}
