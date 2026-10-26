// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { FileSystemApi } from "../connection/rest/api/compute";
import { getApiConfig } from "../connection/rest/common";

const SAS_FILE_SEPARATOR = "~fs~";

/** Compute file API path for an absolute server path ("/a/b" → "~fs~a~fs~b"). */
export const toComputePath = (serverPath: string): string =>
  serverPath.split("/").join(SAS_FILE_SEPARATOR);

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
  } catch {
    // Already there from an earlier open: overwrite it.
    const existing = await api.getFileorDirectoryProperties({
      sessionId,
      fileOrDirectoryPath: toComputePath(serverPath),
    });
    etag = existing.headers?.etag;
  }
  await api.updateFileContentOnSystem({
    sessionId,
    filePath: toComputePath(serverPath),
    // The generated client types the body as File, but compute accepts raw
    // bytes (RestServerAdapter.updateContentOfItemAtPath does the same).
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    body: content as unknown as File,
    ifMatch: etag,
  });
  return serverPath;
}
