import { useCallback, useState } from 'react'
import type { CloudSyncInfo, QRProject } from '@/types/project'
import { CloudConflictError, DynamicQrOwnedByOtherError, hasUnsavedChanges, libraryService } from '@/services/cloud'
import { useAuth } from './useAuth'

export type CloudSaveStatus = 'signedOut' | 'notSaved' | 'unsaved' | 'saved'

function describeSaveError(err: unknown): string {
  if (err instanceof DynamicQrOwnedByOtherError) return err.message
  const code = (err as { code?: string })?.code
  if (code === 'permission-denied') return 'Your account couldn’t save this QR code. Please sign in again and retry.'
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Couldn’t reach the cloud. Check your connection and try again.'
  return 'Couldn’t save to your account. Please try again.'
}

/**
 * Explicit "save to my account" for the wizard. Cloud writes happen only when
 * this is called (Save button, Save & exit, Done) — never per keystroke.
 */
export function useCloudSave(project: QRProject | null, applySync: (cloud: CloudSyncInfo) => void, replaceProject: (p: QRProject) => void) {
  const { user, status } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ cloud: QRProject } | null>(null)

  const dynamicPending = Boolean(project && project.qrMode === 'dynamic' && !project.dynamicQr?.publicId)

  let saveStatus: CloudSaveStatus = 'signedOut'
  if (user && project) saveStatus = !project.cloud ? 'notSaved' : hasUnsavedChanges(project) ? 'unsaved' : 'saved'

  /** Returns true when the project is safely in the cloud afterwards (or there was nothing to save). */
  const save = useCallback(
    async (options: { force?: boolean } = {}): Promise<boolean> => {
      if (!user || !project) return true
      if (project.cloud && !hasUnsavedChanges(project) && !options.force) return true
      if (project.qrMode === 'dynamic' && !project.dynamicQr?.publicId) {
        setError('Your Dynamic QR is still being created — try again in a moment.')
        return false
      }
      setSaving(true)
      setError(null)
      setConflict(null)
      try {
        const synced = await libraryService.saveToCloud(user.uid, project, options)
        if (synced.cloud) applySync(synced.cloud)
        return true
      } catch (err) {
        if (err instanceof CloudConflictError && err.cloudProject) setConflict({ cloud: err.cloudProject })
        else setError(describeSaveError(err))
        return false
      } finally {
        setSaving(false)
      }
    },
    [user, project, applySync]
  )

  /** Discards this device's edits and takes the newer cloud version. */
  const useCloudVersion = useCallback(async () => {
    if (!conflict) return
    const opened = await libraryService.openForEditing(conflict.cloud, { useCloud: true })
    if (opened.kind === 'ready') replaceProject(opened.project)
    setConflict(null)
  }, [conflict, replaceProject])

  return {
    signedIn: status === 'signedIn',
    saveStatus,
    saving,
    error,
    conflict,
    dynamicPending,
    save,
    useCloudVersion,
    overwriteCloud: () => save({ force: true }),
    dismissConflict: () => setConflict(null)
  }
}
