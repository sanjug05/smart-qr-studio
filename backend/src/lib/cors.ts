import type { AppConfig } from '../types'
import { DYNAMIC_QR_TEST_OVERRIDE_HEADER } from './entitlements'
import { ID_TOKEN_HEADER } from './identity'

/**
 * Config-driven CORS allowlist (see README → "CORS"). Origins come from the
 * deployment's `ALLOWED_ORIGINS` setting (src/config.ts), so adding a future
 * custom domain or a Capacitor app origin is a config change, not a code
 * change. Never a wildcard.
 */
function allowedOrigins(config: AppConfig): string[] {
  return config.allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean)
}

/**
 * Only ever echoes back the caller's own Origin, and only when it's on the
 * allowlist — never a different allowed origin as a fallback. Previously
 * this fell back to `allowed[0]` for a non-matching Origin, which handed
 * out a valid `Access-Control-Allow-Origin` value (just for a different
 * site) instead of none at all; a browser only delivers the response to
 * script when the header matches its OWN origin, so that specific bug was
 * not itself exploitable, but it meant no request was ever actually
 * denied a CORS header — omitting the header for a non-matching Origin is
 * the correct, intentional restriction instead.
 */
function corsHeadersFor(request: Request, config: AppConfig): Record<string, string> {
  const origin = request.headers.get('Origin')
  const allowed = allowedOrigins(config)
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, Authorization, ${ID_TOKEN_HEADER}, ${DYNAMIC_QR_TEST_OVERRIDE_HEADER}`,
    'Access-Control-Max-Age': '86400'
  }
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

/** Wraps a Response with the appropriate CORS headers for the calling origin. */
export function withCors(response: Response, request: Request, config: AppConfig): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeadersFor(request, config))) {
    headers.set(key, value)
  }
  return new Response(response.body, { status: response.status, headers })
}

export function handlePreflight(request: Request, config: AppConfig): Response {
  return new Response(null, { status: 204, headers: corsHeadersFor(request, config) })
}
