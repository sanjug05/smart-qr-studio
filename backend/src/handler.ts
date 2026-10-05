import type { AppConfig } from './types'
import type { QrStore } from './store'
import { withCors, handlePreflight } from './lib/cors'
import { errorResponse } from './lib/json'
import { resolveQr } from './routes/resolve'
import { createQr } from './routes/create'
import { updateQr } from './routes/update'
import { setStatus } from './routes/status'
import { claimQr } from './routes/claim'
import { resolveCaller, type Caller, type VerifyIdToken } from './lib/identity'
import { clientKey, type RateLimiter } from './lib/rateLimit'

export interface Ctx {
  store: QrStore
  config: AppConfig
  /** Verifies a Firebase ID token to its uid (null if invalid). Absent ⇒ every presented ID token is treated as invalid. */
  verifyIdToken?: VerifyIdToken
  /** Optional abuse safeguard; see lib/rateLimit.ts. */
  limiter?: RateLimiter
}

/** Per-minute, per-client-address ceilings — generous for real use, a brake on scripted floods. */
export const RATE_LIMITS = { create: 20, manage: 60, resolve: 600 } as const
const WINDOW_MS = 60_000

export type RouteCtx = Ctx & { caller: Caller }

const QR_PATH = /^\/v1\/qr\/([^/]+)$/
const QR_STATUS_PATH = /^\/v1\/qr\/([^/]+)\/status$/
const QR_CLAIM_PATH = /^\/v1\/qr\/([^/]+)\/claim$/

/**
 * The whole API as a plain `Request → Response` function — no Firebase,
 * Express or Firestore types in sight, so it is tested directly (test/) and
 * mounted by the Cloud Function adapter (index.ts) without translation
 * logic leaking into the routes.
 */
export function createHandler(ctx: Ctx): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, ctx.config)
    }

    const { pathname } = new URL(request.url)

    try {
      const limited = rateLimit(request, pathname, ctx)
      if (limited) return withCors(limited, request, ctx.config)

      const caller = await resolveCaller(request, ctx.verifyIdToken)
      const response = await route(request, pathname, { ...ctx, caller })
      return withCors(response, request, ctx.config)
    } catch (err) {
      // Log the error message only — never the request (it may carry a management token).
      console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown')
      return withCors(errorResponse('Internal server error.', 500), request, ctx.config)
    }
  }
}

function rateLimit(request: Request, pathname: string, ctx: Ctx): Response | null {
  if (!ctx.limiter) return null
  const kind = request.method === 'GET' ? 'resolve' : request.method === 'POST' && pathname === '/v1/qr' ? 'create' : 'manage'
  const wait = ctx.limiter.hit(`${kind}:${clientKey(request)}`, RATE_LIMITS[kind], WINDOW_MS)
  if (wait === null) return null
  const response = errorResponse('Too many requests. Please slow down and try again shortly.', 429)
  response.headers.set('Retry-After', String(wait))
  return response
}

async function route(request: Request, pathname: string, ctx: RouteCtx): Promise<Response> {
  if (request.method === 'POST' && pathname === '/v1/qr') {
    return createQr(request, ctx)
  }

  const claimMatch = pathname.match(QR_CLAIM_PATH)
  if (claimMatch && request.method === 'POST') {
    return claimQr(safeDecode(claimMatch[1]), request, ctx)
  }

  const statusMatch = pathname.match(QR_STATUS_PATH)
  if (statusMatch && request.method === 'PATCH') {
    return setStatus(safeDecode(statusMatch[1]), request, ctx)
  }

  const qrMatch = pathname.match(QR_PATH)
  if (qrMatch) {
    const publicId = safeDecode(qrMatch[1])
    if (request.method === 'GET') return resolveQr(publicId, ctx)
    if (request.method === 'PUT') return updateQr(publicId, request, ctx)
  }

  return errorResponse('Not found.', 404)
}

/** A malformed %-escape must be a plain miss (404), not an exception (500). */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return '\u0000invalid'
  }
}
