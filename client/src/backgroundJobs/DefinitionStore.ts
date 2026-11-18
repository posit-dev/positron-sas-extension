// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// One job definition per source document, kept in a "Positron Jobs" folder in
// the user's My Folder and updated in place, so repeated submits of the same
// program don't fill SAS Content with copies.
//
// Nothing here imports `vscode`; the Memento it persists to is injected.
import { JobsModel, PreconditionFailedError } from "./JobsModel";
import {
  CREATED_BY_PROPERTY,
  DEFINITIONS,
  DEFINITIONS_FOLDER_NAME,
  FOLDERS,
  SOURCE_PROPERTY,
} from "./const";
import type { JobDefinition, RememberedDefinition } from "./types";
import { codeHash, nextName } from "./utils";

/** The subset of a vscode Memento this needs. */
export interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface EnsuredDefinition {
  /** `/jobDefinitions/definitions/{id}`, to submit by reference. */
  uri: string;
  id: string;
  /** What happened, for the log. */
  action: "reused" | "updated" | "created";
}

const KEY_PREFIX = "backgroundJobs.definitions:";

export class DefinitionStore {
  private folderUri: string | undefined;
  private folderEndpoint: string | undefined;

  constructor(
    private readonly model: JobsModel,
    private readonly store: StateStore,
    private readonly log: (message: string) => void = () => {},
  ) {}

  private key(endpoint: string): string {
    return `${KEY_PREFIX}${endpoint}`;
  }

  private remembered(endpoint: string): Record<string, RememberedDefinition> {
    return this.store.get(this.key(endpoint)) ?? {};
  }

  private async remember(
    endpoint: string,
    documentUri: string,
    entry: RememberedDefinition | undefined,
  ): Promise<void> {
    const all = { ...this.remembered(endpoint) };
    if (entry) {
      all[documentUri] = entry;
    } else {
      delete all[documentUri];
    }
    await this.store.update(this.key(endpoint), all);
  }

  /**
   * The definition to submit for a document: reused untouched when the code is
   * unchanged, updated in place when it changed, created when there is none.
   */
  async ensure(options: {
    endpoint: string;
    documentUri: string;
    name: string;
    code: string;
    description?: string;
  }): Promise<EnsuredDefinition> {
    const { endpoint, documentUri, name, code, description } = options;
    const hash = codeHash(name, code);
    const known = this.remembered(endpoint)[documentUri];

    if (known) {
      const current = await this.model.getDefinition(known.id);
      if (!current) {
        // Deleted on the server, e.g. by the user in SAS Content.
        this.log(`Job definition ${known.id} is gone; creating a new one.`);
        await this.remember(endpoint, documentUri, undefined);
      } else if (known.codeHash === hash) {
        return { uri: uriOf(known.id), id: known.id, action: "reused" };
      } else {
        const updated = await this.update(
          known.id,
          editableFields(current.definition, code, description),
          current.etag,
        );
        if (updated) {
          await this.remember(endpoint, documentUri, {
            ...known,
            codeHash: hash,
            etag: updated.etag,
          });
          return { uri: uriOf(known.id), id: known.id, action: "updated" };
        }
        // Could not update (changed twice under us): fall through to create.
      }
    }

    const created = await this.create(
      endpoint,
      name,
      code,
      documentUri,
      description,
    );
    await this.remember(endpoint, documentUri, {
      id: created.id,
      name: created.name,
      codeHash: hash,
      etag: created.etag,
    });
    return { uri: uriOf(created.id), id: created.id, action: "created" };
  }

  /** Update once; on a stale ETag re-read and retry once more. */
  private async update(
    id: string,
    definition: JobDefinition,
    etag: string | undefined,
  ): Promise<{ etag?: string } | undefined> {
    let tag = etag;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!tag) {
        tag = (await this.model.getDefinition(id))?.etag;
      }
      if (!tag) {
        return undefined;
      }
      try {
        return await this.model.updateDefinition(id, definition, tag);
      } catch (error) {
        if (!(error instanceof PreconditionFailedError)) {
          throw error;
        }
        this.log(`Job definition ${id} changed on the server; retrying.`);
        tag = undefined;
      }
    }
    return undefined;
  }

  private async create(
    endpoint: string,
    name: string,
    code: string,
    documentUri: string,
    description: string | undefined,
  ): Promise<{ id: string; name: string; etag?: string }> {
    const folderUri = await this.folder(endpoint);
    const taken = new Set<string>();
    if (folderUri) {
      const members = await this.model.listFolderMembers(
        folderUri.slice(folderUri.lastIndexOf("/") + 1),
      );
      members.forEach((m) => taken.add(m.name));
    }
    const freeName = nextName(name, taken);
    const { definition, etag } = await this.model.createDefinition(
      {
        name: freeName,
        description,
        type: "Compute",
        code,
        properties: [
          { name: CREATED_BY_PROPERTY, value: "true" },
          { name: SOURCE_PROPERTY, value: documentUri },
        ],
      },
      folderUri,
    );
    if (!definition.id) {
      throw new Error(
        "The server did not return an id for the job definition.",
      );
    }
    return { id: definition.id, name: freeName, etag };
  }

  /**
   * `/folders/folders/{id}` of the "Positron Jobs" folder in My Folder,
   * created on first use. Undefined when folders can't be used, in which case
   * definitions are created without a parent folder.
   */
  private async folder(endpoint: string): Promise<string | undefined> {
    if (this.folderUri && this.folderEndpoint === endpoint) {
      return this.folderUri;
    }
    try {
      const myFolderId = await this.model.getMyFolderId();
      if (!myFolderId) {
        return undefined;
      }
      const members = await this.model.listFolderMembers(myFolderId);
      const existing = members.find(
        (m) =>
          m.name === DEFINITIONS_FOLDER_NAME && m.uri.startsWith(`${FOLDERS}/`),
      );
      const id = existing
        ? existing.uri.slice(existing.uri.lastIndexOf("/") + 1)
        : await this.model.createFolder(myFolderId, DEFINITIONS_FOLDER_NAME);
      this.folderUri = `${FOLDERS}/${id}`;
      this.folderEndpoint = endpoint;
      return this.folderUri;
    } catch (error) {
      this.log(
        `Could not use a SAS Content folder for job definitions: ${error}`,
      );
      return undefined;
    }
  }

  /** Forget the cached folder, e.g. after the profile changed. */
  reset(): void {
    this.folderUri = undefined;
    this.folderEndpoint = undefined;
  }
}

const uriOf = (id: string) => `${DEFINITIONS}/${id}`;

/**
 * The fields of a definition this extension owns, for a PUT. The GET also
 * returns links and server timestamps, which have no business in an update.
 */
function editableFields(
  current: JobDefinition,
  code: string,
  description: string | undefined,
): JobDefinition {
  return {
    name: current.name,
    description: description ?? current.description,
    type: current.type || "Compute",
    code,
    parameters: current.parameters,
    properties: current.properties,
  };
}
