// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF repository over the REST API: listing, properties, contents,
// versions and signatures, and the file actions (upload, check out, check in,
// undo check out). Nothing here imports `vscode`.
import { LsafClient, checkAction } from "./LsafClient";
import { CHILDREN_LIMIT } from "./const";
import { normalizeRepositoryItem } from "./items";
import { repositoryContainerUrl, repositoryFileUrl } from "./paths";
import type {
  ActionResult,
  FileSignature,
  FileVersion,
  ItemCollection,
  RepositoryItem,
} from "./types";

/** Ask for every property and a status message in action results. */
const EXPAND_ACTION = "item,status";

export interface UploadOptions {
  /** MAJOR, MINOR or a number such as 2.3; leave out for unversioned. */
  version?: string;
  comment?: string;
  /** Replace an existing unversioned file. */
  overwrite?: boolean;
  createParents?: boolean;
}

export interface CheckInOptions {
  /** MAJOR (the server's default), MINOR or a number; versioned files only. */
  version?: string;
  comment?: string;
}

/** A multipart body with the `filename` and `file` parts the API asks for. */
export function fileForm(name: string, content: Uint8Array): FormData {
  const form = new FormData();
  form.append("filename", name);
  // slice() hands Blob a plain ArrayBuffer-backed copy.
  form.append("file", new Blob([content.slice()]), name);
  return form;
}

export class RepositoryModel {
  constructor(private readonly client: () => LsafClient) {}

  /**
   * The items in a container (`/` for the top level). The API has no paging;
   * `onTruncated` is told when a folder may hold more than was returned.
   */
  async getChildren(
    path: string,
    onTruncated?: (count: number) => void,
  ): Promise<RepositoryItem[]> {
    const collection = await this.client().getJson<
      ItemCollection<RepositoryItem>
    >(repositoryContainerUrl(path), {
      component: "children",
      childType: "all",
      expand: "item",
      limit: CHILDREN_LIMIT,
    });
    const items = (collection?.items ?? []).map(normalizeRepositoryItem);
    if (items.length >= CHILDREN_LIMIT) {
      onTruncated?.(items.length);
    }
    return items;
  }

  async getFileProperties(
    path: string,
    version?: string,
  ): Promise<RepositoryItem> {
    return normalizeRepositoryItem(
      await this.client().getJson<RepositoryItem>(repositoryFileUrl(path), {
        component: "properties",
        version,
      }),
    );
  }

  async getContainerProperties(path: string): Promise<RepositoryItem> {
    return normalizeRepositoryItem(
      await this.client().getJson<RepositoryItem>(
        repositoryContainerUrl(path),
        { component: "properties" },
      ),
    );
  }

  /** A file's content; the latest version unless `version` is given. */
  getContent(path: string, version?: string): Promise<Uint8Array> {
    return this.client().getBytes(repositoryFileUrl(path), {
      component: "contents",
      version,
    });
  }

  /** A container and everything below it, as a zip. */
  downloadContainer(path: string): Promise<Uint8Array> {
    return this.client().getBytes(repositoryContainerUrl(path), {
      component: "contents",
    });
  }

  async getVersions(path: string): Promise<FileVersion[]> {
    const collection = await this.client().getJson<ItemCollection<FileVersion>>(
      repositoryFileUrl(path),
      { component: "versions" },
    );
    return collection?.items ?? [];
  }

  /** Signatures of every version, or of one. */
  async getSignatures(
    path: string,
    version?: string,
  ): Promise<FileSignature[]> {
    const collection = await this.client().getJson<
      ItemCollection<FileSignature>
    >(repositoryFileUrl(path), { component: "signatures", version });
    return collection?.items ?? [];
  }

  /** Create a file, or a new version of a versioned one. */
  async upload(
    path: string,
    name: string,
    content: Uint8Array,
    options: UploadOptions = {},
  ): Promise<RepositoryItem | undefined> {
    const result = await this.client().putJson<ActionResult<RepositoryItem>>(
      repositoryFileUrl(path),
      {
        action: "upload",
        createParents: options.createParents,
        overwrite: options.overwrite,
        version: options.version,
        comment: options.comment || undefined,
        expand: EXPAND_ACTION,
      },
      fileForm(name, content),
    );
    checkAction(result, `Uploading ${path}`);
    return result?.item;
  }

  /**
   * Check a file out; `copyToWorkspace` (the server's default) also replaces
   * the workspace copy with the repository's.
   */
  async checkOut(path: string, copyToWorkspace = true): Promise<void> {
    const result = await this.client().putJson<ActionResult>(
      repositoryFileUrl(path),
      { action: "checkout", copyToWorkspace, expand: EXPAND_ACTION },
    );
    checkAction(result, `Checking out ${path}`);
  }

  /**
   * Check the workspace copy of a checked-out file in. The spec gives this
   * call (unlike check-out) a multipart request body with no fields, so an
   * empty form is sent: a server that only consumes multipart would refuse
   * a request without one.
   */
  async checkIn(path: string, options: CheckInOptions = {}): Promise<void> {
    const result = await this.client().putJson<ActionResult>(
      repositoryFileUrl(path),
      {
        action: "checkin",
        version: options.version,
        comment: options.comment || undefined,
        expand: EXPAND_ACTION,
      },
      new FormData(),
    );
    checkAction(result, `Checking in ${path}`);
  }

  async undoCheckOut(path: string): Promise<void> {
    const result = await this.client().putJson<ActionResult>(
      repositoryFileUrl(path),
      { action: "undocheckout", expand: EXPAND_ACTION },
    );
    checkAction(result, `Undoing the check-out of ${path}`);
  }
}
