import type { RouteCtx } from '../handler'
import { readJsonBody, jsonResponse, errorResponse } from '../lib/json'
import { authorizeManagementRequest } from '../lib/auth'

const VALID_STATUSES = new Set(['active', 'disabled'])

/**
 * PATCH /v1/qr/:publicId/status — enable/disable a Dynamic QR without ever
 * deleting the document (see README → "Disabled QR": a removed publicId
 * must never later be reused for different content).
 */
export async function setStatus(publicId: string, request: Request, { store, caller }: RouteCtx): Promise<Response> {
  const body = await readJsonBody(request)
  const status = body && typeof body === 'object' ? (body as Record<string, unknown>).status : null

  const response = await store.transact<Response>(publicId, async (record) => {
    const auth = await authorizeManagementRequest(request, record, caller)
    if (!auth.authorized) {
      return { result: errorResponse(auth.reason === 'missing_token' ? 'A management token is required.' : 'Invalid management token.', 401) }
    }

    if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
      return { result: errorResponse("status must be 'active' or 'disabled'.", 422) }
    }

    return {
      patch: { status: status as 'active' | 'disabled', updatedAt: new Date().toISOString() },
      result: jsonResponse({ status })
    }
  })

  return response ?? errorResponse('QR code not found.', 404)
}
