import type { RouteCtx } from '../handler'
import { readJsonBody, jsonResponse, errorResponse } from '../lib/json'
import { validateDynamicQrContent } from '../lib/validation'
import { authorizeManagementRequest } from '../lib/auth'

/**
 * PUT /v1/qr/:publicId — replaces the published content in one atomic
 * read-modify-write (a Firestore transaction). `content` is always written
 * as a complete document, never as partial field patches, and `version` is
 * incremented inside the same transaction from the value it just read — so
 * two concurrent publishes can never both claim the same version, and a
 * reader sees either the old document or the new one, never a torn write.
 * `publicId` and the QR artwork are never touched here.
 */
export async function updateQr(publicId: string, request: Request, { store, caller }: RouteCtx): Promise<Response> {
  // Parsed before opening a transaction: nothing here depends on stored state.
  const body = await readJsonBody(request)

  const response = await store.transact<Response>(publicId, async (record) => {
    const auth = await authorizeManagementRequest(request, record, caller)
    if (!auth.authorized) {
      return { result: errorResponse(auth.reason === 'missing_token' ? 'A management token is required.' : 'Invalid management token.', 401) }
    }

    const outcome = validateDynamicQrContent(body)
    if (!outcome.valid || !outcome.content) {
      return { result: jsonResponse({ error: 'Invalid destination data.', details: outcome.errors }, 422) }
    }

    const version = record.version + 1
    return {
      patch: { content: outcome.content, version, updatedAt: new Date().toISOString() },
      result: jsonResponse({ content: outcome.content, version })
    }
  })

  return response ?? errorResponse('QR code not found.', 404)
}
