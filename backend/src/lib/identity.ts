/**
 * Who is calling, as established by a *verified* Firebase ID token.
 *
 * The ID token travels in its own header — `Authorization: Bearer …` stays
 * reserved for the per-QR management token (lib/auth.ts), so the two
 * credentials can never be confused for one another. The uid always comes
 * from the verified token's claims; nothing in a request body, query string
 * or the caller's email is ever treated as identity.
 */
export const ID_TOKEN_HEADER = 'X-Firebase-ID-Token'

/** Resolves a raw ID token to its verified uid, or null if it is invalid/expired/revoked. Injected so tests need no Firebase. */
export type VerifyIdToken = (idToken: string) => Promise<string | null>

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'user'; uid: string }
  /** An ID token was presented but did not verify — never silently downgraded to anonymous. */
  | { kind: 'invalid' }

export async function resolveCaller(request: Request, verify: VerifyIdToken | undefined): Promise<Caller> {
  const raw = request.headers.get(ID_TOKEN_HEADER)
  if (!raw) return { kind: 'anonymous' }
  const token = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length).trim() : raw.trim()
  if (!token || !verify) return { kind: 'invalid' }
  try {
    const uid = await verify(token)
    return uid ? { kind: 'user', uid } : { kind: 'invalid' }
  } catch {
    return { kind: 'invalid' }
  }
}
