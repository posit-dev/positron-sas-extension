// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Parameters of a saved SAS job. The Job Execution service turns each
// argument into a macro variable for the program (checked against a live
// server): a parameter's default applies when no value is passed, an empty
// value defines the variable as empty, and a parameter with no default and no
// value is not defined at all, so `&name` would not resolve.
//
// Nothing here imports `vscode`, so it can be unit tested outside the host.
import type { JobDefinition, JobDefinitionParameter } from "./types";

/** The parameter types this extension creates. */
export type ParameterType = "CHARACTER" | "NUMERIC";

const SAS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/**
 * Macro variables the program reads but does not set itself: the candidates
 * for job parameters, in the order they first appear. Automatic macro
 * variables (SYS…) and system arguments (_…) are left out.
 */
export function suggestParameters(code: string): string[] {
  const noComments = stripComments(code);
  // Definitions are looked for before quotes go: call symputx('name', …).
  const defined = new Set(
    definedMacroVariables(noComments).map((n) => n.toUpperCase()),
  );
  // References in single quotes don't resolve; in double quotes they do.
  const text = stripSingleQuotes(noComments);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of text.matchAll(/&+([A-Za-z_][A-Za-z0-9_]{0,31})/g)) {
    const name = match[1];
    const key = name.toUpperCase();
    if (
      seen.has(key) ||
      defined.has(key) ||
      key.startsWith("SYS") ||
      key.startsWith("_")
    ) {
      continue;
    }
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Names the program gives a value to, so they are not parameters. */
function definedMacroVariables(text: string): string[] {
  const names: string[] = [];
  const add = (re: RegExp, group = 1) => {
    for (const m of text.matchAll(re)) {
      names.push(m[group]);
    }
  };
  add(/%(?:let|global|local)\s+([A-Za-z_]\w*)/gi);
  add(/call\s+symputx?\s*\(\s*["']([A-Za-z_]\w*)["']/gi);
  add(/\binto\s*:\s*([A-Za-z_]\w*)/gi);
  add(/%do\s+([A-Za-z_]\w*)\s*=/gi);
  // %global and %local declare several names at once.
  for (const m of text.matchAll(/%(?:global|local)\s+([^;]+);/gi)) {
    names.push(
      ...m[1]
        .trim()
        .split(/\s+/)
        .filter((n) => SAS_NAME.test(n)),
    );
  }
  // Parameters of macros defined in the program.
  for (const m of text.matchAll(/%macro\s+[A-Za-z_]\w*\s*\(([^)]*)\)/gi)) {
    for (const part of m[1].split(",")) {
      const name = part.split("=")[0].trim();
      if (SAS_NAME.test(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/** Block comments: macro references there don't resolve. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Single-quoted strings, where macro references don't resolve either. */
function stripSingleQuotes(code: string): string {
  return code.replace(/'(?:[^']|'')*'/g, "''");
}

/** Why a parameter name can't be used, or undefined when it can. */
export function parameterNameProblem(
  name: string,
  existing: readonly string[] = [],
): "empty" | "invalid" | "reserved" | "duplicate" | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return "empty";
  }
  if (!SAS_NAME.test(trimmed)) {
    return "invalid";
  }
  // _contextName and friends are arguments of the Compute provider.
  if (trimmed.startsWith("_") || /^sys/i.test(trimmed)) {
    return "reserved";
  }
  if (existing.some((n) => n.toUpperCase() === trimmed.toUpperCase())) {
    return "duplicate";
  }
  return undefined;
}

/** Why a value can't be used for a parameter, or undefined when it can. */
export function parameterValueProblem(
  parameter: JobDefinitionParameter,
  value: string,
): "required" | "number" | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return parameter.required ? "required" : undefined;
  }
  if (parameter.type === "NUMERIC" && !Number.isFinite(Number(trimmed))) {
    return "number";
  }
  return undefined;
}

/** The parameters a user is asked for: not the Compute provider's own (_…). */
export function promptableParameters(
  definition: JobDefinition | undefined,
): JobDefinitionParameter[] {
  return (definition?.parameters ?? []).filter((p) => !p.name.startsWith("_"));
}

/**
 * Arguments for a run. Every parameter is passed, a blank one as an empty
 * value, so `&name` resolves in the program even without a default.
 */
export function argumentsFor(
  parameters: readonly JobDefinitionParameter[],
  answers: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const parameter of parameters) {
    result[parameter.name] = (answers[parameter.name] ?? "").trim();
  }
  return result;
}

/**
 * Whether to name a compute context for a run. A job that declares its own
 * _contextName default (as SAS Studio's jobs do) runs where it was made for.
 */
export function ownContext(
  definition: JobDefinition | undefined,
): string | undefined {
  const declared = (definition?.parameters ?? []).find(
    (p) => p.name === "_contextName",
  );
  return declared?.defaultValue?.trim() || undefined;
}

/** The parameter list of a definition, in the shape the service stores. */
export function buildParameters(
  parameters: readonly {
    name: string;
    type: ParameterType;
    defaultValue?: string;
    required?: boolean;
    label?: string;
  }[],
): JobDefinitionParameter[] {
  return parameters.map((p) => ({
    version: 1,
    name: p.name.trim(),
    type: p.type,
    label: p.label?.trim() || p.name.trim(),
    required: !!p.required,
    ...(p.defaultValue !== undefined && p.defaultValue !== ""
      ? { defaultValue: p.defaultValue }
      : {}),
  }));
}

/** A readable folder path from Folders service ancestors (nearest first). */
export function folderPath(
  ancestors: readonly { name: string; type?: string }[],
): string {
  const chain = [...ancestors].reverse();
  // Show "My Folder/…" rather than "/Users/<id>/My Folder/…".
  const mine = chain.findIndex((a) => a.type === "myFolder");
  if (mine >= 0) {
    return chain
      .slice(mine)
      .map((a) => a.name)
      .join("/");
  }
  return `/${chain.map((a) => a.name).join("/")}`;
}
