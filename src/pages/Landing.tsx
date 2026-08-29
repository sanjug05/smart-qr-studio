import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { LandingContent } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'
import { isShareToken, stripShareTokenPrefix } from '@/services/share/shareLinkService'
import { decodeSharePayload, payloadToLandingContent } from '@/services/share/sharePayload'
import LandingView from '@/features/landing/LandingView'

type LoadState =
  | { status: 'loading' }
  | { status: 'found'; content: LandingContent }
  | { status: 'not-found' }
  | { status: 'invalid' }

/**
 * Resolution order, in priority: a self-contained share token (see
 * shareLinkService.ts) is decoded directly, entirely client-side, with no
 * dependency on this device ever having seen the creator's data — that's
 * the whole point of the format. A plain legacy slug (QR codes generated
 * before this format existed) falls back to the old localStorage lookup,
 * which only ever resolves on the creator's own browser. localStorage is
 * never consulted for the new format; it isn't a fallback path here, it's
 * simply the wrong branch for that token shape.
 */
export default function Landing() {
  const { slug: token } = useParams<{ slug: string }>()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    if (!token) {
      setState({ status: 'invalid' })
      return
    }

    if (isShareToken(token)) {
      const payload = decodeSharePayload(stripShareTokenPrefix(token))
      setState(payload ? { status: 'found', content: payloadToLandingContent(payload) } : { status: 'invalid' })
      return
    }

    projectRepository.getBySlug(token).then((project) => {
      if (cancelled) return
      setState(project ? { status: 'found', content: project } : { status: 'not-found' })
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (state.status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }} role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (state.status === 'invalid') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>Invalid QR code</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 360 }}>
          This link's data couldn't be read — it may be damaged, truncated, or not a Smart QR Studio code at all.
        </p>
      </div>
    )
  }

  if (state.status === 'not-found') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>QR code not found</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 360 }}>
          This is an older-style link tied to its creator's browser, and this device isn't that browser. Codes
          generated now are self-contained and work on any device — this specific one predates that.
        </p>
      </div>
    )
  }

  return <LandingView project={state.content} />
}
