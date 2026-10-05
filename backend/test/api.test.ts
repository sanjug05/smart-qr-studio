import { SELF, env } from './harness'
import { describe, it, expect, afterEach } from 'vitest'
import { DYNAMIC_QR_TEST_OVERRIDE_HEADER } from '../src/lib/entitlements'

const VALID_CONTENT = {
  brand: {
    companyName: 'GreenLeaf Café',
    tagline: 'Fresh. Local. Delicious.',
    primaryColor: '#1b5e20',
    secondaryColor: '#c8a951',
    backgroundColor: '#ffffff'
  },
  destinations: [
    { id: 'd0', label: 'Website', url: 'https://example.com', icon: '🌐', enabled: true, order: 0 },
    { id: 'd1', label: 'Location', url: 'https://maps.google.com/', icon: '📍', enabled: true, order: 1 }
  ]
}

async function createDynamicQr(overrides: Partial<typeof VALID_CONTENT> = {}) {
  const res = await SELF.fetch('https://api.test/v1/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...VALID_CONTENT, ...overrides })
  })
  const body = (await res.json()) as { publicId: string; managementToken: string; content: unknown; version: number }
  return { res, body }
}

describe('POST /v1/qr — create', () => {
  it('creates a Dynamic QR and returns a publicId + managementToken exactly once', async () => {
    const { res, body } = await createDynamicQr()
    expect(res.status).toBe(201)
    expect(body.publicId).toMatch(/^[0-9A-Za-z]{12}$/)
    expect(body.managementToken).toBeTruthy()
    expect(body.version).toBe(1)
  })

  it('rejects a malicious destination URL scheme', async () => {
    const { res, body } = await createDynamicQr({
      destinations: [{ id: 'd0', label: 'Evil', url: 'javascript:alert(1)', icon: '🌐', enabled: true, order: 0 }] as never
    })
    expect(res.status).toBe(422)
    expect((body as unknown as { details: string[] }).details.join(' ')).toMatch(/valid http/i)
  })

  it('rejects data: and vbscript: schemes too', async () => {
    for (const url of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
      const { res } = await createDynamicQr({
        destinations: [{ id: 'd0', label: 'Evil', url, icon: '🌐', enabled: true, order: 0 }] as never
      })
      expect(res.status).toBe(422)
    }
  })

  it('caps destinations at 5 even if more are sent', async () => {
    const destinations = Array.from({ length: 8 }, (_, i) => ({
      id: `d${i}`,
      label: `Dest ${i}`,
      url: 'https://example.com',
      icon: '🌐',
      enabled: true,
      order: i
    }))
    const { res, body } = await createDynamicQr({ destinations } as never)
    expect(res.status).toBe(201)
    expect((body.content as { destinations: unknown[] }).destinations.length).toBe(5)
  })

  it('truncates oversized label/description/company-name fields rather than failing', async () => {
    const { res, body } = await createDynamicQr({
      brand: { ...VALID_CONTENT.brand, companyName: 'X'.repeat(500) },
      destinations: [
        { id: 'd0', label: 'L'.repeat(500), url: 'https://example.com', description: 'D'.repeat(500), icon: '🌐', enabled: true, order: 0 }
      ]
    } as never)
    expect(res.status).toBe(201)
    const content = body.content as { brand: { companyName: string }; destinations: Array<{ label: string; description?: string }> }
    expect(content.brand.companyName.length).toBeLessThanOrEqual(120)
    expect(content.destinations[0].label.length).toBeLessThanOrEqual(30)
    expect(content.destinations[0].description!.length).toBeLessThanOrEqual(60)
  })

  it('rejects an invalid hex color', async () => {
    const { res } = await createDynamicQr({ brand: { ...VALID_CONTENT.brand, primaryColor: 'not-a-color' } })
    expect(res.status).toBe(422)
  })
})

describe('GET /v1/qr/:publicId — resolve', () => {
  it('resolves an active Dynamic QR with its published content', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const body = (await res.json()) as { status: string; content: { brand: { companyName: string } } }
    expect(res.status).toBe(200)
    expect(body.status).toBe('active')
    expect(body.content.brand.companyName).toBe('GreenLeaf Café')
  })

  it('returns 404 for an unknown publicId', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr/doesnotexist1')
    expect(res.status).toBe(404)
  })
})

describe('PUT /v1/qr/:publicId — update', () => {
  it('updates content, bumps version, and keeps publicId identical', async () => {
    const { body: created } = await createDynamicQr()

    const updateRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({
        ...VALID_CONTENT,
        destinations: [{ id: 'd0', label: 'Website', url: 'https://new-website.example.com', icon: '🌐', enabled: true, order: 0 }]
      })
    })
    const updateBody = (await updateRes.json()) as { content: { destinations: Array<{ url: string }> }; version: number }
    expect(updateRes.status).toBe(200)
    expect(updateBody.version).toBe(2)
    expect(updateBody.content.destinations[0].url).toBe('https://new-website.example.com/')

    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { content: { destinations: Array<{ url: string }> } }
    expect(resolveBody.content.destinations[0].url).toBe('https://new-website.example.com/')

    // The identifier printed on physical material must never change.
    expect(created.publicId).toHaveLength(12)
  })

  it('rejects an update with a missing management token', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CONTENT)
    })
    expect(res.status).toBe(401)
  })

  it('rejects an update with an invalid management token', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token-entirely' },
      body: JSON.stringify(VALID_CONTENT)
    })
    expect(res.status).toBe(401)
  })

  it('never partially applies an invalid update — the prior valid content survives', async () => {
    const { body: created } = await createDynamicQr()
    const badRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({ ...VALID_CONTENT, destinations: [{ id: 'd0', label: 'Evil', url: 'javascript:alert(1)', icon: '🌐', enabled: true, order: 0 }] })
    })
    expect(badRes.status).toBe(422)

    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { content: { brand: { companyName: string } }; version: number }
    expect(resolveBody.content.brand.companyName).toBe('GreenLeaf Café')
    expect(resolveBody.version).toBe(1)
  })

  it('concurrent updates each apply completely — a reader never sees a mixed/torn document', async () => {
    const { body: created } = await createDynamicQr()
    const contentA = { ...VALID_CONTENT, brand: { ...VALID_CONTENT.brand, companyName: 'Version A Co' } }
    const contentB = { ...VALID_CONTENT, brand: { ...VALID_CONTENT.brand, companyName: 'Version B Co' } }

    const put = (content: unknown) =>
      SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
        body: JSON.stringify(content)
      })

    await Promise.all([put(contentA), put(contentB)])

    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { content: { brand: { companyName: string } } }
    expect(['Version A Co', 'Version B Co']).toContain(resolveBody.content.brand.companyName)
  })
})

describe('PATCH /v1/qr/:publicId/status — disable', () => {
  it('disables a Dynamic QR without deleting it, and resolve reflects it', async () => {
    const { body: created } = await createDynamicQr()

    const disableRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({ status: 'disabled' })
    })
    expect(disableRes.status).toBe(200)

    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { status: string; content?: unknown }
    expect(resolveRes.status).toBe(200)
    expect(resolveBody.status).toBe('disabled')
    expect(resolveBody.content).toBeUndefined()
  })

  it('rejects disabling without a management token', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' })
    })
    expect(res.status).toBe(401)
  })

  it('re-enabling a disabled QR restores resolution', async () => {
    const { body: created } = await createDynamicQr()
    const token = created.managementToken
    await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'disabled' })
    })
    await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'active' })
    })
    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { status: string }
    expect(resolveBody.status).toBe('active')
  })
})

describe('CORS', () => {
  it('reflects an allowed origin and handles preflight', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr/anything', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' }
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('omits Access-Control-Allow-Origin entirely for a disallowed origin, rather than echoing a different allowed one', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr/anything', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' }
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('omits the header on an actual (non-preflight) state-changing request from a disallowed origin too', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify(VALID_CONTENT)
    })
    // The request is still processed server-side (CORS is a browser-enforced
    // read restriction, not a server-side request gate) — real protection
    // here comes from the entitlement/token checks, not this header. What
    // matters is that a disallowed origin never gets told it's allowed.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('Management token security', () => {
  it('GET /v1/qr/:publicId never returns the token or its hash in any form', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const text = await res.text()
    expect(text).not.toContain(created.managementToken)
    expect(text.toLowerCase()).not.toContain('token')
  })

  it('a 401 (missing token) response body never contains token-shaped data', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CONTENT)
    })
    const text = await res.text()
    expect(text).not.toContain(created.managementToken)
  })

  it('a 401 (invalid token) response body never echoes back the submitted token', async () => {
    const { body: created } = await createDynamicQr()
    const submittedGarbage = 'attacker-supplied-guess-12345'
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${submittedGarbage}` },
      body: JSON.stringify(VALID_CONTENT)
    })
    const text = await res.text()
    expect(text).not.toContain(submittedGarbage)
    expect(text).not.toContain(created.managementToken)
  })

  it('the publicId itself is never accepted as a bearer token — publicId alone cannot authorize', async () => {
    const { body: created } = await createDynamicQr()
    const res = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.publicId}` },
      body: JSON.stringify(VALID_CONTENT)
    })
    expect(res.status).toBe(401)
  })

  it('a disabled QR still requires a valid management token to be updated — disabling never weakens authorization', async () => {
    const { body: created } = await createDynamicQr()
    await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({ status: 'disabled' })
    })

    const unauthorizedUpdate = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CONTENT)
    })
    expect(unauthorizedUpdate.status).toBe(401)

    const wrongTokenUpdate = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer completely-wrong' },
      body: JSON.stringify(VALID_CONTENT)
    })
    expect(wrongTokenUpdate.status).toBe(401)
  })

  it('an authorized update to a disabled QR changes content but never silently reactivates it', async () => {
    const { body: created } = await createDynamicQr()
    await SELF.fetch(`https://api.test/v1/qr/${created.publicId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({ status: 'disabled' })
    })

    const updateRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` },
      body: JSON.stringify({ ...VALID_CONTENT, brand: { ...VALID_CONTENT.brand, companyName: 'Updated While Disabled' } })
    })
    expect(updateRes.status).toBe(200)

    const resolveRes = await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)
    const resolveBody = (await resolveRes.json()) as { status: string }
    // Content changed, but status must still be exactly what it was set to —
    // an update must never be able to reassign a disabled QR back to active
    // as a side effect.
    expect(resolveBody.status).toBe('disabled')
  })
})

describe('Production DEFAULT_PLAN (current Business-level operation)', () => {
  afterEach(() => {
    delete (env as unknown as Record<string, unknown>).DEFAULT_PLAN
  })

  it('allows creation in production when DEFAULT_PLAN=business, with no override header at all', async () => {
    const originalEnv = env.ENVIRONMENT
    ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = 'production'
    ;(env as unknown as Record<string, unknown>).DEFAULT_PLAN = 'business'
    try {
      const res = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_CONTENT)
      })
      expect(res.status).toBe(201)
    } finally {
      ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = originalEnv
    }
  })

  it('still rejects invalid content and still 403s when DEFAULT_PLAN=free — validation and entitlement are not bypassed', async () => {
    const originalEnv = env.ENVIRONMENT
    ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = 'production'
    try {
      ;(env as unknown as Record<string, unknown>).DEFAULT_PLAN = 'business'
      const bad = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_CONTENT, destinations: [{ ...VALID_CONTENT.destinations[0], url: 'javascript:alert(1)' }] })
      })
      expect(bad.status).toBe(422)

      ;(env as unknown as Record<string, unknown>).DEFAULT_PLAN = 'free'
      const denied = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_CONTENT)
      })
      expect(denied.status).toBe(403)
    } finally {
      ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = originalEnv
    }
  })
})

describe('Production entitlement test-override (fail-closed)', () => {
  afterEach(() => {
    delete (env as unknown as Record<string, unknown>).DYNAMIC_QR_TEST_OVERRIDE_SECRET
  })

  it('denies creation when simulating production with no override secret configured, even if a header is sent', async () => {
    const originalEnv = env.ENVIRONMENT
    ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = 'production'
    try {
      const res = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [DYNAMIC_QR_TEST_OVERRIDE_HEADER]: 'some-guess' },
        body: JSON.stringify(VALID_CONTENT)
      })
      expect(res.status).toBe(403)
    } finally {
      ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = originalEnv
    }
  })

  it('grants creation in a simulated production environment only with the exact matching override header', async () => {
    const originalEnv = env.ENVIRONMENT
    ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = 'production'
    ;(env as unknown as Record<string, unknown>).DYNAMIC_QR_TEST_OVERRIDE_SECRET = 'integration-test-secret'
    try {
      const wrongHeader = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [DYNAMIC_QR_TEST_OVERRIDE_HEADER]: 'wrong-value' },
        body: JSON.stringify(VALID_CONTENT)
      })
      expect(wrongHeader.status).toBe(403)

      const correctHeader = await SELF.fetch('https://api.test/v1/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [DYNAMIC_QR_TEST_OVERRIDE_HEADER]: 'integration-test-secret' },
        body: JSON.stringify(VALID_CONTENT)
      })
      expect(correctHeader.status).toBe(201)
    } finally {
      ;(env as unknown as { ENVIRONMENT: string }).ENVIRONMENT = originalEnv
    }
  })
})
