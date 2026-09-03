import type { Env } from './types'
import { withCors, handlePreflight } from './lib/cors'
import { errorResponse } from './lib/json'
import { resolveQr } from './routes/resolve'
import { createQr } from './routes/create'
import { updateQr } from './routes/update'
import { setStatus } from './routes/status'

const QR_PATH = /^\/v1\/qr\/([^/]+)$/
const QR_STATUS_PATH = /^\/v1\/qr\/([^/]+)\/status$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env)
    }

    const { pathname } = new URL(request.url)

    try {
      const response = await route(request, pathname, env)
      return withCors(response, request, env)
    } catch (err) {
      console.error('Unhandled error', err)
      return withCors(errorResponse('Internal server error.', 500), request, env)
    }
  }
}

async function route(request: Request, pathname: string, env: Env): Promise<Response> {
  if (request.method === 'POST' && pathname === '/v1/qr') {
    return createQr(request, env)
  }

  const statusMatch = pathname.match(QR_STATUS_PATH)
  if (statusMatch && request.method === 'PATCH') {
    return setStatus(decodeURIComponent(statusMatch[1]), request, env)
  }

  const qrMatch = pathname.match(QR_PATH)
  if (qrMatch) {
    const publicId = decodeURIComponent(qrMatch[1])
    if (request.method === 'GET') return resolveQr(publicId, env)
    if (request.method === 'PUT') return updateQr(publicId, request, env)
  }

  return errorResponse('Not found.', 404)
}
