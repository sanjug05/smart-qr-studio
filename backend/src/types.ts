/**
 * Backend-local types. Deliberately NOT imported from the frontend — the
 * backend and frontend are two independently deployed projects (see
 * README → "Backend architecture"), so their type definitions are kept
 * separate on purpose rather than reaching across a project boundary that
 * has no shared build tooling. `DynamicQrContent` is structurally the same
 * shape as the frontend's `LandingContent` (src/types/project.ts) — keep
 * them in sync by hand if either changes.
 */

export interface Env {
  DB: D1Database
  ENVIRONMENT: 'development' | 'staging' | 'production'
  ALLOWED_ORIGINS: string
  /**
   * Optional plain var naming the plan every caller of this deployment is
   * treated as (`free` | `pro` | `business`) until per-account plans
   * exist. Unset or unrecognized → the safe per-environment default in
   * lib/entitlements.ts. Not a secret.
   */
  DEFAULT_PLAN?: string
  /**
   * A Worker *secret* (set via `wrangler secret put`, never a plaintext
   * `wrangler.toml` var) that, when present, allows a request carrying the
   * matching `X-Dynamic-QR-Test-Override` header to bypass the
   * environment's default entitlement — e.g. testing Dynamic QR end-to-end
   * against a `production`-configured backend without enabling it for
   * every real production user. Undefined/unset by default on every
   * environment, including production — see lib/entitlements.ts, which
   * treats an unset value as "override path does not exist," not "override
   * always matches."
   */
  DYNAMIC_QR_TEST_OVERRIDE_SECRET?: string
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

export interface DynamicQrRecord {
  id: number
  public_id: string
  owner_id: string | null
  token_hash: string
  status: DynamicQrStatus
  content: string // JSON-encoded DynamicQrContent
  version: number
  created_at: string
  updated_at: string
}
