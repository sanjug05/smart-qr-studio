import { useState } from 'react'
import type { QRProject } from '@/types/project'
import { useVerifiedQr } from '@/hooks/useVerifiedQr'
import { downloadPng, downloadSvg, downloadClickableQrHtml, copyToClipboard } from '@/services/qr/qrExport'
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

  const qrIsReady = Boolean(shareUrl) && !loading

  return (
    <aside className="qr-preview-panel card">
      {/*
        Always an <a>, never conditionally a <div>/<a> swap: keeping the
        element type stable across renders means containerRef's node is
        never remounted, so the QR that useVerifiedQr just appended into it
        doesn't get wiped out the instant `shareUrl` changes. Only href
        (and therefore whether it's a real, focusable link at all) toggles.
      */}
      <a
        className="qr-preview-canvas-wrap qr-preview-canvas-link"
        href={qrIsReady ? shareUrl : undefined}
        target={qrIsReady ? '_blank' : undefined}
        rel={qrIsReady ? 'noopener noreferrer' : undefined}
        aria-label={qrIsReady ? `Open the Smart QR link${project.brand.companyName ? ` for ${project.brand.companyName}` : ''}` : undefined}
        onClick={(e) => {
          if (!qrIsReady) e.preventDefault()
        }}
      >
        <div ref={containerRef} className="qr-preview-canvas" aria-hidden={loading} />
        {loading ? <div className="qr-preview-loading">Rendering…</div> : null}
      </a>
      {qrIsReady ? <p className="hint qr-preview-click-hint">Tap the QR to open its link.</p> : null}

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
        <div className="qr-export-groups">
          <div className="qr-export-group">
            <h3 className="qr-export-group-title">Physical / Print</h3>
            <p className="hint">For printing, laminating, or anywhere someone will scan it with a camera.</p>
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
                onClick={() => instance && downloadSvg(instance, project.brand.companyName, project.slug, shareUrl)}
              >
                Download SVG
              </button>
            </div>
          </div>

          <div className="qr-export-group">
            <h3 className="qr-export-group-title">Digital / Clickable</h3>
            <p className="hint">For screens, slides, documents, and messages — somewhere a tap should work too.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary"
                disabled={!instance || loading}
                onClick={() => instance && downloadClickableQrHtml(instance, project.brand, project.slug, shareUrl)}
              >
                Create Clickable QR
              </button>
              <button className="btn btn-secondary" disabled={!shareUrl} onClick={() => handleCopy('QR link', shareUrl)}>
                Copy QR Link
              </button>
              {qrIsReady ? (
                <a className="btn btn-ghost" href={shareUrl} target="_blank" rel="noopener noreferrer">
                  Open QR link (test)
                </a>
              ) : null}
            </div>
          </div>

          <p className="hint qr-export-explainer">
            Scan it when it's printed. Click it when it's on a screen — the QR above, and any downloaded PNG or SVG,
            can be scanned with a phone camera. To make it tappable somewhere digital, use "Create Clickable QR" for
            a standalone file, or add the copied link as the hyperlink behind the QR image in PowerPoint, a PDF, or a
            webpage. For messaging apps, share the image for scanning, or share the link directly for one-tap access
            — a plain PNG or JPG can't carry a working link on its own.
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
