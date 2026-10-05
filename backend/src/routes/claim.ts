import type { RouteCtx } from '../handler'
import { jsonResponse, errorResponse } from '../lib/json'
import { authorizeManagementRequest, extractBearerToken } from '../lib/auth'

/**
 * POST /v1/qr/:publicId/claim — attaches an existing anonymous Dynamic QR
 * to the signed-in user, so it can be managed from any of their devices.
 *
 * Requires BOTH credentials: a verified Firebase ID token (who is claiming)
 * AND the QR's management token (proof they already control it). The
 * `publicId` alone never suffices, and the owner is taken from the verified
 * token, never the request. A QR that already has an owner can't be taken
 * over: claiming it again as the same user is a no-op, as anyone else is a 409.
 */
export async function claimQr(publicId: string, request: Request, { store, caller }: RouteCtx): Promise<Response> {
  if (caller.kind !== 'user') return errorResponse('Sign in to claim a QR code.', 401)
  const uid = caller.uid
  if (!extractBearerToken(request)) return errorResponse('A management token is required.', 401)

  const response = await store.transact<Response>(publicId, async (record) => {
    // Deliberately `anonymous`: ownership alone must not satisfy this check — the management token must.
    const auth = await authorizeManagementRequest(request, { tokenHash: record.tokenHash, ownerId: null }, { kind: 'anonymous' })
    if (!auth.authorized) return { result: errorResponse('Invalid management token.', 401) }

    if (record.ownerId === uid) return { result: jsonResponse({ claimed: true }) }
    if (record.ownerId) return { result: errorResponse('This QR code already belongs to another account.', 409) }

    return { patch: { ownerId: uid, updatedAt: new Date().toISOString() }, result: jsonResponse({ claimed: true }) }
  })

  return response ?? errorResponse('QR code not found.', 404)
}
