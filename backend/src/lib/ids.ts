const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const PUBLIC_ID_LENGTH = 12

/**
 * The permanent, printed identifier — `#/q/d.<publicId>`. Random, not
 * sequential (an incrementing ID would let anyone enumerate every Dynamic
 * QR by guessing neighboring numbers). Uniqueness is enforced by the
 * database's UNIQUE index; a collision here is astronomically unlikely
 * (12 chars from a 62-char alphabet — the same order of magnitude as a
 * UUID) but callers should still handle a UNIQUE constraint failure and
 * retry, exactly like the existing frontend slug generator does.
 */
export function generatePublicId(): string {
  const bytes = new Uint8Array(PUBLIC_ID_LENGTH)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    id += PUBLIC_ID_ALPHABET[bytes[i] % PUBLIC_ID_ALPHABET.length]
  }
  return id
}

const MANAGEMENT_TOKEN_BYTES = 32 // 256 bits of entropy — this is a bearer credential, not just an identifier

/**
 * The anonymous V1 management credential (see README → "Authorization").
 * Returned to the client exactly once, at creation time. Never stored in
 * plaintext — see hashToken() below.
 */
export function generateManagementToken(): string {
  const bytes = new Uint8Array(MANAGEMENT_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(digest)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
