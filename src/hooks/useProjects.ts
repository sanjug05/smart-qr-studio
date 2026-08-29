import { useCallback, useEffect, useState } from 'react'
import type { QRProject } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'

export function useProjects() {
  const [projects, setProjects] = useState<QRProject[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    projectRepository.list().then((list) => {
      setProjects(list)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = useCallback(
    async (id: string) => {
      await projectRepository.remove(id)
      refresh()
    },
    [refresh]
  )

  return { projects, loading, refresh, remove }
}
