import { useState } from 'react'
import type { QRProject } from '@/types/project'
import { useVerifiedQr } from '@/hooks/useVerifiedQr'
import { downloadPng, downloadSvg, copyToClipboard } from '@/services/qr/qrExport'
import LandingPreviewModal from './LandingPreviewModal'
import './QRPreviewPanel.css'

export default function QRPreviewPanel({ project, showDownloads }: { project: QRProject; showDownloads: boolean }) {
  const { containerRef, instance, verified, fallbackApplied, message, loading, shareUrl } = useVerifiedQr(project)
  const [showLandingPreview, setShowLandingPreview] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const handleCopy = async (label: string, value: string) => {
    const ok = await copyToClipboard(value)
    setCopyStatus(ok ? `${label} copied.` : `Copy failed — select and copy manually.`)
    window.setTimeout(() => setCopyStatus(null), 2500)
  }

  return (
    <aside className="qr-preview-panel card">
      <div className="qr-preview-canvas-wrap">
        <div ref={containerRef} className="qr-preview-canvas" aria-hidden={loading} />
        {loading ? <div className="qr-preview-loading">Rendering…</div> : null}
      </div>

      <div className="qr-preview-status">
        {loading ? null : verified ? (
          <span className="badge badge-success">✓ Verified scannable</span>
        ) : (
          <span className="badge badge-danger">⚠ Could not verify</span>
        )}
        {fallbackApplied && !loading ? <span className="badge badge-warning">Branding auto-adjusted</span> : null}
      </div>

      {message ? <p className="qr-preview-message">{message}</p> : null}

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="landing-url">Smart QR share link</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="landing-url" className="input" readOnly value={shareUrl} />
          <button className="btn btn-secondary" disabled={!shareUrl} onClick={() => handleCopy('Share link', shareUrl)}>
            Copy
          </button>
        </div>
        <span className="hint">
          This is exactly what the QR encodes — a self-contained link that works on any device, with no dependency on
          this browser.
        </span>
      </div>

      <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8 }} onClick={() => setShowLandingPreview(true)}>
        Preview customer page
      </button>

      {showDownloads ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!instance || loading}
              onClick={() => instance && downloadPng(instance, project.brand.companyName, project.slug)}
            >
              Download PNG
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!instance || loading}
              onClick={() => instance && downloadSvg(instance, project.brand.companyName, project.slug)}
            >
              Download SVG
            </button>
          </div>
          {shareUrl ? (
            <a className="btn btn-secondary" href={shareUrl} target="_blank" rel="noopener noreferrer">
              Open QR link (test)
            </a>
          ) : null}
          <p className="hint">
            PNG/SVG image files don't carry click-through metadata on their own — when placing the QR in a PDF, slide
            deck, or webpage, hyperlink the image to the copied share link above so it's clickable there too.
          </p>
        </div>
      ) : null}

      {copyStatus ? (
        <p role="status" className="hint" style={{ marginTop: 8 }}>
          {copyStatus}
        </p>
      ) : null}

      {showLandingPreview ? <LandingPreviewModal project={project} onClose={() => setShowLandingPreview(false)} /> : null}
    </aside>
  )
}
