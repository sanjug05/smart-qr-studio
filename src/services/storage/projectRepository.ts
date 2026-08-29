import type { QRProject } from '@/types/project'
import { createNewProject, generateSlug } from '@/types/project'

/**
 * Storage is abstracted behind this interface so the UI never talks to
 * localStorage directly. Swapping in a real backend later (see README →
 * "Future dynamic QR capability") means writing one new class that
 * implements this interface — no UI or QR-generation code changes.
 */
export interface ProjectRepository {
  list(): Promise<QRProject[]>
  get(id: string): Promise<QRProject | undefined>
  getBySlug(slug: string): Promise<QRProject | undefined>
  save(project: QRProject): Promise<void>
  remove(id: string): Promise<void>
  isSlugTaken(slug: string, excludeId?: string): Promise<boolean>
}

/** Thrown by `save()` when the browser's storage quota is exceeded. */
export class StorageQuotaExceededError extends Error {
  constructor() {
    super('Local storage is full — this project could not be saved. Free up space (Settings → Clear local data, or remove an old project) and try again.')
    this.name = 'StorageQuotaExceededError'
  }
}

const STORAGE_KEY = 'smart-qr-studio:projects:v1'

/**
 * Runtime shape guard for records coming out of localStorage. Data there
 * can be corrupted by a partial write, edited by hand in devtools, or left
 * over from a future/older schema version — none of that should crash the
 * app. A record that doesn't look like a QRProject is dropped rather than
 * trusted, so one bad entry can't take down the whole list.
 */
export function isValidProject(value: unknown): value is QRProject {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.slug === 'string' &&
    typeof p.brand === 'object' &&
    p.brand !== null &&
    Array.isArray(p.destinations) &&
    typeof p.qrStyle === 'object' &&
    p.qrStyle !== null &&
    typeof p.createdAt === 'string' &&
    typeof p.updatedAt === 'string'
  )
}

class LocalStorageProjectRepository implements ProjectRepository {
  private read(): QRProject[] {
    let raw: string | null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
    } catch {
      // localStorage can throw in private-browsing modes with storage
      // disabled, or when third-party storage is blocked — treat as empty
      // rather than crash the caller.
      return []
    }
    if (!raw) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isValidProject)
  }

  private write(projects: QRProject[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    } catch (err) {
      const isQuotaError =
        err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
      throw isQuotaError ? new StorageQuotaExceededError() : err
    }
  }

  async list(): Promise<QRProject[]> {
    return this.read().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async get(id: string): Promise<QRProject | undefined> {
    return this.read().find((p) => p.id === id)
  }

  async getBySlug(slug: string): Promise<QRProject | undefined> {
    return this.read().find((p) => p.slug === slug)
  }

  async save(project: QRProject): Promise<void> {
    const projects = this.read()
    const index = projects.findIndex((p) => p.id === project.id)
    if (index >= 0) {
      projects[index] = project
    } else {
      projects.push(project)
    }
    this.write(projects)
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((p) => p.id !== id))
  }

  async isSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
    return this.read().some((p) => p.slug === slug && p.id !== excludeId)
  }
}

// Single shared instance. Replace with an HTTP-backed implementation when a
// backend exists — every consumer imports `projectRepository`, not the class.
export const projectRepository: ProjectRepository = new LocalStorageProjectRepository()

/**
 * Creates a new in-memory project with a slug guaranteed not to collide
 * with an existing one. Slugs are 8 hex-ish characters of a UUID (~32 bits
 * of entropy), so a collision is astronomically unlikely in practice, but
 * checking is nearly free and the alternative — two different companies'
 * QR codes silently aliasing the same landing page — is bad enough to be
 * worth guarding against explicitly rather than trusting probability.
 */
export async function createUniqueProject(): Promise<QRProject> {
  const project = createNewProject()
  while (await projectRepository.isSlugTaken(project.slug)) {
    project.slug = generateSlug()
  }
  return project
}
