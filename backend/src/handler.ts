import type { AppConfig } from './types'
import type { QrStore } from './store'
import { withCors, handlePreflight } from './lib/cors'
import { errorResponse } from './lib/json'
import { resolveQr } from './routes/resolve'
import { createQr } from './routes/create'
import { updateQr } from './routes/update'
import { setStatus } from './routes/status'

export interface Ctx {
  store: QrStore
  config: AppConfig
}

const QR_PATH = /^\/v1\/qr\/([^/]+)$/
const QR_STATUS_PATH = /^\/v1\/qr\/([^/]+)\/status$/

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
      const response = await route(request, pathname, ctx)
      return withCors(response, request, ctx.config)
    } catch (err) {
      // Log the error message only — never the request (it may carry a management token).
      console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown')
      return withCors(errorResponse('Internal server error.', 500), request, ctx.config)
    }
  }
}

async function route(request: Request, pathname: string, ctx: Ctx): Promise<Response> {
  if (request.method === 'POST' && pathname === '/v1/qr') {
    return createQr(request, ctx)
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
