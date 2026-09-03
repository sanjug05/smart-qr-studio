import type { LandingContent } from '@/types/project'

/**
 * `content` is exactly `LandingContent` — the same minimal shape the
 * customer landing page already renders for Static QR (see
 * src/types/project.ts). Static and Dynamic QR converge on one
 * presentation layer; this is what makes that possible on the data side
 * too, with no adapter object needed.
 */
export type DynamicQrResolveResult =
  | { status: 'active'; content: LandingContent; version: number }
  | { status: 'disabled' }
  | { status: 'not-found' }
  /** Network/API failure — must never be presented to a scanner as "invalid QR" (see README → "Offline"). */
  | { status: 'error' }

export interface DynamicQrCreateResult {
  publicId: string
  content: LandingContent
  version: number
}

export interface DynamicQrUpdateResult {
  ok: boolean
  content?: LandingContent
  version?: number
  error?: string
}

/**
 * The one seam between React and the Dynamic QR backend — no component
 * ever calls `fetch()` against the API directly. This is what lets the
 * backend be replaced or the anonymous-token scheme be upgraded to real
 * accounts without touching any UI code (mirrors the existing
 * `ProjectRepository` pattern in src/services/storage/projectRepository.ts).
 *
 * Authorization is intentionally not a parameter here — see
 * dynamicQrAuthorizationService.ts. Implementations reach into that service
 * internally, so callers never handle a management token themselves.
 */
export interface DynamicQrService {
  resolve(publicId: string): Promise<DynamicQrResolveResult>
  create(content: LandingContent): Promise<DynamicQrCreateResult>
  update(publicId: string, content: LandingContent): Promise<DynamicQrUpdateResult>
  setStatus(publicId: string, status: 'active' | 'disabled'): Promise<{ ok: boolean }>
}
