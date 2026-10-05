import { onRequest } from 'firebase-functions/v2/https'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { createHandler } from './handler'
import { createFirestoreStore } from './firestoreStore'
import { loadConfig } from './config'
import { createRateLimiter } from './lib/rateLimit'

initializeApp()
const db = getFirestore()
db.settings({ ignoreUndefinedProperties: true })
const store = createFirestoreStore(db)
const limiter = createRateLimiter()

/** The uid of a verified, non-revoked Firebase ID token — or null. Identity is only ever taken from here. */
async function verifyIdToken(idToken: string): Promise<string | null> {
  try {
    return (await getAuth().verifyIdToken(idToken, true)).uid
  } catch {
    return null
  }
}

/**
 * The single public HTTPS entry point (`/v1/qr…` is routed inside the
 * handler). Public invoker on purpose: scanners are anonymous, and every
 * management route authorizes itself with the management token. CORS is
 * handled by the handler's own allowlist, not by the platform.
 */
export const api = onRequest({ invoker: 'public', region: 'us-central1', maxInstances: 10 }, async (req, res) => {
  const handler = createHandler({ store, config: loadConfig(), verifyIdToken, limiter })

  const host = req.get('host') ?? 'localhost'
  const url = `https://${host}${req.url}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
  const body = hasBody && req.rawBody ? new Uint8Array(req.rawBody) : undefined

  const response = await handler(new Request(url, { method: req.method, headers, body }))

  res.status(response.status)
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.send(Buffer.from(await response.arrayBuffer()))
})
