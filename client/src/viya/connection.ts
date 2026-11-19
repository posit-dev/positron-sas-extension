// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Extracted from client/src/clinical/RepositoryModel.ts so that features other
// than the Clinical Repository can share one authenticated SAS Viya client.
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";

import { getViyaSession } from "../components/AuthProvider";
import { getActiveViyaEndpoint } from "./endpoint";

/**
 * The part of an axios instance a model needs. Taking this instead of the
 * instance itself lets models be unit tested with a recorder, outside the
 * extension host.
 */
export interface RestConnection {
  get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
  delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
  head?<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<{ data: T; headers?: unknown }>;
}

/**
 * REST access to the active SAS Viya server, authenticated with the
 * extension's own sign-in. One instance per feature; the access token is
 * refreshed and the failed request replayed when the server answers 401.
 */
export class ViyaConnection {
  private connection: AxiosInstance | undefined;
  private endpoint: string | undefined;
  private currentUserId: string | undefined;

  constructor(private readonly log: (message: string) => void = () => {}) {}

  async getConnection(): Promise<AxiosInstance> {
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
          // The failed request still carries the old Authorization header,
          // which overrides the refreshed default, so replay it with the new one.
          originalRequest.headers = {
            ...originalRequest.headers,
            Authorization: connection.defaults.headers.common.Authorization,
          };
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
    const session = await getViyaSession();
    connection.defaults.headers.common.Authorization = `Bearer ${session.accessToken}`;
    this.currentUserId = session.account.id;
  }

  /** The signed-in Viya user id. */
  async getCurrentUserId(): Promise<string | undefined> {
    await this.getConnection();
    return this.currentUserId;
  }

  reset(): void {
    this.connection = undefined;
    this.endpoint = undefined;
    this.currentUserId = undefined;
  }
}
