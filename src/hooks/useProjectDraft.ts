import { useEffect, useRef, useState } from 'react'
import type { BrandConfig, Destination, QRProject, QRStyleConfig } from '@/types/project'
import { createNewProject } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'

/**
 * Loads (or creates) a project for the builder wizard and autosaves it to
 * the repository on every change, debounced. This means leaving the
 * wizard mid-flow — closing the tab, hitting back — never loses work; it
 * simply shows up as an in-progress entry in "My QR Codes".
 */
export function useProjectDraft(id?: string) {
  const [project, setProject] = useState<QRProject | null>(null)
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<number>()
  // A brand-new project (no :id) is only worth persisting once the user
  // actually touches something — otherwise every visit to /create, including
  // an accidental one, would litter "My QR Codes" with blank entries.
  const dirtyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    dirtyRef.current = Boolean(id)

    async function load() {
      if (id) {
        const existing = await projectRepository.get(id)
        if (!cancelled) {
          setProject(existing ?? createNewProject())
          setReady(true)
        }
        return
      }
      const fresh = createNewProject()
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
    saveTimer.current = window.setTimeout(() => {
      projectRepository.save({ ...project, updatedAt: new Date().toISOString() })
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

  return { project, ready, updateBrand, updateDestinations, updateDestination, updateQrStyle }
}
