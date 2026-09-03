import type { Env } from '../types'
import { getByPublicId } from '../lib/db'
import { readJsonBody, jsonResponse, errorResponse } from '../lib/json'
import { validateDynamicQrContent } from '../lib/validation'
import { authorizeManagementRequest } from '../lib/auth'

/**
 * PUT /v1/qr/:publicId — replaces the published content in one atomic
 * statement. `content` is always written as a complete document, never as
 * partial field patches — a single UPDATE means any concurrent reader sees
 * either the old row or the new one, never a torn write (see README →
 * "Atomic updates"). `publicId` and the QR artwork are never touched here.
 */
export async function updateQr(publicId: string, request: Request, env: Env): Promise<Response> {
  const record = await getByPublicId(env, publicId)
  if (!record) {
    return errorResponse('QR code not found.', 404)
  }

  const auth = await authorizeManagementRequest(request, record)
  if (!auth.authorized) {
    return errorResponse(auth.reason === 'missing_token' ? 'A management token is required.' : 'Invalid management token.', 401)
  }

  const body = await readJsonBody(request)
  const outcome = validateDynamicQrContent(body)
  if (!outcome.valid || !outcome.content) {
    return jsonResponse({ error: 'Invalid destination data.', details: outcome.errors }, 422)
  }

  const now = new Date().toISOString()
  const nextVersion = record.version + 1
  const contentJson = JSON.stringify(outcome.content)

  await env.DB.prepare('UPDATE dynamic_qr SET content = ?, version = ?, updated_at = ? WHERE public_id = ?')
    .bind(contentJson, nextVersion, now, publicId)
    .run()

  return jsonResponse({ content: outcome.content, version: nextVersion })
}
