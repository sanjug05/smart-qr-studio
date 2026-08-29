import { useEffect } from 'react'
import type { QRProject } from '@/types/project'
import LandingView from '@/features/landing/LandingView'
import './LandingPreviewModal.css'

export default function LandingPreviewModal({ project, onClose }: { project: QRProject; onClose: () => void }) {
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
          <LandingView project={project} />
        </div>
      </div>
    </div>
  )
}
