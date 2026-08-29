import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { QRProject } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'
import LandingView from '@/features/landing/LandingView'

type LoadState = { status: 'loading' } | { status: 'found'; project: QRProject } | { status: 'not-found' }

export default function Landing() {
  const { slug } = useParams<{ slug: string }>()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    if (!slug) {
      setState({ status: 'not-found' })
      return
    }
    projectRepository.getBySlug(slug).then((project) => {
      if (cancelled) return
      setState(project ? { status: 'found', project } : { status: 'not-found' })
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (state.status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }} role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (state.status === 'not-found') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>QR code not found</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 360 }}>
          This link isn't recognized on this device. Smart QR Studio currently stores projects locally in the
          creator's browser — if this code was created on a different device, it won't resolve here yet.
        </p>
      </div>
    )
  }

  return <LandingView project={state.project} />
}
