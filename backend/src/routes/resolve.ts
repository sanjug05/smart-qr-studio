import type { Env } from '../types'
import { getByPublicId } from '../lib/db'
import { jsonResponse, errorResponse } from '../lib/json'

/**
 * GET /v1/qr/:publicId — public resolution, no authorization required.
 * Anyone with the publicId can read the *published* content; that's the
 * whole point (a scanner has no credentials). Editing is a completely
 * separate, authorized surface — see routes/update.ts and routes/status.ts.
 */
export async function resolveQr(publicId: string, env: Env): Promise<Response> {
  const record = await getByPublicId(env, publicId)
  if (!record) {
    return errorResponse('QR code not found.', 404)
  }

  if (record.status === 'disabled') {
    return jsonResponse({ status: 'disabled' })
  }

  return jsonResponse({
    status: 'active',
    content: JSON.parse(record.content),
    version: record.version
  })
}
