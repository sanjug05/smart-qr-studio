const DEFAULT_DEV_API_BASE_URL = 'http://127.0.0.1:8787'

/**
 * The Dynamic QR API's origin — a separate deployable service from this
 * static frontend (see README → "Backend architecture"). Set
 * `VITE_DYNAMIC_QR_API_BASE_URL` per environment; falls back to the local
 * `wrangler dev` default only in a Vite dev build, and throws rather than
 * silently pointing a production build at localhost.
 */
export function getDynamicQrApiBaseUrl(): string {
  const configured = import.meta.env.VITE_DYNAMIC_QR_API_BASE_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (import.meta.env.DEV) return DEFAULT_DEV_API_BASE_URL
  throw new Error('VITE_DYNAMIC_QR_API_BASE_URL is not configured for this build.')
}

/**
 * Must match `DYNAMIC_QR_TEST_OVERRIDE_HEADER` in backend/src/lib/entitlements.ts
 * exactly — two independent projects, one agreed-on header name.
 */
export const DYNAMIC_QR_TEST_OVERRIDE_HEADER = 'X-Dynamic-QR-Test-Override'

/**
 * Baked in at *build time* only — never read from a query string, never
 * read from `localStorage`, never settable at runtime. A real production
 * build simply never defines `VITE_DYNAMIC_QR_TEST_OVERRIDE_SECRET`, so
 * this returns `undefined` and every override-related code path in this
 * app (see entitlementService.ts and httpDynamicQrService.ts) is fully
 * inert. Only a deliberately-configured special build — used to test
 * Dynamic QR against a `production`-configured backend — sets this, and
 * even then the backend independently requires its own matching secret to
 * actually grant anything (see backend/src/lib/entitlements.ts); this
 * value alone unlocks nothing by itself.
 */
export function getDynamicQrTestOverrideSecret(): string | undefined {
  return import.meta.env.VITE_DYNAMIC_QR_TEST_OVERRIDE_SECRET || undefined
}
