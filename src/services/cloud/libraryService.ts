import type { QRProject } from '@/types/project'
import { createNewProject, generateSlug } from '@/types/project'
import type { ProjectRepository } from '@/services/storage/projectRepository'
import type { DynamicQrClaimResult } from '@/services/dynamicQr/dynamicQrService'
import { hasUnsavedChanges } from './cloudProject'
import type { CloudProjectRepository } from './cloudProjectRepository'

export interface LibraryDeps {
  cloud: CloudProjectRepository
  /** The on-device working copy (localStorage) — the editing buffer and the home of anonymous projects. */
  local: ProjectRepository
  /** Attaches an existing Dynamic QR to the signed-in account (needs this device's management token). */
  claimDynamicQr: (publicId: string) => Promise<DynamicQrClaimResult>
}

/** Thrown when a Dynamic QR can't be saved to this account because it already belongs to another one. */
export class DynamicQrOwnedByOtherError extends Error {
  constructor() {
    super('This Dynamic QR already belongs to a different account, so it can’t be saved to yours.')
    this.name = 'DynamicQrOwnedByOtherError'
  }
}

export interface BulkSaveResult {
  saved: string[]
  failed: Array<{ id: string; reason: string }>
}

export type OpenResult =
  | { kind: 'ready'; project: QRProject }
  /** The device has unsaved edits AND the cloud moved on: the user must choose. */
  | { kind: 'conflict'; local: QRProject; cloud: QRProject }

export function createLibraryService({ cloud, local, claimDynamicQr }: LibraryDeps) {
  /**
   * Saves `project` to the account's cloud library as its next revision and
   * records the new revision on the on-device copy. For a Dynamic QR it first
   * attaches the QR to the account (so the owner can manage it from any
   * device); the QR's `publicId` is never changed by any of this.
   */
  async function saveToCloud(uid: string, project: QRProject, options: { force?: boolean } = {}): Promise<QRProject> {
    if (project.qrMode === 'dynamic' && project.dynamicQr?.publicId) {
      const claim = await claimDynamicQr(project.dynamicQr.publicId)
      if (claim === 'owned-by-other') throw new DynamicQrOwnedByOtherError()
      // 'error' / 'skipped' are not fatal: a QR created while signed in is already owned, and a device
      // without the management token can still manage it as the verified owner.
    }
    const synced = await cloud.save(uid, project, options)
    await local.save(synced)
    return synced
  }

  /** Saves several projects, continuing past individual failures so one bad project can't block the rest. */
  async function saveManyToCloud(uid: string, projects: QRProject[]): Promise<BulkSaveResult> {
    const result: BulkSaveResult = { saved: [], failed: [] }
    for (const project of projects) {
      try {
        await saveToCloud(uid, project)
        result.saved.push(project.id)
      } catch (err) {
        result.failed.push({ id: project.id, reason: err instanceof Error ? err.message : 'Could not save.' })
      }
    }
    return result
  }

  /** Local projects that aren't in the cloud list — candidates for "Save to your account". */
  async function localOnly(cloudProjects: QRProject[]): Promise<QRProject[]> {
    const inCloud = new Set(cloudProjects.map((p) => p.id))
    return (await local.list()).filter((p) => !inCloud.has(p.id))
  }

  /**
   * Makes a cloud project editable on this device by copying it into the
   * on-device buffer. The cloud version wins unless the device holds unsaved
   * edits to an older revision — then the caller must ask the user.
   */
  async function openForEditing(cloudProject: QRProject, options: { useCloud?: boolean } = {}): Promise<OpenResult> {
    const existing = await local.get(cloudProject.id)
    const cloudIsNewer = !existing?.cloud || (cloudProject.cloud?.version ?? 0) > existing.cloud.version
    if (existing && !options.useCloud && cloudIsNewer && hasUnsavedChanges(existing) && existing.cloud) {
      return { kind: 'conflict', local: existing, cloud: cloudProject }
    }
    // Keep an up-to-date, already-synced device copy as is; otherwise take the cloud version.
    if (existing && !options.useCloud && !cloudIsNewer) return { kind: 'ready', project: existing }
    await local.save(cloudProject)
    return { kind: 'ready', project: cloudProject }
  }

  /** A new, independent copy. Not offered for Dynamic QR: a copy would share the original's permanent publicId. */
  async function duplicate(uid: string, project: QRProject): Promise<QRProject> {
    if (project.qrMode === 'dynamic') throw new Error('A Dynamic QR can’t be duplicated — each one has its own permanent link.')
    const now = new Date().toISOString()
    const base = createNewProject()
    const copy: QRProject = {
      ...project,
      id: base.id,
      slug: generateSlug(),
      brand: { ...project.brand, companyName: `${project.brand.companyName || 'Untitled'} (copy)` },
      cloud: undefined,
      createdAt: now,
      updatedAt: now
    }
    return saveToCloud(uid, copy)
  }

  /** Deletes the cloud copy and the on-device cache of it. A Dynamic QR's public link is not disabled by this. */
  async function deleteFromCloud(uid: string, id: string): Promise<void> {
    await cloud.remove(uid, id)
    await local.remove(id)
  }

  return { saveToCloud, saveManyToCloud, localOnly, openForEditing, duplicate, deleteFromCloud }
}

export type LibraryService = ReturnType<typeof createLibraryService>

const dismissedKey = (uid: string) => `smart-qr-studio:migration-dismissed:${uid}`

/** "Skip" on the migration prompt is remembered per account on this device (a convenience, never required). */
export function isMigrationDismissed(uid: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(uid)) === '1'
  } catch {
    return false
  }
}

export function dismissMigration(uid: string): void {
  try {
    localStorage.setItem(dismissedKey(uid), '1')
  } catch {
    // Best-effort only.
  }
}
