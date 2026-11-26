// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The types of the Posit Workbench extension's public API (rstudio.rstudio-workbench),
// copied from its src/api.ts (types only). Keep in sync when its apiVersion changes.
import type * as vscode from "vscode";

export const WORKBENCH_EXTENSION_ID = "rstudio.rstudio-workbench";

export interface PositWorkbenchApi {
  readonly apiVersion: 1;

  /**
   * Adds a script type that can be run as a Workbench Job with "Run Script as Workbench Job".
   *
   * Throws if the definition is invalid, or if its id, a file extension or a language id is
   * already registered (R and Python are built in). Dispose the result to remove the type.
   */
  registerScriptType(definition: ScriptTypeDefinition): vscode.Disposable;
}

export interface ScriptTypeDefinition {
  /** Lower case identifier, `/^[a-z][a-z0-9-]{0,31}$/`. `r` and `py` are reserved. */
  id: string;
  /** Display name, e.g. `"SAS"`. */
  label: string;
  /** Language ids for which the run menus are shown, e.g. `["sas"]`. */
  languageIds: readonly string[];
  /** File extensions including the leading dot, matched case-insensitively, e.g. `[".sas"]`. */
  fileExtensions: readonly string[];
  /** Jobs are tagged `job-runtime-env:<runtimeTag>`. Defaults to `id`. `/^[A-Za-z0-9_.-]{1,32}$/` */
  runtimeTag?: string;
  /** An SVG or PNG shown next to the script in the job dialog. */
  iconPath?: vscode.Uri;
  /**
   * Shows an "<label> executable" selector in the job dialog that offers the resolved executable
   * and "Other..." for a custom path. Without it, the resolved executable is always used.
   */
  allowCustomExecutable?: boolean;
  /**
   * Called when the job dialog selects a script of this type, and again when the cluster or image
   * changes. Must settle within 10 seconds.
   */
  resolve(
    script: vscode.Uri,
    context: ScriptResolveContext,
  ): Promise<ResolvedScriptType>;
}

export interface ScriptResolveContext {
  /** The cluster selected in the job dialog, and its image or queue (if any). */
  readonly cluster?: {
    readonly name: string;
    readonly resourceId: string | null;
  };
}

/**
 * How to run a script. The job runs, as separate arguments:
 *
 *   executable ...leadingArgs ...(arguments from the dialog, initially defaultArgs) [scriptFlag] script
 *
 * The script path is always the last argument.
 */
export interface ResolvedScriptType {
  /** A command on the job's PATH, e.g. `"sasjob"`, or an absolute path. */
  executable: string;
  /** Arguments placed before the user's arguments, which the user can't change, e.g. `["run"]`. */
  leadingArgs?: readonly string[];
  /**
   * The initial arguments in the dialog's Arguments editor. Each entry is one argument, so pass
   * an option and its value as two entries. Arguments are trimmed and empty ones are dropped.
   */
  defaultArgs?: readonly string[];
  /** Placed immediately before the script path, e.g. R's `"-f"`. */
  scriptFlag?: string;
  /** Shown in the job dialog below the arguments. */
  warnings?: readonly string[];
}
