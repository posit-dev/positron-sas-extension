// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The axios-based HTTP layer of LsafClient. Every status comes back as a
// response (the client decides what is an error) and every body as bytes,
// because file downloads and JSON share the same endpoints.
import axios from "axios";

import type { HttpRequest, HttpResponse, HttpTransport } from "./LsafClient";

const TIMEOUT_MS = 5 * 60_000;

export function axiosTransport(apiUrl: string): HttpTransport {
  const instance = axios.create({
    baseURL: apiUrl,
    responseType: "arraybuffer",
    validateStatus: () => true,
    // Downloads can be large; the API has no paging.
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: TIMEOUT_MS,
    // Keep the bytes: JSON is parsed by the client.
    transformResponse: [(data) => data],
  });
  return async (request: HttpRequest): Promise<HttpResponse> => {
    const params = Object.fromEntries(
      Object.entries(request.params ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const response = await instance.request({
      method: request.method,
      url: request.url,
      params,
      headers: request.headers,
      data: request.data,
    });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      if (value !== undefined && value !== null) {
        headers[name.toLowerCase()] = Array.isArray(value)
          ? value.join(", ")
          : String(value);
      }
    }
    const data: unknown = response.data;
    return {
      status: response.status,
      headers,
      data:
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : new TextEncoder().encode(
                typeof data === "string" ? data : JSON.stringify(data ?? ""),
              ),
    };
  };
}
