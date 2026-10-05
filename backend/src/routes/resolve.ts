import type { Ctx } from '../handler'
import { jsonResponse, errorResponse } from '../lib/json'

/**
 * GET /v1/qr/:publicId — public resolution, no authorization required.
 * Anyone with the publicId can read the *published* content; that's the
 * whole point (a scanner has no credentials). Editing is a completely
 * separate, authorized surface — see routes/update.ts and routes/status.ts.
 */
export async function resolveQr(publicId: string, { store }: Ctx): Promise<Response> {
  const record = await store.get(publicId)
  if (!record) {
    return errorResponse('QR code not found.', 404)
  }

  if (record.status === 'disabled') {
    return jsonResponse({ status: 'disabled' })
  }

  // Only these three fields ever leave the backend — never tokenHash/ownerId/timestamps.
  return jsonResponse({ status: 'active', content: record.content, version: record.version })
}
