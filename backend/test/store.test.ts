import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { createMemoryStore } from '../src/memoryStore'
import { createFirestoreStore, COLLECTION } from '../src/firestoreStore'
import { SELF, store } from './harness'
import { MAX_CONTENT_BYTES } from '../src/lib/validation'
import type { DynamicQrRecord } from '../src/types'

const record = (over: Partial<DynamicQrRecord> = {}): DynamicQrRecord => ({
  publicId: 'AbC123xyz789',
  ownerId: null,
  tokenHash: 'a'.repeat(64),
  status: 'active',
  content: { brand: { companyName: 'Acme', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' }, destinations: [] },
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

describe('QrStore contract (memory implementation)', () => {
  it('create never overwrites an existing publicId', async () => {
    const s = createMemoryStore()
    expect(await s.create(record())).toBe(true)
    expect(await s.create(record({ tokenHash: 'b'.repeat(64) }))).toBe(false)
    expect((await s.get('AbC123xyz789'))?.tokenHash).toBe('a'.repeat(64))
  })

  it('transact returns null for an unknown id and applies the patch atomically otherwise', async () => {
    const s = createMemoryStore()
    expect(await s.transact('missing', async () => ({ result: 'x' }))).toBeNull()
    await s.create(record())
    const out = await s.transact('AbC123xyz789', async (r) => ({ patch: { version: r.version + 1 }, result: r.version }))
    expect(out).toBe(1)
    expect((await s.get('AbC123xyz789'))?.version).toBe(2)
  })

  it('transact without a patch leaves the record untouched', async () => {
    const s = createMemoryStore()
    await s.create(record())
    await s.transact('AbC123xyz789', async () => ({ result: null }))
    expect((await s.get('AbC123xyz789'))?.version).toBe(1)
  })

  it('concurrent transactions serialize: ten increments yield version 11, none lost', async () => {
    const s = createMemoryStore()
    await s.create(record())
    await Promise.all(Array.from({ length: 10 }, () => s.transact('AbC123xyz789', async (r) => ({ patch: { version: r.version + 1 }, result: null }))))
    expect((await s.get('AbC123xyz789'))?.version).toBe(11)
  })
})

describe('Firestore adapter — maps the QrStore contract onto the Firestore API', () => {
  function fakeDb(existing: Record<string, DynamicQrRecord> = {}) {
    const docs = { ...existing }
    const calls: { collection?: string; created?: string; updated?: unknown } = {}
    const docRef = (id: string) => ({
      id,
      get: async () => ({ exists: id in docs, data: () => docs[id] }),
      create: async (data: DynamicQrRecord) => {
        if (id in docs) throw Object.assign(new Error('exists'), { code: 6 })
        docs[id] = data
        calls.created = id
      }
    })
    const db = {
      collection: (name: string) => {
        calls.collection = name
        return { doc: docRef }
      },
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async (ref: { id: string }) => ({ exists: ref.id in docs, data: () => docs[ref.id] }),
          update: (ref: { id: string }, patch: Partial<DynamicQrRecord>) => {
            docs[ref.id] = { ...docs[ref.id], ...patch }
            calls.updated = patch
          }
        })
    }
    return { db: db as unknown as Firestore, docs, calls }
  }

  it('stores documents under dynamic_qr/{publicId}', async () => {
    const { db, docs, calls } = fakeDb()
    expect(await createFirestoreStore(db).create(record())).toBe(true)
    expect(calls.collection).toBe(COLLECTION)
    expect(COLLECTION).toBe('dynamic_qr')
    expect(docs['AbC123xyz789'].publicId).toBe('AbC123xyz789')
  })

  it('treats ALREADY_EXISTS as "id taken" (false), never an overwrite', async () => {
    const { db, docs } = fakeDb({ AbC123xyz789: record() })
    expect(await createFirestoreStore(db).create(record({ tokenHash: 'c'.repeat(64) }))).toBe(false)
    expect(docs['AbC123xyz789'].tokenHash).toBe('a'.repeat(64))
  })

  it('rethrows unexpected create errors instead of swallowing them', async () => {
    const { db } = fakeDb()
    ;(db as unknown as { collection: () => unknown }).collection = () => ({ doc: () => ({ create: async () => { throw Object.assign(new Error('boom'), { code: 14 }) } }) })
    await expect(createFirestoreStore(db).create(record())).rejects.toThrow('boom')
  })

  it('transact reads and patches inside the transaction, and returns null for a missing document', async () => {
    const { db, docs, calls } = fakeDb({ AbC123xyz789: record() })
    const s = createFirestoreStore(db)
    expect(await s.transact('nope', async () => ({ result: 1 }))).toBeNull()
    expect(await s.transact('AbC123xyz789', async (r) => ({ patch: { version: r.version + 1 }, result: 'ok' }))).toBe('ok')
    expect(docs['AbC123xyz789'].version).toBe(2)
    expect(calls.updated).toEqual({ version: 2 })
  })
})

const CONTENT = {
  brand: { companyName: 'Acme', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' },
  destinations: [{ id: 'd0', label: 'Site', url: 'https://example.com', icon: '🌐', enabled: true, order: 0 }]
}

describe('API behavior added with the Firestore migration', () => {
  it('stores only the token HASH — the raw management token appears nowhere in the stored document', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) })
    const body = (await res.json()) as { publicId: string; managementToken: string }
    const stored = await store.get(body.publicId)
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(body.managementToken)
    expect(stored?.ownerId).toBeNull()
    expect(stored?.version).toBe(1)
    expect(Object.keys(stored ?? {}).sort()).toEqual(['content', 'createdAt', 'ownerId', 'publicId', 'status', 'tokenHash', 'updatedAt', 'version'])
  })

  it('public resolution exposes exactly status/content/version — no hash, owner or timestamps', async () => {
    const created = (await (await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) })).json()) as { publicId: string }
    const body = (await (await SELF.fetch(`https://api.test/v1/qr/${created.publicId}`)).json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['content', 'status', 'version'])
  })

  it('rejects content too large for a single Firestore document with a clear 422', async () => {
    const hugeLogo = 'data:image/png;base64,' + 'A'.repeat(MAX_CONTENT_BYTES)
    const res = await SELF.fetch('https://api.test/v1/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CONTENT, brand: { ...CONTENT.brand, logoDataUrl: hugeLogo } })
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toMatch(/too large/i)
  })

  it('accepts a modest logo image well under the document budget', async () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(100_000)
    const res = await SELF.fetch('https://api.test/v1/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CONTENT, brand: { ...CONTENT.brand, logoDataUrl: logo } })
    })
    expect(res.status).toBe(201)
  })

  it('a malformed percent-escape in the id is a 404, not a server error', async () => {
    const res = await SELF.fetch('https://api.test/v1/qr/%E0%A4%A')
    expect(res.status).toBe(404)
  })

  it('unknown routes and wrong methods are 404', async () => {
    expect((await SELF.fetch('https://api.test/v1/other')).status).toBe(404)
    expect((await SELF.fetch('https://api.test/v1/qr/AbC123xyz789', { method: 'DELETE' })).status).toBe(404)
  })

  it('updating or disabling an unknown publicId is a 404 (not an auth error that leaks existence differently)', async () => {
    const put = await SELF.fetch('https://api.test/v1/qr/doesNotExist1', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: JSON.stringify(CONTENT) })
    const patch = await SELF.fetch('https://api.test/v1/qr/doesNotExist1/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: JSON.stringify({ status: 'disabled' }) })
    expect(put.status).toBe(404)
    expect(patch.status).toBe(404)
  })

  it('every version increment is gap-free across sequential and concurrent publishes', async () => {
    const created = (await (await SELF.fetch('https://api.test/v1/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) })).json()) as { publicId: string; managementToken: string }
    const put = () =>
      SELF.fetch(`https://api.test/v1/qr/${created.publicId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.managementToken}` }, body: JSON.stringify(CONTENT) })
    const versions = await Promise.all(Array.from({ length: 8 }, async () => ((await (await put()).json()) as { version: number }).version))
    expect(versions.sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
  })
})
