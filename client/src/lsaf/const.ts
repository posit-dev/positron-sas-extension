// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// SAS Life Science Analytics Framework (LSAF) integration: identifiers shared
// by the views, commands and package.json. Nothing here imports `vscode`.

/** Read-only repository files: `sasLsaf:/<path>[?version=x.y]`. */
export const REPOSITORY_SCHEME = "sasLsaf";
/** Editable workspace files: `sasLsafWorkspace:/<path>`. */
export const WORKSPACE_SCHEME = "sasLsafWorkspace";

export const REPOSITORY_VIEW_ID = "lsafrepositoryprovider";
export const WORKSPACE_VIEW_ID = "lsafworkspaceprovider";
export const JOBS_VIEW_ID = "lsafjobsprovider";

/** Set when the configured URL answers like an LSAF REST API. */
export const AVAILABLE_CONTEXT_KEY = "SAS.lsaf.available";
/** Set while the extension holds an LSAF session. */
export const SIGNED_IN_CONTEXT_KEY = "SAS.lsaf.signedIn";

/** The setting and environment variable naming the LSAF server. */
export const URL_SETTING = "SAS.lsaf.url";
export const USER_SETTING = "SAS.lsaf.userId";
export const URL_ENV_VAR = "SAS_LSAF_URL";

/** SecretStorage namespace: `<api url>|<user id>` → encrypted password. */
export const SECRET_NAMESPACE = "SAS.lsaf.credentials";

/**
 * The API's children listing has a `limit` but no paging, and its default
 * is not documented; ask for this many and report when a folder fills it.
 */
export const CHILDREN_LIMIT = 10000;

/** Runs the Jobs view remembers per server and user. */
export const MAX_TRACKED_RUNS = 200;

/** The LSAF error media type, used to recognize an LSAF server. */
export const ERROR_MEDIA_TYPE = "application/vnd.sas.hls.error+json";
