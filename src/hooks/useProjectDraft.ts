import { useEffect, useRef, useState } from 'react'
import type { BrandConfig, Destination, QRProject, QRStyleConfig, QrDesignConfig } from '@/types/project'
import { createDefaultDesignConfig } from '@/types/project'
import { projectRepository, createUniqueProject } from '@/services/storage/projectRepository'

/**
 * Loads (or creates) a project for the builder wizard and autosaves it to
 * the repository on every change, debounced. This means leaving the
 * wizard mid-flow — closing the tab, hitting back — never loses work; it
 * simply shows up as an in-progress entry in "My QR Codes".
 */
export function useProjectDraft(id?: string) {
  const [project, setProject] = useState<QRProject | null>(null)
  const [ready, setReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimer = useRef<number>()
  // A brand-new project (no :id) is only worth persisting once the user
  // actually touches something — otherwise every visit to /create, including
  // an accidental one, would litter "My QR Codes" with blank entries.
  const dirtyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setSaveError(null)
    dirtyRef.current = Boolean(id)

    async function load() {
      if (id) {
        const existing = await projectRepository.get(id)
        const fallback = existing ?? (await createUniqueProject())
        if (!cancelled) {
          setProject(fallback)
          setReady(true)
        }
        return
      }
      const fresh = await createUniqueProject()
      if (!cancelled) {
        setProject(fresh)
        setReady(true)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!project || !dirtyRef.current) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        await projectRepository.save({ ...project, updatedAt: new Date().toISOString() })
        setSaveError(null)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save this project.')
      }
    }, 300)
    return () => window.clearTimeout(saveTimer.current)
  }, [project])

  function markDirtyAndSet(updater: (p: QRProject) => QRProject) {
    dirtyRef.current = true
    setProject((p) => (p ? updater(p) : p))
  }

  function updateBrand(patch: Partial<BrandConfig>) {
    markDirtyAndSet((p) => ({ ...p, brand: { ...p.brand, ...patch } }))
  }

  function updateDestinations(destinations: Destination[]) {
    markDirtyAndSet((p) => ({ ...p, destinations }))
  }

  function updateDestination(id: string, patch: Partial<Destination>) {
    markDirtyAndSet((p) => ({ ...p, destinations: p.destinations.map((d) => (d.id === id ? { ...d, ...patch } : d)) }))
  }

  function updateQrStyle(patch: Partial<QRStyleConfig>) {
    markDirtyAndSet((p) => ({ ...p, qrStyle: { ...p.qrStyle, ...patch } }))
  }

  // `designConfig` is optional on QRProject (older saved projects predate
  // this feature) — default it here so callers never have to null-check.
  function updateDesignConfig(patch: Partial<QrDesignConfig>) {
    markDirtyAndSet((p) => ({ ...p, designConfig: { ...(p.designConfig ?? createDefaultDesignConfig()), ...patch } }))
  }

  return { project, ready, saveError, updateBrand, updateDestinations, updateDestination, updateQrStyle, updateDesignConfig }
}
