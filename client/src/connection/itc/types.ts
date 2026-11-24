// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { BaseConfig } from "..";

export enum ScriptActions {
  CreateDirectory = `$runner.CreateDirectory($folderPath, $folderName)`,
  CreateFile = `$runner.CreateFile($folderPath, $fileName, $content)`,
  DeleteFile = `$runner.DeleteFile($filePath)`,
  FetchFileContent = `$runner.FetchFileContent($filePath, $outputFile)`,
  FetchFileContentBase64 = `FetchFileContentBase64 $runner $filePath`,
  GetChildItems = `$runner.GetChildItems($path, $fileNavigationCustomRootPath, $fileNavigationRoot)`,
  RenameFile = `$runner.RenameFile($oldPath,$newPath,$newName)`,
  UpdateFile = `$runner.UpdateFile($filePath, $content)`,
}

export enum ITCProtocol {
  COM = 0,
  IOMBridge = 2,
}

/**
 * Configuration parameters for this connection provider
 */
export interface Config extends BaseConfig {
  host: string;
  port: number;
  username: string;
  protocol: ITCProtocol;
  interopLibraryFolderPath?: string;
}

/**
 * The parts of the PowerShell process the session uses: a local child
 * process, or a channel to PowerShell on a remote machine.
 */
export interface ShellProcess {
  stdin: {
    write(data: string, callback?: (error?: Error | null) => void): unknown;
  };
  stdout: { on(event: "data", listener: (data: Buffer) => void): unknown };
  stderr: { on(event: "data", listener: (data: Buffer) => void): unknown };
  kill(): unknown;
  readonly killed: boolean;
}

export type PowershellResponse = {
  category: number;
  creationTimeStamp?: string;
  modifiedTimeStamp: string;
  name: string;
  parentFolderUri: string;
  size: number;
  uri: string;
};
