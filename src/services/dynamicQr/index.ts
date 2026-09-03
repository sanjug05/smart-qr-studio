import { httpDynamicQrService } from './httpDynamicQrService'

export type { DynamicQrService, DynamicQrResolveResult, DynamicQrCreateResult, DynamicQrUpdateResult } from './dynamicQrService'
export { dynamicQrAuthorizationService } from './dynamicQrAuthorizationService'

// Single shared instance — every consumer imports `dynamicQrService`, not a
// concrete class, mirroring `projectRepository` (see
// src/services/storage/projectRepository.ts). Swap this line to point at a
// different implementation (e.g. during tests) without touching call sites.
export const dynamicQrService = httpDynamicQrService
