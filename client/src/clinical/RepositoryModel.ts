// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/RepositoryModel.ts and
// WorkspaceModel.ts (Apache-2.0).
import { authentication } from "vscode";

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  isAxiosError,
} from "axios";
import { randomUUID } from "crypto";

import { profileConfig } from "../commands/profile";
import { SASAuthProvider } from "../components/AuthProvider";
import { ConnectionType } from "../components/profile";
import { getActionToken, pollActionStatus } from "./actionStatus";
import {
  AUTHORIZATIONS,
  PERMISSION_CONCURRENCY,
  REPOSITORY_FILES_CONTENT,
  REPOSITORY_ITEMS,
  REPOSITORY_ITEM_MEDIA_TYPE,
  REPOSITORY_PATHS,
  ROOT_ITEM_ID,
  TYPES,
  WORKSPACE_ITEMS_BATCH,
} from "./const";
import type {
  ActionStatus,
  CheckoutAction,
  ObjectType,
  RepositoryItem,
  ResourceCollection,
} from "./types";
import {
  ItemPermission,
  buildChildrenUrl,
  buildIdFilter,
  collectPages,
  createLimiter,
  parseWritePermission,
} from "./utils";

/** The Viya endpoint of the active profile, or undefined for non-REST ones. */
export function getActiveViyaEndpoint(): string | undefined {
  const detail = profileConfig.getActiveProfileDetail();
  const profile = detail?.profile;
  if (!profile || profile.connectionType !== ConnectionType.Rest) {
    return undefined;
  }
  return profile.endpoint || undefined;
}

/**
 * REST access to the SAS Clinical Acceleration Repository, authenticated with
 * the extension's own SAS Viya sign-in (no separate profile or login).
 */
export class RepositoryModel {
  private connection: AxiosInstance | undefined;
  private endpoint: string | undefined;
  private objectTypes: ObjectType[] | undefined;
  private rootId: string | undefined;
  private currentUserId: string | undefined;
  private readonly etags = new Map<string, string>();
  // Identifies this client's batch actions to the action status service.
  private readonly clientId = randomUUID();
  private readonly permissions = new Map<string, Promise<ItemPermission>>();
  private readonly knownPermissions = new Map<string, ItemPermission>();
  // Set when the permissions endpoint can't be used on this server; items
  // are then treated as writable and the server enforces its own rules.
  private permissionsUnavailable = false;
  private readonly limitPermissionRequests = createLimiter(
    PERMISSION_CONCURRENCY,
  );

  constructor(private readonly log: (message: string) => void = () => {}) {}

  /** Forget cached state, e.g. after the profile changed. */
  reset(): void {
    this.connection = undefined;
    this.endpoint = undefined;
    this.objectTypes = undefined;
    this.rootId = undefined;
    this.currentUserId = undefined;
    this.etags.clear();
    this.permissions.clear();
    this.knownPermissions.clear();
    this.permissionsUnavailable = false;
  }

  /** The user's permission on an item if it has been looked up already. */
  getKnownPermission(id: string): ItemPermission | undefined {
    return this.permissionsUnavailable
      ? "write"
      : this.knownPermissions.get(id);
  }

  /**
   * Look up whether the signed-in user may change an item. Requests are
   * cached per item and run a few at a time. If the endpoint can't be used,
   * every item counts as writable (today's behaviour) and this is logged
   * once.
   */
  loadPermission(id: string): Promise<ItemPermission> {
    if (this.permissionsUnavailable) {
      return Promise.resolve("write");
    }
    let pending = this.permissions.get(id);
    if (!pending) {
      pending = this.limitPermissionRequests(() =>
        this.fetchPermission(id),
      ).then(
        (permission) => {
          this.knownPermissions.set(id, permission);
          return permission;
        },
        (error: unknown) => {
          // E.g. not signed in yet: forget it so the next render retries.
          this.permissions.delete(id);
          throw error;
        },
      );
      this.permissions.set(id, pending);
    }
    return pending;
  }

  private async fetchPermission(id: string): Promise<ItemPermission> {
    if (this.permissionsUnavailable) {
      return "write";
    }
    const connection = await this.getConnection();
    try {
      const { data } = await connection.get<unknown>(
        `${AUTHORIZATIONS}/${encodeURIComponent(id)}/permissions`,
      );
      const canWrite = parseWritePermission(data);
      if (canWrite === undefined) {
        this.markPermissionsUnavailable(
          `unrecognised response ${JSON.stringify(data).slice(0, 200)}`,
        );
        return "write";
      }
      return canWrite ? "write" : "read";
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 403) {
        // Not even allowed to read this item's permissions.
        return "read";
      }
      this.markPermissionsUnavailable(
        isAxiosError(error)
          ? `HTTP ${status ?? "?"} ${error.message}`
          : String(error),
      );
      return "write";
    }
  }

  private markPermissionsUnavailable(reason: string): void {
    if (!this.permissionsUnavailable) {
      this.permissionsUnavailable = true;
      this.log(
        `Item permissions are unavailable (${reason}); showing all actions and leaving checks to the server.`,
      );
    }
  }

  private async getConnection(): Promise<AxiosInstance> {
    const endpoint = getActiveViyaEndpoint();
    if (!endpoint) {
      throw new Error("The active SAS profile is not a SAS Viya profile.");
    }
    if (this.connection && this.endpoint === endpoint) {
      return this.connection;
    }
    this.reset();
    const connection = axios.create({ baseURL: endpoint });
    connection.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest: AxiosRequestConfig & { _retry?: boolean } =
          error.config ?? {};
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          await this.updateAccessToken(connection);
          return connection(originalRequest);
        }
        return Promise.reject(error);
      },
    );
    await this.updateAccessToken(connection);
    this.connection = connection;
    this.endpoint = endpoint;
    return connection;
  }

  private async updateAccessToken(connection: AxiosInstance): Promise<void> {
    const session = await authentication.getSession(SASAuthProvider.id, [], {
      createIfNone: true,
    });
    connection.defaults.headers.common.Authorization = `Bearer ${session.accessToken}`;
    this.currentUserId = session.account.id;
  }

  /** The signed-in Viya user id, used to tell "checked out by me" apart. */
  async getCurrentUserId(): Promise<string | undefined> {
    await this.getConnection();
    return this.currentUserId;
  }

  async getObjectType(typeId: string): Promise<ObjectType | undefined> {
    if (!this.objectTypes) {
      const connection = await this.getConnection();
      try {
        // The types collection ignores paging and returns everything at once.
        const { data } =
          await connection.get<ResourceCollection<ObjectType>>(TYPES);
        this.objectTypes = data.items ?? [];
      } catch {
        this.objectTypes = [];
      }
    }
    return this.objectTypes.find((type) => type.id === typeId);
  }

  private async getRootId(): Promise<string> {
    if (!this.rootId) {
      const connection = await this.getConnection();
      try {
        const { data } = await connection.get<RepositoryItem>(
          `${REPOSITORY_PATHS}?path=${encodeURIComponent("/")}`,
        );
        this.rootId = data.id || ROOT_ITEM_ID;
      } catch {
        this.rootId = ROOT_ITEM_ID;
      }
    }
    return this.rootId;
  }

  async getChildren(
    item: RepositoryItem | undefined,
    onTruncated?: (reason: string) => void,
  ): Promise<RepositoryItem[]> {
    const connection = await this.getConnection();
    const parentId = item?.id ?? (await this.getRootId());
    return collectPages<RepositoryItem>(
      async (url) =>
        (await connection.get<ResourceCollection<RepositoryItem>>(url)).data,
      buildChildrenUrl(parentId),
      onTruncated,
    );
  }

  async getItem(id: string): Promise<RepositoryItem> {
    const connection = await this.getConnection();
    const response = await connection.get<RepositoryItem>(
      `${REPOSITORY_ITEMS}/${encodeURIComponent(id)}?includeSynchronizationInfo=true`,
    );
    if (response.headers.etag) {
      this.etags.set(id, String(response.headers.etag));
    }
    return response.data;
  }

  /** Content of an item. The service sends a zip for containers. */
  async getContent(id: string): Promise<Uint8Array> {
    const connection = await this.getConnection();
    const response = await connection.post<ArrayBuffer>(
      `${REPOSITORY_ITEMS}/${encodeURIComponent(id)}/content`,
      [""],
      { responseType: "arraybuffer" },
    );
    return new Uint8Array(response.data);
  }

  async download(items: RepositoryItem[]): Promise<Uint8Array> {
    if (items.length === 1) {
      return this.getContent(items[0].id);
    }
    const connection = await this.getConnection();
    const response = await connection.post<ArrayBuffer>(
      REPOSITORY_FILES_CONTENT,
      { filter: buildIdFilter(items.map((item) => item.id)) },
      { responseType: "arraybuffer" },
    );
    return new Uint8Array(response.data);
  }

  async createFolder(
    parent: RepositoryItem,
    name: string,
  ): Promise<RepositoryItem> {
    const connection = await this.getConnection();
    const response = await connection.post<RepositoryItem>(
      `${REPOSITORY_ITEMS}/${encodeURIComponent(parent.id)}/children?name=${encodeURIComponent(name)}&type=FOLDER`,
      undefined,
      { headers: { Accept: REPOSITORY_ITEM_MEDIA_TYPE } },
    );
    return response.data;
  }

  async rename(item: RepositoryItem, name: string): Promise<RepositoryItem> {
    // Re-read the item first so the If-Match ETag is current.
    await this.getItem(item.id);
    const connection = await this.getConnection();
    const response = await connection.patch<RepositoryItem>(
      `${REPOSITORY_ITEMS}/${encodeURIComponent(item.id)}`,
      { name },
      {
        headers: {
          Accept: REPOSITORY_ITEM_MEDIA_TYPE,
          "If-Match": this.etags.get(item.id) ?? "",
        },
      },
    );
    return response.data;
  }

  async upload(
    container: RepositoryItem,
    name: string,
    content: Uint8Array,
    expand: boolean,
    comment?: string,
    version?: string,
  ): Promise<RepositoryItem> {
    const connection = await this.getConnection();
    let url = `${REPOSITORY_ITEMS}/${encodeURIComponent(container.id)}/content?name=${encodeURIComponent(name)}&expand=${expand}`;
    if (comment) {
      url += `&comment=${encodeURIComponent(comment)}`;
    }
    if (version) {
      url += `&fileVersion=${encodeURIComponent(version)}`;
    }
    const response = await connection.put<RepositoryItem>(url, content, {
      headers: {
        "Content-Type": "application/octet-stream",
        Accept: REPOSITORY_ITEM_MEDIA_TYPE,
      },
    });
    return response.data;
  }

  /**
   * Check items out to (or revert them from) the user's Clinical Acceleration
   * workspace, and wait for the server to finish.
   */
  async runCheckoutAction(
    action: CheckoutAction,
    items: RepositoryItem[],
    copyContent: boolean,
    isCancelled: () => boolean,
  ): Promise<ActionStatus> {
    const connection = await this.getConnection();
    const paths = items.map((item) => item.path);
    const body =
      action === "REPOSITORY_CHECK_OUT" ? { paths, copyContent } : paths;
    const response = await connection.post(
      `${WORKSPACE_ITEMS_BATCH}?action=${action}&clientId=${this.clientId}`,
      body,
    );
    const token = getActionToken(response.headers.location);
    if (!token) {
      throw new Error("The server did not return an action status.");
    }
    return pollActionStatus(
      (url, config) => connection.get<ActionStatus>(url, config),
      token,
      { isCancelled },
    );
  }
}
