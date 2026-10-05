import type { QRProject } from '@/types/project'
import { fromCloudDoc, toCloudDoc, withCloudSync, type CloudProjectDoc } from './cloudProject'

/**
 * The minimal Firestore surface this repository needs. The real adapter
 * (firestoreAdapter.ts) wraps the Firebase SDK; tests supply an in-memory
 * one. Errors must carry Firestore's `code` (e.g. 'permission-denied').
 */
export interface DocStore {
  get(path: string): Promise<unknown | null>
  set(path: string, data: CloudProjectDoc): Promise<void>
  remove(path: string): Promise<void>
  list(collectionPath: string, max: number): Promise<unknown[]>
}

/** Another device saved a newer version of this project than the one this copy is based on. */
export class CloudConflictError extends Error {
  readonly cloudVersion: number
  readonly cloudProject: QRProject | null
  constructor(cloudVersion: number, cloudProject: QRProject | null) {
    super('A newer version of this QR code was saved from another device.')
    this.name = 'CloudConflictError'
    this.cloudVersion = cloudVersion
    this.cloudProject = cloudProject
  }
}

export interface CloudProjectRepository {
  list(uid: string): Promise<QRProject[]>
  get(uid: string, id: string): Promise<QRProject | undefined>
  /**
   * Writes `project` as the next cloud revision. Throws CloudConflictError if
   * the cloud already has a newer revision than the one `project` is based on
   * — unless `force`, which deliberately overwrites it (the user chose to).
   */
  save(uid: string, project: QRProject, options?: { force?: boolean }): Promise<QRProject>
  remove(uid: string, id: string): Promise<void>
}

/** A user's whole library is small; this bounds one read as a cost safeguard, not a product limit anyone should hit. */
export const MAX_LIBRARY_READ = 200

const collectionPath = (uid: string) => `users/${uid}/projects`
const docPath = (uid: string, id: string) => `${collectionPath(uid)}/${id}`

const errorCode = (err: unknown): string => (err as { code?: string })?.code ?? ''

export function createCloudProjectRepository(store: DocStore): CloudProjectRepository {
  return {
    async list(uid) {
      const raw = await store.list(collectionPath(uid), MAX_LIBRARY_READ)
      return raw
        .map(fromCloudDoc)
        .filter((p): p is QRProject => p !== null)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    },

    async get(uid, id) {
      const raw = await store.get(docPath(uid, id))
      return raw ? (fromCloudDoc(raw) ?? undefined) : undefined
    },

    async save(uid, project, options = {}) {
      const path = docPath(uid, project.id)
      const nextVersion = (project.cloud?.version ?? 0) + 1
      try {
        await store.set(path, toCloudDoc(project, nextVersion))
        return withCloudSync(project, nextVersion)
      } catch (err) {
        if (errorCode(err) !== 'permission-denied') throw err

        // The rules only accept "exactly the next version", so a rejection here is either a stale
        // revision (a conflict we can describe) or a genuine denial/validation failure (rethrown).
        const currentRaw = await store.get(path)
        const current = currentRaw ? fromCloudDoc(currentRaw) : null
        if (!current?.cloud) throw err

        if (!options.force) throw new CloudConflictError(current.cloud.version, current)
        const forcedVersion = current.cloud.version + 1
        await store.set(path, toCloudDoc(project, forcedVersion))
        return withCloudSync(project, forcedVersion)
      }
    },

    async remove(uid, id) {
      await store.remove(docPath(uid, id))
    }
  }
}
