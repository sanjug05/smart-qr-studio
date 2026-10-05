import { describe, it, expect, beforeEach } from 'vitest'
import type { QRProject } from '@/types/project'
import type { ProjectRepository } from '@/services/storage/projectRepository'
import { createNewProject } from '@/types/project'
import { CLOUD_IMAGE_BUDGET_CHARS, fromCloudDoc, hasUnsavedChanges, toCloudDoc, withCloudSync, type CloudProjectDoc } from './cloudProject'
import { CloudConflictError, createCloudProjectRepository, MAX_LIBRARY_READ, type DocStore } from './cloudProjectRepository'
import { createLibraryService, DynamicQrOwnedByOtherError, dismissMigration, isMigrationDismissed } from './libraryService'

/** In-memory Firestore stand-in that applies the SAME version rule as firestore.rules (create → 1, update → previous + 1). */
function fakeDocStore() {
  const docs = new Map<string, CloudProjectDoc>()
  const log: string[] = []
  const store: DocStore = {
    async get(path) {
      log.push(`get ${path}`)
      return docs.get(path) ?? null
    },
    async set(path, data) {
      log.push(`set ${path}`)
      const existing = docs.get(path)
      const ok = existing ? data.version === existing.version + 1 : data.version === 1
      if (!ok) throw Object.assign(new Error('denied'), { code: 'permission-denied' })
      docs.set(path, structuredClone(data))
    },
    async remove(path) {
      log.push(`remove ${path}`)
      docs.delete(path)
    },
    async list(prefix, max) {
      log.push(`list ${prefix} ${max}`)
      return [...docs.entries()].filter(([p]) => p.startsWith(prefix + '/')).map(([, d]) => structuredClone(d)).slice(0, max)
    }
  }
  return { store, docs, log }
}

function fakeLocal(): ProjectRepository & { all: Map<string, QRProject> } {
  const all = new Map<string, QRProject>()
  return {
    all,
    async list() {
      return [...all.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    },
    async get(id) {
      return all.get(id)
    },
    async getBySlug(slug) {
      return [...all.values()].find((p) => p.slug === slug)
    },
    async save(p) {
      all.set(p.id, structuredClone(p))
    },
    async remove(id) {
      all.delete(id)
    },
    async isSlugTaken(slug) {
      return [...all.values()].some((p) => p.slug === slug)
    }
  }
}

const project = (over: Partial<QRProject> = {}): QRProject => {
  const p = createNewProject()
  p.brand.companyName = 'Acme'
  return { ...p, ...over }
}

describe('toCloudDoc / fromCloudDoc', () => {
  it('stores configuration only: no QR images, no tokens, no owner id', () => {
    const doc = toCloudDoc(project({ qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: '2026-01-01T00:00:00.000Z' } }), 1)
    const json = JSON.stringify(doc)
    expect(json).not.toMatch(/data:image\/(png|svg)/)
    expect(json).not.toMatch(/token|owner/i)
    expect(doc.dynamicQr).toEqual({ publicId: 'AbC123xyz789', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(doc.qrMode).toBe('dynamic')
    expect(Object.keys(doc).sort()).toEqual(
      ['brand', 'createdAt', 'designConfig', 'destinations', 'dynamicQr', 'id', 'qrMode', 'qrStyle', 'schemaVersion', 'slug', 'updatedAt', 'version'].sort()
    )
  })

  it('a static project never carries a dynamicQr block, even if a stale one is attached', () => {
    const doc = toCloudDoc(project({ qrMode: 'static', dynamicQr: { publicId: 'x', createdAt: 'y' } }), 1)
    expect(doc.qrMode).toBe('static')
    expect(doc.dynamicQr).toBeUndefined()
  })

  it('timestamps are epoch-millisecond integers and survive a round trip', () => {
    const p = project({ createdAt: '2026-03-04T05:06:07.000Z', updatedAt: '2026-03-05T05:06:07.000Z' })
    const doc = toCloudDoc(p, 3)
    expect(doc.createdAt).toBe(Date.parse('2026-03-04T05:06:07.000Z'))
    expect(Number.isInteger(doc.updatedAt)).toBe(true)
    const back = fromCloudDoc(doc)!
    expect(back.createdAt).toBe('2026-03-04T05:06:07.000Z')
    expect(back.updatedAt).toBe('2026-03-05T05:06:07.000Z')
    expect(back.cloud).toEqual({ version: 3, syncedAt: '2026-03-05T05:06:07.000Z' })
  })

  it('keeps small images, drops images beyond the budget, and flags it', () => {
    const small = 'data:image/png;base64,' + 'A'.repeat(1000)
    const p = project()
    p.brand.logoDataUrl = small
    expect(toCloudDoc(p, 1).brand.logoDataUrl).toBe(small)
    expect(toCloudDoc(p, 1).imagesOmitted).toBeUndefined()

    const huge = 'data:image/png;base64,' + 'A'.repeat(CLOUD_IMAGE_BUDGET_CHARS)
    p.brand.logoDataUrl = huge
    const doc = toCloudDoc(p, 1)
    expect(doc.brand.logoDataUrl).toBeUndefined()
    expect(doc.imagesOmitted).toBe(true)
  })

  it('the image budget is shared across logo, branding logo and destination icons', () => {
    const chunk = 'data:image/png;base64,' + 'A'.repeat(100_000)
    const p = project()
    p.brand.logoDataUrl = chunk
    p.qrStyle.brandingLogoDataUrl = chunk
    p.destinations[0].customIconDataUrl = chunk
    const doc = toCloudDoc(p, 1)
    const kept = [doc.brand.logoDataUrl, doc.qrStyle.brandingLogoDataUrl, doc.destinations[0].customIconDataUrl].filter(Boolean)
    expect(kept).toHaveLength(2)
    expect(doc.imagesOmitted).toBe(true)
  })

  it('never writes more than five destinations', () => {
    const p = project()
    p.destinations = Array.from({ length: 8 }, (_, i) => ({ ...p.destinations[0], id: `d${i}`, order: i }))
    expect(toCloudDoc(p, 1).destinations).toHaveLength(5)
  })

  it('rejects malformed cloud documents instead of crashing', () => {
    expect(fromCloudDoc(null)).toBeNull()
    expect(fromCloudDoc({})).toBeNull()
    expect(fromCloudDoc({ id: 'x', createdAt: 'not-a-number', updatedAt: 1, version: 1 })).toBeNull()
    expect(fromCloudDoc({ ...toCloudDoc(project(), 1), brand: null })).toBeNull()
  })
})

describe('hasUnsavedChanges / withCloudSync', () => {
  it('a project never saved to the cloud counts as unsaved', () => {
    expect(hasUnsavedChanges(project())).toBe(true)
  })
  it('is in step right after a sync and unsaved once edited again', () => {
    const synced = withCloudSync(project(), 4)
    expect(hasUnsavedChanges(synced)).toBe(false)
    expect(hasUnsavedChanges({ ...synced, updatedAt: new Date(Date.parse(synced.updatedAt) + 5000).toISOString() })).toBe(true)
  })
})

describe('cloudProjectRepository', () => {
  let ctx: ReturnType<typeof fakeDocStore>
  beforeEach(() => {
    ctx = fakeDocStore()
  })

  it('saves under users/{uid}/projects/{id} and lists only that user’s projects, newest first', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    await repo.save('alice', project({ id: 'p1', updatedAt: '2026-01-01T00:00:00.000Z' }))
    await repo.save('alice', project({ id: 'p2', updatedAt: '2026-02-01T00:00:00.000Z' }))
    await repo.save('bob', project({ id: 'p3' }))
    expect([...ctx.docs.keys()].sort()).toEqual(['users/alice/projects/p1', 'users/alice/projects/p2', 'users/bob/projects/p3'])
    expect((await repo.list('alice')).map((p) => p.id)).toEqual(['p2', 'p1'])
    expect((await repo.list('bob')).map((p) => p.id)).toEqual(['p3'])
  })

  it('bounds one library read (cost guard) and never reads the other user’s collection', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    await repo.list('alice')
    expect(ctx.log).toEqual([`list users/alice/projects ${MAX_LIBRARY_READ}`])
  })

  it('increments the cloud version on every save and returns the synced project', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    let p = await repo.save('alice', project({ id: 'p1' }))
    expect(p.cloud?.version).toBe(1)
    p = await repo.save('alice', { ...p, updatedAt: new Date(Date.now() + 1000).toISOString() })
    expect(p.cloud?.version).toBe(2)
    expect(ctx.docs.get('users/alice/projects/p1')?.version).toBe(2)
  })

  it('never silently overwrites newer cloud data: a stale save raises a conflict with the cloud copy', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    const deviceA = await repo.save('alice', project({ id: 'p1', brand: { ...project().brand, companyName: 'v1' } }))
    const deviceB = (await repo.get('alice', 'p1'))!
    await repo.save('alice', { ...deviceB, brand: { ...deviceB.brand, companyName: 'from B' }, updatedAt: new Date(Date.now() + 1000).toISOString() })

    const stale = { ...deviceA, brand: { ...deviceA.brand, companyName: 'from A (stale)' }, updatedAt: new Date(Date.now() + 2000).toISOString() }
    await expect(repo.save('alice', stale)).rejects.toBeInstanceOf(CloudConflictError)
    expect(ctx.docs.get('users/alice/projects/p1')?.brand.companyName).toBe('from B')

    const err = (await repo.save('alice', stale).catch((e: unknown) => e)) as CloudConflictError
    expect(err.cloudVersion).toBe(2)
    expect(err.cloudProject?.brand.companyName).toBe('from B')
  })

  it('force-saving after a conflict deliberately overwrites with the next revision', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    const a = await repo.save('alice', project({ id: 'p1' }))
    const b = (await repo.get('alice', 'p1'))!
    await repo.save('alice', { ...b, updatedAt: new Date(Date.now() + 1000).toISOString() })
    const saved = await repo.save('alice', { ...a, brand: { ...a.brand, companyName: 'chosen' }, updatedAt: new Date(Date.now() + 2000).toISOString() }, { force: true })
    expect(saved.cloud?.version).toBe(3)
    expect(ctx.docs.get('users/alice/projects/p1')?.brand.companyName).toBe('chosen')
  })

  it('a permission failure that is not a stale version is rethrown, not reported as a conflict', async () => {
    const repo = createCloudProjectRepository({
      ...ctx.store,
      async set() {
        throw Object.assign(new Error('denied'), { code: 'permission-denied' })
      }
    })
    await expect(repo.save('alice', project({ id: 'p9' }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('non-permission errors are rethrown untouched', async () => {
    const repo = createCloudProjectRepository({
      ...ctx.store,
      async set() {
        throw Object.assign(new Error('offline'), { code: 'unavailable' })
      }
    })
    await expect(repo.save('alice', project())).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('removes a project and get() returns undefined afterwards', async () => {
    const repo = createCloudProjectRepository(ctx.store)
    await repo.save('alice', project({ id: 'p1' }))
    await repo.remove('alice', 'p1')
    expect(await repo.get('alice', 'p1')).toBeUndefined()
  })
})

describe('libraryService', () => {
  let ctx: ReturnType<typeof fakeDocStore>
  let local: ReturnType<typeof fakeLocal>
  let claims: string[]
  let claimResult: 'claimed' | 'skipped' | 'owned-by-other' | 'error'

  const make = () =>
    createLibraryService({
      cloud: createCloudProjectRepository(ctx.store),
      local,
      claimDynamicQr: async (id) => {
        claims.push(id)
        return claimResult
      }
    })

  beforeEach(() => {
    ctx = fakeDocStore()
    local = fakeLocal()
    claims = []
    claimResult = 'claimed'
  })

  it('saveToCloud writes the cloud copy and records the revision on the device copy', async () => {
    const lib = make()
    const p = project({ id: 'p1' })
    await local.save(p)
    const synced = await lib.saveToCloud('alice', p)
    expect(synced.cloud?.version).toBe(1)
    expect((await local.get('p1'))?.cloud?.version).toBe(1)
    expect(hasUnsavedChanges((await local.get('p1'))!)).toBe(false)
  })

  it('a Dynamic QR is claimed for the account first; its publicId is unchanged', async () => {
    const lib = make()
    const synced = await lib.saveToCloud('alice', project({ id: 'p1', qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } }))
    expect(claims).toEqual(['AbC123xyz789'])
    expect(synced.dynamicQr?.publicId).toBe('AbC123xyz789')
    expect(ctx.docs.get('users/alice/projects/p1')?.dynamicQr?.publicId).toBe('AbC123xyz789')
  })

  it('a static project triggers no claim', async () => {
    await make().saveToCloud('alice', project({ id: 'p1' }))
    expect(claims).toEqual([])
  })

  it('refuses to save a Dynamic QR that already belongs to another account — and writes nothing', async () => {
    claimResult = 'owned-by-other'
    await expect(make().saveToCloud('alice', project({ id: 'p1', qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } }))).rejects.toBeInstanceOf(DynamicQrOwnedByOtherError)
    expect(ctx.docs.size).toBe(0)
  })

  it('a failed or skipped claim does not block saving (the owner can already manage it)', async () => {
    for (const r of ['error', 'skipped'] as const) {
      claimResult = r
      await make().saveToCloud('alice', project({ id: `p-${r}`, qrMode: 'dynamic', dynamicQr: { publicId: `id-${r}`, createdAt: 'x' } }))
    }
    expect(ctx.docs.size).toBe(2)
  })

  it('saveManyToCloud continues past a failure and reports it', async () => {
    const lib = make()
    claimResult = 'owned-by-other'
    const ok = project({ id: 'ok' })
    const bad = project({ id: 'bad', qrMode: 'dynamic', dynamicQr: { publicId: 'zzz', createdAt: 'x' } })
    const result = await lib.saveManyToCloud('alice', [bad, ok])
    expect(result.saved).toEqual(['ok'])
    expect(result.failed.map((f) => f.id)).toEqual(['bad'])
  })

  it('localOnly lists device projects that are not in the cloud list', async () => {
    const lib = make()
    await local.save(project({ id: 'a' }))
    await local.save(project({ id: 'b' }))
    const cloudList = [project({ id: 'a' })]
    expect((await lib.localOnly(cloudList)).map((p) => p.id)).toEqual(['b'])
  })

  it('cross-device: a project saved on device A opens on device B with identical content', async () => {
    const lib = make()
    const onA = project({ id: 'p1', brand: { ...project().brand, companyName: 'Cross Device Co' } })
    await lib.saveToCloud('alice', onA)

    const deviceBLocal = fakeLocal()
    const libB = createLibraryService({ cloud: createCloudProjectRepository(ctx.store), local: deviceBLocal, claimDynamicQr: async () => 'skipped' })
    const listed = await createCloudProjectRepository(ctx.store).list('alice')
    expect(listed.map((p) => p.brand.companyName)).toEqual(['Cross Device Co'])
    const opened = await libB.openForEditing(listed[0])
    expect(opened.kind).toBe('ready')
    expect((await deviceBLocal.get('p1'))?.brand.companyName).toBe('Cross Device Co')
  })

  it('opening takes the cloud version when the device copy has no unsaved edits', async () => {
    const lib = make()
    const v1 = await lib.saveToCloud('alice', project({ id: 'p1' }))
    const newer = await createCloudProjectRepository(ctx.store).save('alice', { ...v1, brand: { ...v1.brand, companyName: 'edited elsewhere' }, updatedAt: new Date(Date.now() + 1000).toISOString() })
    const result = await lib.openForEditing(newer)
    expect(result).toEqual({ kind: 'ready', project: newer })
    expect((await local.get('p1'))?.brand.companyName).toBe('edited elsewhere')
  })

  it('opening reports a conflict instead of silently discarding unsaved device edits', async () => {
    const lib = make()
    const v1 = await lib.saveToCloud('alice', project({ id: 'p1' }))
    await local.save({ ...v1, brand: { ...v1.brand, companyName: 'unsaved local edit' }, updatedAt: new Date(Date.now() + 5000).toISOString() })
    const newer = await createCloudProjectRepository(ctx.store).save('alice', { ...v1, updatedAt: new Date(Date.now() + 1000).toISOString() })

    const result = await lib.openForEditing(newer)
    expect(result.kind).toBe('conflict')
    expect((await local.get('p1'))?.brand.companyName).toBe('unsaved local edit')

    const chosen = await lib.openForEditing(newer, { useCloud: true })
    expect(chosen.kind).toBe('ready')
    expect((await local.get('p1'))?.cloud?.version).toBe(2)
  })

  it('opening keeps an in-step device copy as is', async () => {
    const lib = make()
    const v1 = await lib.saveToCloud('alice', project({ id: 'p1' }))
    const result = await lib.openForEditing(v1)
    expect(result.kind).toBe('ready')
  })

  it('duplicate makes an independent copy with a new id and slug; Dynamic QR cannot be duplicated', async () => {
    const lib = make()
    const original = await lib.saveToCloud('alice', project({ id: 'p1' }))
    const copy = await lib.duplicate('alice', original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.slug).not.toBe(original.slug)
    expect(copy.brand.companyName).toBe('Acme (copy)')
    expect(copy.cloud?.version).toBe(1)
    expect(ctx.docs.size).toBe(2)
    await expect(lib.duplicate('alice', project({ id: 'd1', qrMode: 'dynamic', dynamicQr: { publicId: 'x', createdAt: 'y' } }))).rejects.toThrow(/can.t be duplicated/)
  })

  it('deleteFromCloud removes the cloud doc and the device cache', async () => {
    const lib = make()
    const synced = await lib.saveToCloud('alice', project({ id: 'p1' }))
    await lib.deleteFromCloud('alice', synced.id)
    expect(ctx.docs.size).toBe(0)
    expect(await local.get('p1')).toBeUndefined()
  })
})

describe('migration prompt dismissal', () => {
  beforeEach(() => localStorage.clear())
  it('is remembered per account on this device', () => {
    expect(isMigrationDismissed('alice')).toBe(false)
    dismissMigration('alice')
    expect(isMigrationDismissed('alice')).toBe(true)
    expect(isMigrationDismissed('bob')).toBe(false)
  })
})
