import { hashToken } from './ids'
import type { DynamicQrRecord } from '../types'
import type { Caller } from './identity'

/**
 * The backend half of the authorization abstraction (see README →
 * "Authorization" and the frontend's `DynamicQrAuthorizationService`).
 * Every management route calls `authorizeManagementRequest` rather than
 * comparing credentials inline — this is the one place that logic lives.
 *
 * A management request is authorized by EITHER of two independent
 * credentials, never by the public `publicId`:
 *
 * 1. the verified owner — a Firebase ID token whose uid equals the record's
 *    `ownerId` (so the owner can manage the QR from any signed-in device), or
 * 2. the per-QR management token returned once at creation (the anonymous
 *    V1 scheme, still valid for QRs created without an account).
 *
 * A record with no `ownerId` can only ever be managed with its token.
 */
export type AuthorizationResult =
  | { authorized: true; via: 'owner' | 'token' }
  | { authorized: false; reason: 'missing_token' | 'invalid_token' }

export async function authorizeManagementRequest(
  request: Request,
  record: Pick<DynamicQrRecord, 'tokenHash' | 'ownerId'>,
  caller: Caller = { kind: 'anonymous' }
): Promise<AuthorizationResult> {
  if (caller.kind === 'user' && record.ownerId && timingSafeEqual(caller.uid, record.ownerId)) {
    return { authorized: true, via: 'owner' }
  }

  const token = extractBearerToken(request)
  if (!token) return { authorized: false, reason: caller.kind === 'anonymous' ? 'missing_token' : 'invalid_token' }

  const candidateHash = await hashToken(token)
  if (!timingSafeEqual(candidateHash, record.tokenHash)) {
    return { authorized: false, reason: 'invalid_token' }
  }
  return { authorized: true, via: 'token' }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

/**
 * Constant-time string comparison — never short-circuit on the first
 * mismatched character. Exported so entitlements.ts can reuse it for the
 * test-override secret check (see lib/entitlements.ts) instead of a second,
 * possibly-timing-leaky copy.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
