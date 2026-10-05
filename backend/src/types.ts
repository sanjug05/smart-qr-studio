/**
 * Backend-local types. Deliberately NOT imported from the frontend — the
 * backend and frontend are two independently deployed projects (see
 * README → "Backend architecture"), so their type definitions are kept
 * separate on purpose rather than reaching across a project boundary that
 * has no shared build tooling. `DynamicQrContent` is structurally the same
 * shape as the frontend's `LandingContent` (src/types/project.ts) — keep
 * them in sync by hand if either changes.
 */

/** Runtime configuration — plain, non-secret values resolved once per deployment (see src/config.ts). */
export interface AppConfig {
  environment: 'development' | 'staging' | 'production'
  /** Comma-separated list of allowed CORS origins. Never a wildcard. */
  allowedOrigins: string
  /**
   * Optional plan every caller of this deployment is treated as
   * (`free` | `pro` | `business`) until per-account plans exist. Unset or
   * unrecognized → the safe per-environment default in lib/entitlements.ts.
   */
  defaultPlan?: string
  /**
   * Optional secret that, when present, allows a request carrying the
   * matching `X-Dynamic-QR-Test-Override` header to bypass the deployment's
   * default entitlement. Not provisioned anywhere by default — see
   * lib/entitlements.ts, which treats an unset value as "override path does
   * not exist," not "override always matches."
   */
  testOverrideSecret?: string
}

export interface DynamicQrDestination {
  id: string
  label: string
  url: string
  description?: string
  icon: string
  customIconDataUrl?: string
  enabled: boolean
  order: number
}

export interface DynamicQrBrand {
  companyName: string
  tagline?: string
  logoDataUrl?: string
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
}

export interface DynamicQrContent {
  brand: DynamicQrBrand
  destinations: DynamicQrDestination[]
}

export type DynamicQrStatus = 'active' | 'disabled'

/** One Firestore document: `dynamic_qr/{publicId}`. */
export interface DynamicQrRecord {
  publicId: string
  /** Null in anonymous V1 (management token only); becomes a real user id once accounts exist. */
  ownerId: string | null
  /** SHA-256 hex digest of the management token. The plaintext token is never stored. */
  tokenHash: string
  status: DynamicQrStatus
  content: DynamicQrContent
  /** Incremented atomically on every successful publish. */
  version: number
  createdAt: string
  updatedAt: string
}
