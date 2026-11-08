import { describe, it, expect, beforeEach } from 'vitest'
import { projectRepository, createUniqueProject } from './projectRepository'
import { createNewProject } from '@/types/project'

// A visitor may already hold a project in localStorage that was created by the (now removed) sample button.
// It is ordinary user data and must survive untouched: no clearing, migration or rewriting on read.
const KEY = 'smart-qr-studio:projects:v1'

function seed() {
  const earlier = createNewProject()
  earlier.brand.companyName = ['A', 'I', 'S'].join('')
  const raw = JSON.stringify([earlier])
  localStorage.setItem(KEY, raw)
  return { earlier, raw }
}

describe('existing local projects are preserved', () => {
  beforeEach(() => localStorage.clear())

  it('reading (list/get/getBySlug/isSlugTaken) never rewrites the stored value', async () => {
    const { earlier, raw } = seed()
    expect(await projectRepository.list()).toHaveLength(1)
    expect((await projectRepository.get(earlier.id))?.brand.companyName).toBe(earlier.brand.companyName)
    expect((await projectRepository.getBySlug(earlier.slug))?.id).toBe(earlier.id)
    expect(await projectRepository.isSlugTaken(earlier.slug)).toBe(true)
    expect(localStorage.getItem(KEY)).toBe(raw) // byte-for-byte identical
  })

  it('creating and saving a new project keeps the earlier record unchanged', async () => {
    const { earlier } = seed()
    const fresh = await createUniqueProject()
    fresh.brand.companyName = 'Example Co'
    await projectRepository.save(fresh)
    const all = await projectRepository.list()
    expect(all.map((p) => p.id).sort()).toEqual([earlier.id, fresh.id].sort())
    expect(all.find((p) => p.id === earlier.id)).toEqual(earlier)
  })

  it('editing a different project does not alter the earlier record', async () => {
    const { earlier } = seed()
    const other = await createUniqueProject()
    await projectRepository.save(other)
    await projectRepository.save({ ...other, brand: { ...other.brand, companyName: 'Renamed Co' } })
    expect(await projectRepository.get(earlier.id)).toEqual(earlier)
  })
})
