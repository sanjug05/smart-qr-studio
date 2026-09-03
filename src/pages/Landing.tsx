import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { LandingContent } from '@/types/project'
import { projectRepository } from '@/services/storage/projectRepository'
import { isShareToken, stripShareTokenPrefix, isDynamicShareToken, stripDynamicShareTokenPrefix } from '@/services/share/shareLinkService'
import { decodeSharePayload, payloadToLandingContent } from '@/services/share/sharePayload'
import { dynamicQrService } from '@/services/dynamicQr'
import LandingView from '@/features/landing/LandingView'

type LoadState =
  | { status: 'loading' }
  | { status: 'found'; content: LandingContent }
  | { status: 'not-found'; reason: 'legacy-slug' | 'dynamic' }
  | { status: 'invalid' }
  | { status: 'disabled' }
  | { status: 'offline' }

/**
 * Resolution order, in priority:
 *  1. A self-contained share token (`p.`, see shareLinkService.ts) is
 *     decoded directly, entirely client-side, with no dependency on this
 *     device ever having seen the creator's data — that's the whole point
 *     of the format.
 *  2. A Dynamic QR token (`d.`) carries no content of its own — only a
 *     permanent publicId — so it's resolved by asking the backend for the
 *     currently published content (see src/services/dynamicQr). Both this
 *     and the static path above converge on the same `LandingContent` →
 *     `LandingView` rendering below; there is exactly one landing-page
 *     implementation.
 *  3. A plain legacy slug (QR codes generated before either format
 *     existed) falls back to the old localStorage lookup, which only ever
 *     resolves on the creator's own browser. localStorage is never
 *     consulted for the other two formats; it isn't a fallback path for
 *     them, it's simply the wrong branch for those token shapes.
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

    if (isDynamicShareToken(token)) {
      const publicId = stripDynamicShareTokenPrefix(token)
      dynamicQrService.resolve(publicId).then((result) => {
        if (cancelled) return
        if (result.status === 'active') setState({ status: 'found', content: result.content })
        else if (result.status === 'disabled') setState({ status: 'disabled' })
        else if (result.status === 'not-found') setState({ status: 'not-found', reason: 'dynamic' })
        // A network/API failure must never be presented as "Invalid QR" —
        // the QR itself is fine, it just couldn't be reached right now.
        else setState({ status: 'offline' })
      })
      return () => {
        cancelled = true
      }
    }

    projectRepository.getBySlug(token).then((project) => {
      if (cancelled) return
      setState(project ? { status: 'found', content: project } : { status: 'not-found', reason: 'legacy-slug' })
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
          {state.reason === 'dynamic'
            ? "This QR code doesn't match any known Smart QR Studio code."
            : "This is an older-style link tied to its creator's browser, and this device isn't that browser. Codes generated now are self-contained and work on any device — this specific one predates that."}
        </p>
      </div>
    )
  }

  if (state.status === 'disabled') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>QR code unavailable</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 360 }}>This QR code has been turned off by its owner.</p>
      </div>
    )
  }

  if (state.status === 'offline') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>Connection required</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 360 }}>
          An internet connection is required for this QR. Please check your connection and try scanning again.
        </p>
      </div>
    )
  }

  return <LandingView project={state.content} />
}
