/**
 * LIVE verification against the real production Firebase project (Auth,
 * Firestore with the deployed rules, and the deployed Cloud Function).
 * NOT part of `npm test`. Run with:
 *
 *   npx vitest run --config vitest.live.config.ts
 *
 * Needs the Anonymous sign-in provider temporarily enabled on the project:
 * it gives disposable, distinct identities (user A / user B) without any
 * personal Google account. Everything it creates is deleted at the end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInAnonymously, deleteUser, type Auth } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, deleteDoc, query, limit, type Firestore } from 'firebase/firestore'
import { createNewProject, type QRProject } from '@/types/project'
import { createCloudProjectRepository, CloudConflictError, type DocStore } from '@/services/cloud/cloudProjectRepository'
import { createLibraryService } from '@/services/cloud/libraryService'
import type { ProjectRepository } from '@/services/storage/projectRepository'

const env = import.meta.env
const API = env.VITE_DYNAMIC_QR_API_BASE_URL as string
const FB = { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID }
const ID_HEADER = 'X-Firebase-ID-Token'

interface Actor {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  uid: string
  token: () => Promise<string>
  store: DocStore
}

function makeStore(db: Firestore): DocStore {
  return {
    async get(path) {
      const s = await getDoc(doc(db, path))
      return s.exists() ? s.data() : null
    },
    async set(path, data) {
      await setDoc(doc(db, path), data)
    },
    async remove(path) {
      await deleteDoc(doc(db, path))
    },
    async list(col, max) {
      return (await getDocs(query(collection(db, col), limit(max)))).docs.map((d) => d.data())
    }
  }
}

async function actor(name: string, signIn = true): Promise<Actor> {
  const app = initializeApp(FB, name)
  const auth = getAuth(app)
  if (signIn) await signInAnonymously(auth)
  const db = getFirestore(app)
  return { app, auth, db, uid: auth.currentUser?.uid ?? '', token: async () => (await auth.currentUser!.getIdToken()), store: makeStore(db) }
}

const CONTENT = (url: string) => ({
  brand: { companyName: 'LIVE-TEST (disposable)', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' },
  destinations: [{ id: 'd0', label: 'Site', url, icon: '🌐', enabled: true, order: 0 }]
})

async function api(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? (method === 'POST' || method === 'PATCH' || method === 'PUT' ? '{}' : undefined) : JSON.stringify(body) })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}

const fakeLocal = (): ProjectRepository => {
  const m = new Map<string, QRProject>()
  return { list: async () => [...m.values()], get: async (id) => m.get(id), getBySlug: async () => undefined, save: async (p) => void m.set(p.id, p), remove: async (id) => void m.delete(id), isSlugTaken: async () => false }
}

let A: Actor
let B: Actor
let U: Actor
const createdQrIds: string[] = []
const projectIds: Array<{ uid: string; id: string }> = []

beforeAll(async () => {
  A = await actor('live-A')
  B = await actor('live-B')
  U = await actor('live-U', false)
  expect(A.uid).toBeTruthy()
  expect(B.uid).toBeTruthy()
  expect(A.uid).not.toBe(B.uid)
}, 60_000)

afterAll(async () => {
  for (const p of projectIds) await deleteDoc(doc(A.db, `users/${p.uid}/projects/${p.id}`)).catch(() => undefined)
  for (const a of [A, B]) {
    await deleteUser(a.auth.currentUser!).catch(() => undefined)
  }
  await Promise.all([A, B, U].map((a) => deleteApp(a.app).catch(() => undefined)))
  console.log('LIVE-TEST dynamic_qr ids to delete:', createdQrIds.join(' '))
}, 60_000)

describe('LIVE Firestore rules — owner isolation with real identities', () => {
  it('user A can save a Static project to their cloud library and list it back', async () => {
    const repo = createCloudProjectRepository(A.store)
    const p = { ...createNewProject(), brand: { ...createNewProject().brand, companyName: 'LIVE static' } }
    projectIds.push({ uid: A.uid, id: p.id })
    const saved = await repo.save(A.uid, p)
    expect(saved.cloud?.version).toBe(1)
    const list = await repo.list(A.uid)
    expect(list.map((x) => x.id)).toContain(p.id)
    expect(list.find((x) => x.id === p.id)?.brand.companyName).toBe('LIVE static')
  }, 60_000)

  it('user B sees an empty library and cannot read, write, overwrite or delete A’s documents', async () => {
    const repoA = createCloudProjectRepository(A.store)
    const p = { ...createNewProject(), brand: { ...createNewProject().brand, companyName: 'LIVE private' } }
    projectIds.push({ uid: A.uid, id: p.id })
    await repoA.save(A.uid, p)

    expect(await createCloudProjectRepository(B.store).list(B.uid)).toEqual([])
    const path = `users/${A.uid}/projects/${p.id}`
    await expect(B.store.list(`users/${A.uid}/projects`, 50)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(B.store.get(path)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(B.store.remove(path)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(B.store.set(path, { ...(await A.store.get(path) as never), version: 2 } as never)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(B.store.set(`users/${A.uid}/projects/brand-new`, { schemaVersion: 1, id: 'brand-new' } as never)).rejects.toMatchObject({ code: 'permission-denied' })
    // …and A’s data is untouched.
    expect((await A.store.get(path) as { version: number }).version).toBe(1)
  }, 60_000)

  it('an unauthenticated client cannot read or write any library, nor any Dynamic QR record', async () => {
    await expect(U.store.list(`users/${A.uid}/projects`, 5)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(U.store.get(`dynamic_qr/anything`)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(A.store.get(`dynamic_qr/anything`)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(A.store.set(`dynamic_qr/forged`, { publicId: 'forged', ownerId: A.uid } as never)).rejects.toMatchObject({ code: 'permission-denied' })
  }, 60_000)

  it('a stale device cannot silently overwrite a newer revision (version rule enforced server-side)', async () => {
    const repo = createCloudProjectRepository(A.store)
    const p = createNewProject()
    projectIds.push({ uid: A.uid, id: p.id })
    const v1 = await repo.save(A.uid, p)
    const v2 = await repo.save(A.uid, { ...v1, brand: { ...v1.brand, companyName: 'edited on device 2' }, updatedAt: new Date(Date.now() + 1000).toISOString() })
    expect(v2.cloud?.version).toBe(2)
    const stale = { ...v1, brand: { ...v1.brand, companyName: 'stale write' }, updatedAt: new Date(Date.now() + 2000).toISOString() }
    await expect(repo.save(A.uid, stale)).rejects.toBeInstanceOf(CloudConflictError)
    expect((await repo.get(A.uid, p.id))?.brand.companyName).toBe('edited on device 2')
  }, 60_000)
})

describe('LIVE backend — verified identity, ownership and the claim flow', () => {
  it('a Dynamic QR created while signed in is owned by the verified uid, resolves publicly, and is managed by the owner from "another device" (ID token only)', async () => {
    const created = await api('POST', '/v1/qr', { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/one'))
    expect(created.status).toBe(201)
    const id = created.json.publicId as string
    createdQrIds.push(id)

    const pub = await api('GET', `/v1/qr/${id}`)
    expect(pub.status).toBe(200)
    expect(Object.keys(pub.json).sort()).toEqual(['content', 'status', 'version'])

    // Device B of user A: no management token at all, only the ID token.
    const upd = await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/two'))
    expect(upd.status).toBe(200)
    expect(upd.json.version).toBe(2)
    const after = await api('GET', `/v1/qr/${id}`)
    expect(((after.json.content as { destinations: Array<{ url: string }> }).destinations[0].url)).toBe('https://live-test.example.net/two')
    expect(after.json.version).toBe(2)
  }, 60_000)

  it('another real user (B) cannot manage A’s Dynamic QR; the publicId and a forged token never authorize', async () => {
    const created = await api('POST', '/v1/qr', { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/x'))
    const id = created.json.publicId as string
    createdQrIds.push(id)
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await B.token() }, CONTENT('https://evil.example/'))).status).toBe(401)
    expect((await api('PATCH', `/v1/qr/${id}/status`, { [ID_HEADER]: await B.token() }, { status: 'disabled' })).status).toBe(401)
    expect((await api('PUT', `/v1/qr/${id}`, { Authorization: `Bearer ${id}` }, CONTENT('https://evil.example/'))).status).toBe(401)
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: 'forged.jwt.value' }, CONTENT('https://evil.example/'))).status).toBe(401)
    expect(((await api('GET', `/v1/qr/${id}`)).json.version)).toBe(1)
  }, 60_000)

  it('a client cannot forge the owner: a body ownerId/uid is ignored', async () => {
    const created = await api('POST', '/v1/qr', { [ID_HEADER]: await A.token() }, { ...CONTENT('https://live-test.example.net/y'), ownerId: B.uid, owner: B.uid })
    const id = created.json.publicId as string
    createdQrIds.push(id)
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await B.token() }, CONTENT('https://evil.example/'))).status).toBe(401)
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/y2'))).status).toBe(200)
  }, 60_000)

  it('migration: an ANONYMOUS Dynamic QR is attached to the account only with BOTH credentials; a second user cannot take it over', async () => {
    const anon = await api('POST', '/v1/qr', {}, CONTENT('https://live-test.example.net/anon'))
    const id = anon.json.publicId as string
    const mgmt = anon.json.managementToken as string
    createdQrIds.push(id)

    expect((await api('POST', `/v1/qr/${id}/claim`, { [ID_HEADER]: await A.token() })).status).toBe(401)
    expect((await api('POST', `/v1/qr/${id}/claim`, { Authorization: `Bearer ${mgmt}` })).status).toBe(401)
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await A.token() }, CONTENT('https://evil.example/'))).status).toBe(401) // no owner yet

    expect((await api('POST', `/v1/qr/${id}/claim`, { [ID_HEADER]: await A.token(), Authorization: `Bearer ${mgmt}` })).status).toBe(200)
    expect((await api('POST', `/v1/qr/${id}/claim`, { [ID_HEADER]: await B.token(), Authorization: `Bearer ${mgmt}` })).status).toBe(409)
    // Now A manages it from any device; the destination changes under the SAME publicId.
    expect((await api('PUT', `/v1/qr/${id}`, { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/anon-edited'))).status).toBe(200)
    expect(((await api('GET', `/v1/qr/${id}`)).json.version)).toBe(2)
  }, 60_000)

  it('library + Dynamic QR together: save a Dynamic project to the cloud (claim runs), edit it, and the cloud copy keeps the permanent publicId', async () => {
    const created = await api('POST', '/v1/qr', { [ID_HEADER]: await A.token() }, CONTENT('https://live-test.example.net/lib'))
    const publicId = created.json.publicId as string
    createdQrIds.push(publicId)
    const lib = createLibraryService({ cloud: createCloudProjectRepository(A.store), local: fakeLocal(), claimDynamicQr: async () => 'skipped' })
    const base = createNewProject()
    const project: QRProject = { ...base, qrMode: 'dynamic', dynamicQr: { publicId, createdAt: new Date().toISOString() }, brand: { ...base.brand, companyName: 'LIVE dynamic' } }
    projectIds.push({ uid: A.uid, id: project.id })

    const v1 = await lib.saveToCloud(A.uid, project)
    expect(v1.dynamicQr?.publicId).toBe(publicId)
    const edited = { ...v1, brand: { ...v1.brand, companyName: 'LIVE dynamic (edited)' }, updatedAt: new Date(Date.now() + 1000).toISOString() }
    const v2 = await lib.saveToCloud(A.uid, edited)
    expect(v2.cloud?.version).toBe(2)
    expect(v2.dynamicQr?.publicId).toBe(publicId)
    const cloud = await createCloudProjectRepository(A.store).list(A.uid)
    const stored = cloud.find((p) => p.id === project.id)!
    expect(stored.brand.companyName).toBe('LIVE dynamic (edited)')
    expect(JSON.stringify(stored)).not.toMatch(/management|token|ownerId/i)
  }, 60_000)

  it('cross-device source of truth: a separate client with the same identity reads the same Firestore data over REST', async () => {
    const token = await A.token()
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${A.uid}/projects?pageSize=50`, { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { documents?: Array<{ fields: { brand: { mapValue: { fields: { companyName: { stringValue: string } } } } } }> }
    const names = (body.documents ?? []).map((d) => d.fields.brand.mapValue.fields.companyName.stringValue)
    expect(names).toContain('LIVE dynamic (edited)')
    expect(names).toContain('LIVE static')
    // And B's token against A's collection over REST is refused.
    const denied = await fetch(`https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${A.uid}/projects?pageSize=5`, { headers: { Authorization: `Bearer ${await B.token()}` } })
    expect(denied.status).toBe(403)
  }, 60_000)
})
