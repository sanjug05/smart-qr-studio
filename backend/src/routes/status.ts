import type { Env } from '../types'
import { getByPublicId } from '../lib/db'
import { readJsonBody, jsonResponse, errorResponse } from '../lib/json'
import { authorizeManagementRequest } from '../lib/auth'

const VALID_STATUSES = new Set(['active', 'disabled'])

/**
 * PATCH /v1/qr/:publicId/status — enable/disable a Dynamic QR without ever
 * deleting the row (see README → "Disabled QR": a removed public_id must
 * never later be reused for different content).
 */
export async function setStatus(publicId: string, request: Request, env: Env): Promise<Response> {
  const record = await getByPublicId(env, publicId)
  if (!record) {
    return errorResponse('QR code not found.', 404)
  }

  const auth = await authorizeManagementRequest(request, record)
  if (!auth.authorized) {
    return errorResponse(auth.reason === 'missing_token' ? 'A management token is required.' : 'Invalid management token.', 401)
  }

  const body = await readJsonBody(request)
  const status = body && typeof body === 'object' ? (body as Record<string, unknown>).status : null
  if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
    return errorResponse("status must be 'active' or 'disabled'.", 422)
  }

  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE dynamic_qr SET status = ?, updated_at = ? WHERE public_id = ?').bind(status, now, publicId).run()

  return jsonResponse({ status })
}
