// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// Adapted from sassoftware/vscode-sas-ca-extension
// client/src/components/ContentNavigator/const.ts and types.ts (Apache-2.0).

/** Tree view, URI scheme and context key of the Clinical Repository view. */
export const VIEW_ID = "clinicalrepositorydataprovider";
export const CLINICAL_SCHEME = "sasClinical";
export const AVAILABLE_CONTEXT_KEY = "SAS.clinicalAvailable";
export const PROPERTIES_VIEW_ID = "clinicalpropertyprovider";
export const VERSIONS_VIEW_ID = "clinicalversionhistoryprovider";
/** URI scheme of read-only file versions: `sasClinicalVersion:/<name>?id=&version=`. */
export const VERSION_SCHEME = "sasClinicalVersion";
/** Context keys behind the compare menus. */
export const COMPARE_SELECTED_KEY = "SAS.clinical.compareSourceSet";
export const TWO_ITEMS_KEY = "SAS.clinical.twoItemsSelected";
export const TWO_VERSIONS_KEY = "SAS.clinical.twoVersionsSelected";
export const TWO_WORKSPACE_ITEMS_KEY = "SAS.clinical.twoWorkspaceItemsSelected";
export const WORKSPACE_VIEW_ID = "clinicalworkspaceprovider";
/** URI scheme of workspace files: `sasClinicalWorkspace:/<path in the workspace>`. */
export const WORKSPACE_SCHEME = "sasClinicalWorkspace";

// The service root needs the trailing slash: without it SAS Viya answers 302.
export const SERVICE_ROOT = "/clinicalRepository/";
export const REPOSITORY_PATHS = "/clinicalRepository/repository/paths";
export const REPOSITORY_ITEMS = "/clinicalRepository/repository/items";
export const REPOSITORY_ITEMS_BATCH =
  "/clinicalRepository/repository/items/batch";
export const REPOSITORY_FILES_CONTENT =
  "/clinicalRepository/repository/files/content";
export const TYPES = "/clinicalRepository/types";
export const WORKSPACE = "/clinicalRepository/workspaces/@currentUser";
export const WORKSPACE_ITEMS = `${WORKSPACE}/items`;
export const WORKSPACE_ITEMS_CONTENT = `${WORKSPACE}/items/content`;
export const WORKSPACE_FOLDERS = `${WORKSPACE}/folders`;
export const WORKSPACE_ITEMS_BATCH = `${WORKSPACE}/items/batch`;
export const SYNCHRONIZATION_ITEMS =
  "/clinicalRepository/synchronization/items";
export const ACTION_STATUS = "/clinicalActionStatus/actionstatus";
// Effective permissions of the signed-in user on an item. Not in the public
// v3 spec, but listed in the service's root links and used by SAS's own
// Clinical Acceleration extension.
export const AUTHORIZATIONS = "/clinicalRepository/authorizations";

export const API_MEDIA_TYPE = "application/vnd.sas.api+json";
export const REPOSITORY_ITEM_MEDIA_TYPE =
  "application/vnd.sas.clinical.repository.item+json";
export const REPOSITORY_FILE_MEDIA_TYPE =
  "application/vnd.sas.clinical.repository.file+json";
export const COLLECTION_MEDIA_TYPE = "application/vnd.sas.collection+json";
export const ACTION_STATUS_MEDIA_TYPE =
  "application/vnd.sas.clinical.action.status+json";

/** The id of the repository root, used when the path lookup fails. */
export const ROOT_ITEM_ID = "1";
export const CHILDREN_PAGE_LIMIT = 500;
export const MAX_CHILDREN_PAGES = 100;
export const PERMISSION_CONCURRENCY = 8;
