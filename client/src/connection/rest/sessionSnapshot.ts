// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  MacroVariable,
  SessionSnapshot,
  WorkTable,
} from "../../positron/sasClient";
import { cleanAutomatic, isInternalMacroName } from "../../positron/sasClient";
import { DataAccessApi, VariablesApi } from "./api/compute";
import { getApiConfig } from "./common";

const PAGE = 500;
/** WORK tables beyond this many are listed without details. */
const MAX_TABLE_DETAILS = 200;

/**
 * Read the macro variables and WORK tables of a compute session through the
 * Compute REST API. Unlike a SAS step this runs no code, so &SYSERR, &SYSCC
 * and &SYSLAST keep the values the user's last submission left.
 */
export async function fetchSessionSnapshot(
  sessionId: string,
): Promise<SessionSnapshot> {
  const [macros, tables] = await Promise.all([
    fetchMacroVariables(sessionId),
    fetchWorkTables(sessionId),
  ]);
  return { macros, tables };
}

async function fetchMacroVariables(sessionId: string): Promise<MacroVariable[]> {
  const api = VariablesApi(getApiConfig());
  const macros: MacroVariable[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data } = await api.getVariables(
      { sessionId, start, limit: PAGE },
      { headers: { Accept: "application/json" } },
    );
    for (const item of data.items ?? []) {
      const scope = item.scope?.toUpperCase();
      if (
        item.name &&
        (scope === "GLOBAL" || scope === "AUTOMATIC") &&
        !isInternalMacroName(item.name)
      ) {
        const value = item.value ?? "";
        macros.push({
          scope,
          name: item.name,
          value: scope === "AUTOMATIC" ? cleanAutomatic(value) : value,
        });
      }
    }
    if ((data.items?.length ?? 0) < PAGE) {
      return macros;
    }
  }
}

async function fetchWorkTables(sessionId: string): Promise<WorkTable[]> {
  const api = DataAccessApi(getApiConfig());
  const names: string[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data } = await api.getTables(
      { sessionId, libref: "WORK", start, limit: PAGE },
      { headers: { Accept: "application/vnd.sas.collection+json" } },
    );
    names.push(
      ...(data.items ?? []).map((t) => t.name).filter((n): n is string => !!n),
    );
    if ((data.items?.length ?? 0) < PAGE) {
      break;
    }
  }
  return Promise.all(
    names.map(async (name, i): Promise<WorkTable> => {
      if (i >= MAX_TABLE_DETAILS) {
        return { name, memtype: "DATA" };
      }
      try {
        const { data } = await api.getTable(
          { sessionId, libref: "WORK", tableName: name },
          { headers: { Accept: "application/json" } },
        );
        const memtype = data.type === "VIEW" ? "VIEW" : "DATA";
        const count = (n: number | undefined) =>
          typeof n === "number" && n >= 0 ? n : undefined;
        return {
          name,
          memtype,
          rows: memtype === "VIEW" ? undefined : count(data.rowCount),
          columns: count(data.columnCount),
          modified: data.modifiedTimeStamp,
          label: data.label || undefined,
        };
      } catch {
        return { name, memtype: "DATA" };
      }
    }),
  );
}
