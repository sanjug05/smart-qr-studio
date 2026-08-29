import { useEffect, useMemo } from 'react'
import type { QRProject } from '@/types/project'
import LandingView from '@/features/landing/LandingView'
import { buildShareablePayload, payloadToLandingContent } from '@/services/share/sharePayload'
import './LandingPreviewModal.css'

export default function LandingPreviewModal({ project, onClose }: { project: QRProject; onClose: () => void }) {
  // Renders exactly what a real scan will show, not the raw in-progress
  // project — the two can differ (an uploaded logo, a disabled or 6th
  // destination) because the shareable QR payload deliberately excludes
  // anything that isn't in the self-contained link. Showing the raw
  // project here would silently promise a logo the customer will never
  // see. See src/services/share/sharePayload.ts.
  const content = useMemo(() => payloadToLandingContent(buildShareablePayload(project)), [project])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The overlay is a decorative backdrop, not the dialog itself — role="dialog"
  // belongs on the phone panel below. Clicking the backdrop is a pointer-only
  // convenience; keyboard/screen-reader users already have the close button
  // and Escape (registered above), so this doesn't need its own key handler.
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="landing-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="landing-modal-phone" role="dialog" aria-modal="true" aria-label="Customer landing page preview">
        <button className="landing-modal-close btn btn-ghost" onClick={onClose} aria-label="Close preview">
          ✕
        </button>
        <div className="landing-modal-screen">
          <LandingView project={content} />
        </div>
      </div>
    </div>
  )
}
