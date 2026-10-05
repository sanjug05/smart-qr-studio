import { describe, it, expect, afterEach } from 'vitest'
import { SELF, store, limiterRef } from './harness'
import { createRateLimiter } from '../src/lib/rateLimit'
import { resolveCaller } from '../src/lib/identity'

const CONTENT = {
  brand: { companyName: 'Acme', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' },
  destinations: [{ id: 'd0', label: 'Site', url: 'https://example.com/one', icon: '🌐', enabled: true, order: 0 }]
}
const CHANGED = { ...CONTENT, destinations: [{ ...CONTENT.destinations[0], url: 'https://example.com/two' }] }
const json = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', ...extra })
const ID = (who: 'A' | 'B') => ({ 'X-Firebase-ID-Token': `id-token-${who}` })

async function create(headers: Record<string, string> = {}, body: unknown = CONTENT) {
  const res = await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: json(headers), body: JSON.stringify(body) })
  return { res, body: (await res.json()) as { publicId: string; managementToken: string } }
}
const put = (id: string, headers: Record<string, string>, body: unknown = CHANGED) =>
  SELF.fetch(`https://api.test/v1/qr/${id}`, { method: 'PUT', headers: json(headers), body: JSON.stringify(body) })

describe('owner association (verified Firebase identity)', () => {
  it('an authenticated create stores the verified uid as ownerId', async () => {
    const { res, body } = await create(ID('A'))
    expect(res.status).toBe(201)
    expect((await store.get(body.publicId))?.ownerId).toBe('uid-A')
  })

  it('an anonymous create has no owner', async () => {
    const { body } = await create()
    expect((await store.get(body.publicId))?.ownerId).toBeNull()
  })

  it('a client cannot forge ownerId: body fields and a spoofed uid header are ignored', async () => {
    const { body } = await create({ ...ID('A'), 'X-Uid': 'uid-B' }, { ...CONTENT, ownerId: 'uid-B', owner: 'uid-B', email: 'b@example.com' })
    const stored = await store.get(body.publicId)
    expect(stored?.ownerId).toBe('uid-A')
    expect(JSON.stringify(stored)).not.toContain('uid-B')
  })

  it('a presented-but-invalid ID token is rejected (401), not silently treated as anonymous', async () => {
    const { res } = await create({ 'X-Firebase-ID-Token': 'forged-token' })
    expect(res.status).toBe(401)
  })

  it('public resolution never exposes the owner', async () => {
    const { body } = await create(ID('A'))
    const pub = (await (await SELF.fetch(`https://api.test/v1/qr/${body.publicId}`)).json()) as Record<string, unknown>
    expect(Object.keys(pub).sort()).toEqual(['content', 'status', 'version'])
  })
})

describe('managing a Dynamic QR as its owner', () => {
  it('the owner can update from another device with only their ID token (no management token)', async () => {
    const { body } = await create(ID('A'))
    const res = await put(body.publicId, ID('A'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { version: number }).version).toBe(2)
  })

  it('the owner can disable and re-enable with only their ID token', async () => {
    const { body } = await create(ID('A'))
    const patch = (status: string) =>
      SELF.fetch(`https://api.test/v1/qr/${body.publicId}/status`, { method: 'PATCH', headers: json(ID('A')), body: JSON.stringify({ status }) })
    expect((await patch('disabled')).status).toBe(200)
    expect((await store.get(body.publicId))?.status).toBe('disabled')
    expect((await patch('active')).status).toBe(200)
  })

  it("another signed-in user (B) cannot manage A's QR: 401 and nothing changes", async () => {
    const { body } = await create(ID('A'))
    const res = await put(body.publicId, ID('B'))
    expect(res.status).toBe(401)
    expect((await store.get(body.publicId))?.version).toBe(1)
  })

  it('a signed-in user cannot manage an ownerless QR without its management token', async () => {
    const { body } = await create()
    expect((await put(body.publicId, ID('A'))).status).toBe(401)
  })

  it('an invalid ID token plus no management token is 401', async () => {
    const { body } = await create(ID('A'))
    expect((await put(body.publicId, { 'X-Firebase-ID-Token': 'forged' })).status).toBe(401)
  })

  it('the management token still works for the QR, alone or alongside a different user', async () => {
    const { body } = await create(ID('A'))
    expect((await put(body.publicId, { Authorization: `Bearer ${body.managementToken}` })).status).toBe(200)
    expect((await put(body.publicId, { Authorization: `Bearer ${body.managementToken}`, ...ID('B') })).status).toBe(200)
  })

  it('the publicId (and the owner uid) are never accepted as credentials', async () => {
    const { body } = await create(ID('A'))
    expect((await put(body.publicId, { Authorization: `Bearer ${body.publicId}` })).status).toBe(401)
    expect((await put(body.publicId, { Authorization: 'Bearer uid-A' })).status).toBe(401)
  })
})

describe('POST /v1/qr/:publicId/claim — attach an anonymous QR to an account', () => {
  const claim = (id: string, headers: Record<string, string>) => SELF.fetch(`https://api.test/v1/qr/${id}/claim`, { method: 'POST', headers: json(headers) })

  it('needs BOTH a verified ID token and the management token', async () => {
    const { body } = await create()
    expect((await claim(body.publicId, { Authorization: `Bearer ${body.managementToken}` })).status).toBe(401)
    expect((await claim(body.publicId, ID('A'))).status).toBe(401)
    expect((await claim(body.publicId, { ...ID('A'), Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await store.get(body.publicId))?.ownerId).toBeNull()
  })

  it('claims an ownerless QR for the verified user, who can then manage it without the token', async () => {
    const { body } = await create()
    const res = await claim(body.publicId, { ...ID('A'), Authorization: `Bearer ${body.managementToken}` })
    expect(res.status).toBe(200)
    expect((await store.get(body.publicId))?.ownerId).toBe('uid-A')
    expect((await put(body.publicId, ID('A'))).status).toBe(200)
  })

  it('is idempotent for the same user and refuses a takeover by anyone else (409)', async () => {
    const { body } = await create()
    const headersA = { ...ID('A'), Authorization: `Bearer ${body.managementToken}` }
    expect((await claim(body.publicId, headersA)).status).toBe(200)
    expect((await claim(body.publicId, headersA)).status).toBe(200)
    expect((await claim(body.publicId, { ...ID('B'), Authorization: `Bearer ${body.managementToken}` })).status).toBe(409)
    expect((await store.get(body.publicId))?.ownerId).toBe('uid-A')
  })

  it('an unknown publicId is 404', async () => {
    expect((await claim('doesNotExist1', { ...ID('A'), Authorization: 'Bearer x' })).status).toBe(404)
  })
})

describe('public resolution needs no sign-in', () => {
  it('anyone can resolve an owned QR with no credentials at all', async () => {
    const { body } = await create(ID('A'))
    const res = await SELF.fetch(`https://api.test/v1/qr/${body.publicId}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('active')
  })

  it('a broken ID token on a public GET does not break resolution', async () => {
    const { body } = await create(ID('A'))
    expect((await SELF.fetch(`https://api.test/v1/qr/${body.publicId}`, { headers: { 'X-Firebase-ID-Token': 'garbage' } })).status).toBe(200)
  })
})

describe('CORS for the new header', () => {
  it('the preflight allows X-Firebase-ID-Token from an allowed origin only', async () => {
    const ok = await SELF.fetch('https://api.test/v1/qr', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('X-Firebase-ID-Token')
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    const bad = await SELF.fetch('https://api.test/v1/qr', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('resolveCaller', () => {
  const req = (h: Record<string, string>) => new Request('https://api.test/x', { headers: h })
  it('treats no header as anonymous, a verified token as the user, anything else as invalid', async () => {
    const verify = async (t: string) => (t === 'good' ? 'uid-1' : null)
    expect(await resolveCaller(req({}), verify)).toEqual({ kind: 'anonymous' })
    expect(await resolveCaller(req({ 'X-Firebase-ID-Token': 'good' }), verify)).toEqual({ kind: 'user', uid: 'uid-1' })
    expect(await resolveCaller(req({ 'X-Firebase-ID-Token': 'Bearer good' }), verify)).toEqual({ kind: 'user', uid: 'uid-1' })
    expect(await resolveCaller(req({ 'X-Firebase-ID-Token': 'bad' }), verify)).toEqual({ kind: 'invalid' })
    expect(await resolveCaller(req({ 'X-Firebase-ID-Token': 'good' }), undefined)).toEqual({ kind: 'invalid' })
    expect(
      await resolveCaller(req({ 'X-Firebase-ID-Token': 'x' }), async () => {
        throw new Error('boom')
      })
    ).toEqual({ kind: 'invalid' })
  })
})

describe('rate limiting (abuse safeguard)', () => {
  afterEach(() => {
    limiterRef.current = undefined
  })

  it('limiter: allows up to the limit within the window, then returns a retry delay, then recovers', () => {
    const l = createRateLimiter()
    for (let i = 0; i < 3; i++) expect(l.hit('k', 3, 60_000, 1000 + i)).toBeNull()
    expect(l.hit('k', 3, 60_000, 2000)).toBeGreaterThan(0)
    expect(l.hit('other', 3, 60_000, 2000)).toBeNull()
    expect(l.hit('k', 3, 60_000, 1000 + 60_001)).toBeNull()
  })

  it('floods of Dynamic QR creation from one client are answered with 429 + Retry-After', async () => {
    limiterRef.current = createRateLimiter()
    const statuses: number[] = []
    let retry: string | null = null
    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: json({ 'x-forwarded-for': '203.0.113.9' }), body: JSON.stringify(CONTENT) })
      statuses.push(res.status)
      if (res.status === 429) retry = res.headers.get('Retry-After')
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(20)
    expect(statuses.filter((s) => s === 429)).toHaveLength(5)
    expect(Number(retry)).toBeGreaterThan(0)
  })

  it('a different client address is unaffected, and resolution is not throttled by creation floods', async () => {
    limiterRef.current = createRateLimiter()
    for (let i = 0; i < 22; i++) await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: json({ 'x-forwarded-for': '203.0.113.9' }), body: JSON.stringify(CONTENT) })
    const other = await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: json({ 'x-forwarded-for': '198.51.100.1' }), body: JSON.stringify(CONTENT) })
    expect(other.status).toBe(201)
    const resolve = await SELF.fetch('https://api.test/v1/qr/whatever', { headers: { 'x-forwarded-for': '203.0.113.9' } })
    expect(resolve.status).toBe(404)
  })
})
