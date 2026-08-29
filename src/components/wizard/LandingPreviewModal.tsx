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

  return (
    <div className="landing-modal-overlay" role="dialog" aria-modal="true" aria-label="Customer landing page preview" onClick={onClose}>
      <div className="landing-modal-phone" onClick={(e) => e.stopPropagation()}>
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
