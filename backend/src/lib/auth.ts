import { hashToken } from './ids'
import type { DynamicQrRecord } from '../types'

/**
 * The backend half of the authorization abstraction (see README →
 * "Authorization" and the frontend's `DynamicQrAuthorizationService`).
 * Every management route calls `authorizeManagementRequest` rather than
 * comparing token hashes inline — this is the one place that logic lives,
 * so swapping the anonymous management-token scheme for real authenticated
 * ownership later (checking `record.owner_id` against a logged-in user
 * instead of a bearer token) is a change to this one function, not to
 * every route handler.
 */
export type AuthorizationResult = { authorized: true } | { authorized: false; reason: 'missing_token' | 'invalid_token' }

export async function authorizeManagementRequest(request: Request, record: Pick<DynamicQrRecord, 'token_hash'>): Promise<AuthorizationResult> {
  const token = extractBearerToken(request)
  if (!token) return { authorized: false, reason: 'missing_token' }

  const candidateHash = await hashToken(token)
  if (!timingSafeEqual(candidateHash, record.token_hash)) {
    return { authorized: false, reason: 'invalid_token' }
  }
  return { authorized: true }
}

function extractBearerToken(request: Request): string | null {
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
