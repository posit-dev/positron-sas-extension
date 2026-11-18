// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  ServiceAvailability,
  type ServiceProbe,
  probeService,
} from "../viya/probe";
import type { ProbeResult } from "../viya/probeResult";
import {
  API_MEDIA_TYPE,
  AVAILABLE_CONTEXT_KEY,
  JOBS_AVAILABLE_CONTEXT_KEY,
  JOBS_PROBE,
  SERVICE_ROOT,
} from "./const";

/**
 * The generic detector now lives in ../viya/probe.ts, shared with other
 * features. This name is kept so clinical code reads as before.
 */
export { ServiceAvailability as ClinicalAvailability };
export type { ServiceProbe };

/** Ask a SAS Viya server whether it runs the Clinical Repository service. */
export function probeClinicalRepository(
  endpoint: string,
  accessToken?: string,
): Promise<ProbeResult> {
  return probeService(
    `${endpoint}${SERVICE_ROOT}`,
    API_MEDIA_TYPE,
    accessToken,
  );
}

/**
 * Ask a SAS Viya server whether it runs SAS Clinical Job Management. Its root
 * answers 404, so this asks for one of the user's submissions.
 */
export function probeClinicalJobs(
  endpoint: string,
  accessToken?: string,
): Promise<ProbeResult> {
  return probeService(
    `${endpoint}${JOBS_PROBE}`,
    "application/json",
    accessToken,
  );
}

export const CLINICAL_REPOSITORY_PROBE: ServiceProbe = {
  label: "Clinical Repository",
  contextKey: AVAILABLE_CONTEXT_KEY,
  probe: probeClinicalRepository,
};

export const CLINICAL_JOBS_PROBE: ServiceProbe = {
  label: "Clinical Job Management",
  contextKey: JOBS_AVAILABLE_CONTEXT_KEY,
  probe: probeClinicalJobs,
};
