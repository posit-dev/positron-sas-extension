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
// The configured signature reasons and roles (string arrays). Not in the
// public API documentation; the web app reads them from here.
export const SIGNATURE_REASONS =
  "/clinicalRepository/repository/signatureReasons";
export const SIGNATURE_ROLES = "/clinicalRepository/repository/signatureRoles";
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

// SAS Clinical Job Management. Its root (/clinicalJobs/) answers 404, so
// availability is probed with a one-item page of the user's submissions.
export const JOBS_ROOT = "/clinicalJobs";
export const JOB_DEFINITIONS = `${JOBS_ROOT}/definitions`;
export const JOB_REPOSITORY_DEFINITIONS = `${JOBS_ROOT}/repository/definitions`;
export const JOB_REPOSITORY_MANIFESTS = `${JOBS_ROOT}/repository/manifests`;
export const JOB_SUBMISSIONS = `${JOBS_ROOT}/submissions`;
export const JOB_SCHEDULES = `${JOBS_ROOT}/schedules`;
export const JOBS_PROBE = `${JOB_SUBMISSIONS}?limit=1`;
export const JOBS_AVAILABLE_CONTEXT_KEY = "SAS.clinical.jobsAvailable";
export const JOBS_VIEW_ID = "clinicaljobsprovider";
/** Context keys of the view toggles: hidden runs, everyone's schedules. */
export const SHOW_HIDDEN_RUNS_KEY = "SAS.clinical.showHiddenRuns";
export const SHOW_ALL_SCHEDULES_KEY = "SAS.clinical.showAllSchedules";
/** Page size of the submissions list. */
export const SUBMISSIONS_PAGE_LIMIT = 25;

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
