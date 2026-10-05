import { useCallback, useEffect, useState } from 'react'
import type { QRProject } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'
import { cloudProjectRepository, libraryService, dismissMigration, isMigrationDismissed } from '@/services/cloud'
import type { BulkSaveResult } from '@/services/cloud'
import { useAuth } from './useAuth'

/**
 * Everything the "My QR Codes" page needs. Signed out: the on-device list as
 * before. Signed in: the cloud library (one read per load — no listeners, no
 * polling; use `refresh` to pick up changes from another device) plus the
 * projects that exist only on this device.
 */
export function useLibrary() {
  const { user, status } = useAuth()
  const uid = user?.uid ?? null

  const [local, setLocal] = useState<QRProject[]>([])
  const [cloud, setCloud] = useState<QRProject[]>([])
  const [localOnly, setLocalOnly] = useState<QRProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [migrationDismissed, setMigrationDismissed] = useState(false)

  const refresh = useCallback(async () => {
    if (status === 'loading') return
    setLoading(true)
    setError(null)
    try {
      const localList = await projectRepository.list()
      setLocal(localList)
      if (uid) {
        const cloudList = await cloudProjectRepository.list(uid)
        setCloud(cloudList)
        setLocalOnly(await libraryService.localOnly(cloudList))
        setMigrationDismissed(isMigrationDismissed(uid))
      } else {
        setCloud([])
        setLocalOnly([])
      }
    } catch {
      setError('Couldn’t load your QR codes from your account. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [uid, status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveToCloud = useCallback(
    async (projects: QRProject[]): Promise<BulkSaveResult> => {
      if (!uid) return { saved: [], failed: projects.map((p) => ({ id: p.id, reason: 'Not signed in.' })) }
      const result = await libraryService.saveManyToCloud(uid, projects)
      await refresh()
      return result
    },
    [uid, refresh]
  )

  const removeLocal = useCallback(
    async (id: string) => {
      await projectRepository.remove(id)
      await refresh()
    },
    [refresh]
  )

  const removeCloud = useCallback(
    async (id: string) => {
      if (!uid) return
      await libraryService.deleteFromCloud(uid, id)
      await refresh()
    },
    [uid, refresh]
  )

  const duplicate = useCallback(
    async (project: QRProject) => {
      if (!uid) return
      await libraryService.duplicate(uid, project)
      await refresh()
    },
    [uid, refresh]
  )

  const skipMigration = useCallback(() => {
    if (!uid) return
    dismissMigration(uid)
    setMigrationDismissed(true)
  }, [uid])

  return { status, user, local, cloud, localOnly, loading, error, migrationDismissed, refresh, saveToCloud, removeLocal, removeCloud, duplicate, skipMigration }
}
