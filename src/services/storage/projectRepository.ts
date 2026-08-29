import type { QRProject } from '@/types/project'

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

const STORAGE_KEY = 'smart-qr-studio:projects:v1'

class LocalStorageProjectRepository implements ProjectRepository {
  private read(): QRProject[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private write(projects: QRProject[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
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
