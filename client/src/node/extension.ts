// Copyright © 2022-2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  ConfigurationChangeEvent,
  ExtensionContext,
  LogOutputChannel,
  Uri,
  authentication,
  commands,
  l10n,
  languages,
  tasks,
  window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import * as path from "path";

import { checkProfileAndAuthorize } from "../commands/authorize";
import { closeSession } from "../commands/closeSession";
import { exportSaspyConfig } from "../commands/exportSaspyConfig";
import { saveViyaTokenForSaspy } from "../commands/saveViyaToken";
import { newSASFile, newSASNotebook } from "../commands/new";
import {
  addProfile,
  deleteProfile,
  profileConfig,
  switchProfile,
  updateProfile,
} from "../commands/profile";
import { run, runRegion, runSelected } from "../commands/run";
import { toggleLineComment } from "../commands/toggleLineComment";
import { getRestAPIs } from "../components/APIProvider";
import { SASAuthProvider } from "../components/AuthProvider";
import { installCAs } from "../components/CAHelper";
import ContentNavigator from "../components/ContentNavigator";
import { ContentSourceType } from "../components/ContentNavigator/types";
import { setContext } from "../components/ExtensionContext";
import LibraryNavigator from "../components/LibraryNavigator";
import {
  ResultPanelSubscriptionProvider,
  SAS_RESULT_PANEL,
  deserializeWebviewPanel,
} from "../components/ResultPanel";
import {
  getStatusBarItem,
  resetStatusBarItem,
  updateStatusBarItem,
} from "../components/StatusBarItem";
import { LogTokensProvider, legend } from "../components/logViewer";
import { sasDiagnostic } from "../components/logViewer/sasDiagnostics";
import { NotebookController } from "../components/notebook/Controller";
import { NotebookSerializer } from "../components/notebook/Serializer";
import { exportNotebook, saveOutput } from "../components/notebook/exporters";
import { ConnectionType } from "../components/profile";
import { isWindowsSSHProfile } from "../connection/ssh/platform";
import { SasTaskProvider } from "../components/tasks/SasTaskProvider";
import { SAS_TASK_TYPE } from "../components/tasks/SasTasks";
// Import Positron integration
import {
  isPositron,
  initializePositronIntegration,
  // getDataViewerProvider,
  // getRuntimeManager,
} from "../positron";
import { BackgroundJobs } from "../backgroundJobs";
import { ClinicalRepository } from "../clinical";
import { registerLsaf } from "../lsaf";
import { Sas7bdatEditorProvider } from "../positron/Sas7bdatEditorProvider";
import {
  addLocalSasProfile,
  findLocalSas,
  localSasCandidates,
  stdioSasPath,
} from "../positron/localSasProfile";
import { XptEditorProvider } from "../positron/XptEditorProvider";

let client: LanguageClient;
let localProfileLog: LogOutputChannel | undefined;

export let extensionContext: ExtensionContext | undefined;

export async function activate(context: ExtensionContext) {
  // The server is implemented in node
  extensionContext = context;
  const serverModule = context.asAbsolutePath(
    path.join("server", "dist", "node", "server.js"),
  );
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for sas file
    documentSelector: [{ language: "sas" }],
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "sas-lsp",
    "SAS Language Server",
    serverOptions,
    clientOptions,
  );

  // Start the client. This will also launch the server
  client.start();

  installCAs();

  setContext(context);

  // In Positron, don't create the tree view since libraries appear in Connections pane
  const libraryNavigator = new LibraryNavigator(context, !isPositron());

  // Below we have two content navigators. We'll have one to navigate
  // SAS Content and another to navigate SAS Server. Both of these will
  // also determine which adapter to use for processing. The options look
  // like this:
  // - rest connection w/ sourceType="sasContent" uses a RestContentAdapter
  // - rest connection w/ sourceType="sasServer" uses a RestServerAdapter
  // - itc/iom connection w/ sourceType="sasServer" uses ItcServerAdapter
  const sasContentNavigator = new ContentNavigator(context, {
    mimeType: "application/vnd.code.tree.contentdataprovider",
    sourceType: ContentSourceType.SASContent,
    treeIdentifier: "contentdataprovider",
  });
  const sasServerNavigator = new ContentNavigator(context, {
    mimeType: "application/vnd.code.tree.serverdataprovider",
    sourceType: ContentSourceType.SASServer,
    treeIdentifier: "serverdataprovider",
  });
  const handleFileUpdated = (e) => {
    switch (e.type) {
      case "rename":
        sasDiagnostic.updateDiagnosticUri(e.uri, e.newUri);
        break;
      case "recycle":
      case "delete":
        sasDiagnostic.ignoreAll(e.uri);
        break;
    }
  };

  const resultPanelSubscriptionProvider = new ResultPanelSubscriptionProvider();

  window.registerWebviewPanelSerializer(SAS_RESULT_PANEL, {
    deserializeWebviewPanel,
  });

  context.subscriptions.push(
    commands.registerCommand("SAS.run", async () => {
      await run();
      await libraryNavigator.refresh();
      libraryNavigator.refreshOpenTableViewers();
    }),
    commands.registerCommand("SAS.runSelected", async (uri: Uri) => {
      await runSelected(uri);
      await libraryNavigator.refresh();
      libraryNavigator.refreshOpenTableViewers();
    }),
    commands.registerCommand("SAS.runRegion", async () => {
      await runRegion(client);
      await libraryNavigator.refresh();
      libraryNavigator.refreshOpenTableViewers();
    }),
    commands.registerCommand("SAS.close", (silent) => {
      closeSession(
        silent === true ? undefined : l10n.t("The SAS session has closed."),
      );
    }),
    commands.registerCommand("SAS.switchProfile", switchProfile),
    commands.registerCommand("SAS.addProfile", addProfile),
    commands.registerCommand("SAS.deleteProfile", deleteProfile),
    commands.registerCommand("SAS.updateProfile", updateProfile),
    commands.registerCommand("SAS.exportSaspyConfig", exportSaspyConfig),
    commands.registerCommand("SAS.addLocalSasProfile", () =>
      addLocalProfile(context, true),
    ),
    commands.registerCommand("SAS.saveViyaTokenForSaspy", saveViyaTokenForSaspy),
    commands.registerCommand(
      "SAS.authorize",
      checkProfileAndAuthorize(libraryNavigator),
    ),
    authentication.registerAuthenticationProvider(
      SASAuthProvider.id,
      "SAS",
      new SASAuthProvider(),
    ),
    languages.registerDocumentSemanticTokensProvider(
      { language: "sas-log" },
      LogTokensProvider,
      legend,
    ),
    getStatusBarItem(),
    ...libraryNavigator.getSubscriptions(),
    ...sasContentNavigator.getSubscriptions(),
    ...sasServerNavigator.getSubscriptions(),
    ...resultPanelSubscriptionProvider.getSubscriptions(),
    sasContentNavigator.onDidManipulateFile(handleFileUpdated),
    sasServerNavigator.onDidManipulateFile(handleFileUpdated),
    // If configFile setting is changed, update watcher to watch new configuration file
    workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("SAS.connectionProfiles")) {
        triggerProfileUpdate();
        updateViewSettings();
      }
    }),
    workspace.registerNotebookSerializer(
      "sas-notebook",
      new NotebookSerializer(),
    ),
    new NotebookController(),
    commands.registerCommand("SAS.notebook.new", newSASNotebook),
    commands.registerCommand("SAS.file.new", newSASFile),
    commands.registerCommand("SAS.notebook.export", () =>
      exportNotebook(client),
    ),
    commands.registerCommand("SAS.notebook.saveOutput", saveOutput),
    tasks.registerTaskProvider(SAS_TASK_TYPE, new SasTaskProvider()),
    ...sasDiagnostic.getSubscriptions(),
    commands.registerTextEditorCommand("SAS.toggleLineComment", (editor) => {
      toggleLineComment(editor, client);
    }),
  );

  // Open .sas7bdat files in Positron's Data Explorer via custom editor
  Sas7bdatEditorProvider.register(context);
  XptEditorProvider.register(context);
  ClinicalRepository.register(context);
  // Submit programs as SAS Viya background jobs (#150).
  BackgroundJobs.register(context);
  // SAS Life Science Analytics Framework, when an LSAF server is configured.
  registerLsaf(context);

  // Reset first to set "No Active Profiles"
  resetStatusBarItem();
  // Update status bar if profile is found
  updateStatusBarItem();

  profileConfig.migrateLegacyProfiles();
  triggerProfileUpdate();
  updateViewSettings();

  // Initialize Positron integration if running in Positron
  if (isPositron()) {
    // Before the integration starts, so runtime discovery sees the profile.
    await addLocalProfile(context);

    console.log("Running in Positron - initializing Positron integration");
    await initializePositronIntegration(context);
  }

  return {
    getRestAPIs,
  };
}

/**
 * Add the "local" profile when SAS is installed here. A write that fails
 * every retry (settings.json changed by another writer, or left with unsaved
 * changes) is reported with a Retry; the next start tries again too. Each
 * step is logged to the "SAS Local Profile" output channel. `manual` is the
 * SAS: Add Local SAS Profile command, which reports what it did.
 */
async function addLocalProfile(
  context: ExtensionContext,
  manual = false,
): Promise<void> {
  const log = (localProfileLog ??= window.createOutputChannel(
    "SAS Local Profile",
    { log: true },
  ));
  const candidates = localSasCandidates(
    workspace.getConfiguration("SAS").get<string[]>("localSasPaths") ?? [],
  );
  if (manual) {
    const sasPath = findLocalSas(candidates);
    if (!sasPath) {
      log.info(
        `No SAS found: none of these is an executable file: ${candidates.join(", ")}`,
      );
      window.showWarningMessage(
        l10n.t(
          "SAS was not found on this machine. If it is installed in another place, add the path of its launcher to the SAS.localSasPaths setting.",
        ),
      );
      return;
    }
    const profiles = profileConfig.getAllProfiles() ?? {};
    const existing = Object.keys(profiles).find(
      (key) => stdioSasPath(profiles[key]) === sasPath,
    );
    if (existing !== undefined) {
      window.showInformationMessage(
        l10n.t(
          'The connection profile "{name}" already uses the local SAS at {path}.',
          { name: existing, path: sasPath },
        ),
      );
      return;
    }
  }
  const localProfile = await addLocalSasProfile(
    profileConfig,
    context.globalState,
    candidates,
    undefined,
    {
      manual,
      log: (message) => log.info(message),
      onFailed: (error) => {
        const retry = l10n.t("Retry");
        window
          .showWarningMessage(
            l10n.t(
              "SAS could not save the local SAS profile to settings.json ({message}). If settings.json has unsaved changes, save or revert it, then click Retry.",
              {
                message: error instanceof Error ? error.message : String(error),
              },
            ),
            retry,
          )
          .then((choice) => {
            if (choice === retry) {
              void addLocalProfile(context, manual);
            }
          });
      },
    },
  );
  if (localProfile) {
    console.log(`Added connection profile "${localProfile}" for local SAS`);
    triggerProfileUpdate();
    updateViewSettings();
    if (manual) {
      window.showInformationMessage(
        l10n.t('Added the connection profile "{name}" for the local SAS.', {
          name: localProfile,
        }),
      );
    }
    // Another writer (Posit Workbench at session start) can replace
    // settings.json after our write; say so if the profile is gone.
    setTimeout(() => {
      if (profileConfig.getAllProfiles()?.[localProfile]) {
        log.info(`The profile "${localProfile}" is still in the settings.`);
      } else {
        log.warn(
          `The profile "${localProfile}" is no longer in the settings: another writer replaced settings.json after it was added.`,
        );
      }
    }, 15_000);
  }
}

function updateViewSettings(): void {
  const activeProfile = profileConfig.getProfileByName(
    profileConfig.getActiveProfile(),
  );

  // SSH and stdio sessions only run code: no sign-in, library or server
  // views. SAS on Windows over SSH runs the COM bridge, so it has them.
  const isCodeOnly =
    (activeProfile?.connectionType === ConnectionType.SSH ||
      activeProfile?.connectionType === ConnectionType.Stdio) &&
    !isWindowsSSHProfile(activeProfile);
  const settings = {
    canSignIn: !isCodeOnly,
    librariesEnabled: false,
    contentEnabled: false,
    librariesDisplayed: false,
    serverEnabled: false,
    serverDisplayed: false,
    allowDownload: true,
  };
  if (activeProfile) {
    settings.librariesEnabled = !isCodeOnly;
    settings.serverEnabled = !isCodeOnly;
    settings.contentEnabled =
      activeProfile.connectionType === ConnectionType.Rest;
  }

  Object.entries(settings).forEach(([key, value]) =>
    commands.executeCommand("setContext", `SAS.${key}`, value),
  );
}

function triggerProfileUpdate(): void {
  commands.executeCommand("SAS.close", true);
  const profileList = profileConfig.getAllProfiles();
  const activeProfileName = profileConfig.getActiveProfile();
  // Without a profile, Sign In in the SAS view container can only ask for
  // one; it is hidden when that container is not needed for LSAF.
  commands.executeCommand(
    "setContext",
    "SAS.hasActiveProfile",
    !!profileList[activeProfileName],
  );
  if (profileList[activeProfileName]) {
    updateStatusBarItem();

    const connectionType =
      profileList[activeProfileName].connectionType || ConnectionType.Rest;

    //Set the connection type
    commands.executeCommand("setContext", "SAS.connectionType", connectionType);

    //See if the connection is direct (ie. serverId)
    commands.executeCommand(
      "setContext",
      "SAS.connection.direct",
      connectionType === ConnectionType.Rest &&
        "serverId" in profileList[activeProfileName],
    );
  } else {
    // Only clear a stale name: writing "" when it is already "" rewrote
    // settings.json on every profile change, racing with other writers.
    if (activeProfileName) {
      profileConfig.updateActiveProfileSetting("");
    }
    commands.executeCommand(
      "setContext",
      "SAS.connectionType",
      ConnectionType.Rest,
    );
  }
}

export async function deactivate(): Promise<void> {
  console.log("Extension deactivating...");

  // Clean up Positron integration if running in Positron
  if (isPositron()) {
    const { cleanupPositronIntegration } = await import("../positron");
    await cleanupPositronIntegration();
  }

  // Stop language server client
  if (client) {
    await client.stop();
  }

  console.log("Extension deactivated");
}
