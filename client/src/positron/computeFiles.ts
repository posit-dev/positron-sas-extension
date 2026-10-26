// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { isAxiosError } from "axios";

import { FileSystemApi } from "../connection/rest/api/compute";
import { getApiConfig } from "../connection/rest/common";

const SAS_FILE_SEPARATOR = "~fs~";

/** Compute file API path for an absolute server path ("/a/b" → "~fs~a~fs~b"). */
export const toComputePath = (serverPath: string): string =>
  serverPath.split("/").join(SAS_FILE_SEPARATOR);

/** Describe a failed compute Files API call: step, status, URL, message. */
function describe(step: string, error: unknown): Error {
  if (isAxiosError(error)) {
    const data: unknown = error.response?.data;
    const message =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : error.message;
    return new Error(
      `${step} failed (HTTP ${error.response?.status ?? "?"} ${error.config?.method?.toUpperCase() ?? ""} ${error.config?.url ?? ""}): ${message}`,
    );
  }
  return new Error(
    `${step} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Write `content` to `dir/name` on the SAS Viya compute server through the
 * compute Files API, replacing any earlier copy. `dir` must already exist.
 */
export async function writeComputeFile(
  sessionId: string,
  dir: string,
  name: string,
  content: Uint8Array,
): Promise<string> {
  const api = FileSystemApi(getApiConfig());
  const serverPath = `${dir.replace(/\/+$/, "")}/${name}`;
  let etag: string | undefined;
  try {
    const created = await api.createFileOrDirectory({
      sessionId,
      fileOrDirectoryPath: toComputePath(dir),
      fileProperties: { name, isDirectory: false },
    });
    etag = created.headers?.etag;
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 409) {
      throw describe(`Creating ${serverPath} on the SAS server`, error);
    }
    // Already there from an earlier open: overwrite it.
    try {
      const existing = await api.getFileorDirectoryProperties({
        sessionId,
        fileOrDirectoryPath: toComputePath(serverPath),
      });
      etag = existing.headers?.etag;
    } catch (inner) {
      throw describe(`Reading ${serverPath} on the SAS server`, inner);
    }
  }
  try {
    await api.updateFileContentOnSystem({
      sessionId,
      filePath: toComputePath(serverPath),
      // The generated client types the body as File, but compute accepts raw
      // bytes (RestServerAdapter.updateContentOfItemAtPath does the same).
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      body: content as unknown as File,
      ifMatch: etag,
    });
  } catch (error) {
    throw describe(`Writing ${serverPath} on the SAS server`, error);
  }
  return serverPath;
}
