// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Parameter values of a clinical job run: what the prompts show and what the
// service is sent. No vscode import, so it is unit-tested directly.
import type {
  JobParameter,
  ParameterType,
  ParameterValue,
  ParameterValueData,
} from "./types";
import { resolveJobPath } from "./utils";

/** Types entered as text; FILE and FOLDER are picked. */
export const isTextType = (type: ParameterType): boolean =>
  type !== "FILE" && type !== "FOLDER";

/** A default value's text: a string, or the `{value}` form of the spec. */
function defaultString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value) {
    return String(value.value ?? "");
  }
  return "";
}

/** Path of a FILE or FOLDER default, resolved against the job's folder. */
export function defaultPath(
  param: JobParameter,
  jobLocation: string,
): string | undefined {
  const value = param.defaultValue;
  if (value && typeof value === "object" && "path" in value && value.path) {
    return resolveJobPath(jobLocation, value.path);
  }
  return undefined;
}

/** Text to pre-fill a prompt with. Masked defaults are never shown. */
export function defaultText(param: JobParameter): string {
  switch (param.type) {
    case "CHARACTER_MASKED":
      return "";
    case "DATE":
      // Defaults are ISO date-times such as 2023-12-15T05:00:00Z.
      return defaultString(param.defaultValue).slice(0, 10);
    default:
      return defaultString(param.defaultValue);
  }
}

export type ParameterProblem = "number" | "date" | undefined;

/** Why the text is not a valid value of the type, if it is not. */
export function validateParameterText(
  type: ParameterType,
  text: string,
): ParameterProblem {
  if (type === "NUMERIC") {
    return text.trim() !== "" && Number.isFinite(Number(text))
      ? undefined
      : "number";
  }
  if (type === "DATE") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
    if (!match) {
      return "date";
    }
    const date = new Date(`${match[0]}T00:00:00Z`);
    return date.getUTCDate() === Number(match[3]) ? undefined : "date";
  }
  return undefined;
}

/**
 * The value sent for a parameter. Text types are plain strings (the service
 * rejects `{value}`); a DATE is sent as midnight UTC, the form of the
 * defaults. FILE is `{path}` and FOLDER `{path, includeSubfolders}`.
 */
export function buildParameterValue(
  param: JobParameter,
  input: string,
  includeSubfolders = false,
): ParameterValue {
  let value: ParameterValueData;
  switch (param.type) {
    case "FILE":
      value = { path: input };
      break;
    case "FOLDER":
      value = { path: input, includeSubfolders };
      break;
    case "DATE":
      value = `${input.trim()}T00:00:00Z`;
      break;
    case "NUMERIC":
      value = input.trim();
      break;
    default:
      value = input;
  }
  return { name: param.name, type: param.type, value };
}

/** The values a run used, to run the job again with them. */
export function valuesForRerun(
  values: ParameterValue[] | undefined,
): ParameterValue[] {
  return (values ?? []).map(({ name, type, value }) => ({ name, type, value }));
}
