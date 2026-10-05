/**
 * Whether `url` is acceptable as the Dynamic QR API origin of a *production*
 * build: an absolute https URL whose host is not a loopback/unspecified
 * address. Exported so it can be tested directly.
 */
export function isSafeProductionApiUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === '0.0.0.0' || host === '::' || host === '::1') return false
  if (/^127\./.test(host)) return false
  return true
}

/**
 * The Dynamic QR API's origin — a separate deployable service from this
 * static frontend (see README → "Backend architecture"), currently a
 * Firebase Cloud Function. It comes from `VITE_DYNAMIC_QR_API_BASE_URL`
 * only: there is deliberately no built-in default, so a build that was not
 * given an endpoint fails closed instead of silently talking to the wrong
 * server. A production build additionally refuses anything that is not a
 * public https URL (no localhost / 127.0.0.1 / 0.0.0.0). For local
 * development, point it at the Functions emulator in `.env.local`.
 */
export function getDynamicQrApiBaseUrl(): string {
  const configured = import.meta.env.VITE_DYNAMIC_QR_API_BASE_URL?.trim()
  if (!configured) throw new Error('VITE_DYNAMIC_QR_API_BASE_URL is not configured for this build.')
  const base = configured.replace(/\/+$/, '')
  if (import.meta.env.PROD && !isSafeProductionApiUrl(base)) {
    throw new Error('VITE_DYNAMIC_QR_API_BASE_URL must be a public https URL in a production build.')
  }
  return base
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
 * inert. Only a deliberately-configured special build sets it, and even
 * then the backend independently requires its own matching secret to
 * actually grant anything (see backend/src/lib/entitlements.ts); this
 * value alone unlocks nothing by itself.
 */
export function getDynamicQrTestOverrideSecret(): string | undefined {
  return import.meta.env.VITE_DYNAMIC_QR_TEST_OVERRIDE_SECRET || undefined
}
