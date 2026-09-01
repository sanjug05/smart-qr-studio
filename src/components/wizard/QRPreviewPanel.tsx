import { useState } from 'react'
import type { QRProject, QrDesignConfig, QrDesignTemplateId } from '@/types/project'
import { createDefaultDesignConfig } from '@/types/project'
import { useVerifiedQr } from '@/hooks/useVerifiedQr'
import { downloadDesignedQrPng, downloadDesignedQrSvg, openDigitalQr, copyToClipboard } from '@/services/qr/qrExport'
import { DESIGN_TEMPLATE_OPTIONS } from '@/services/qr/designTemplates'
import DesignedQrPreview from './DesignedQrPreview'
import LandingPreviewModal from './LandingPreviewModal'
import './QRPreviewPanel.css'

export default function QRPreviewPanel({
  project,
  showDownloads,
  onChangeDesign
}: {
  project: QRProject
  showDownloads: boolean
  onChangeDesign: (patch: Partial<QrDesignConfig>) => void
}) {
  const { containerRef, instance, verified, fallbackApplied, message, loading, shareUrl } = useVerifiedQr(project)
  const [showLandingPreview, setShowLandingPreview] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const designConfig = project.designConfig ?? createDefaultDesignConfig()

  const handleCopy = async (label: string, value: string) => {
    const ok = await copyToClipboard(value)
    setCopyStatus(ok ? `${label} copied.` : `Copy failed — select and copy manually.`)
    window.setTimeout(() => setCopyStatus(null), 2500)
  }

  const runExport = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  const qrIsReady = Boolean(shareUrl) && !loading

  return (
    <aside className="qr-preview-panel card">
      {/*
        The bare, unbranded QR still has to live in a real DOM node for
        qr-code-styling to render into and for useVerifiedQr's jsQR check to
        read back — it's just no longer what the user looks at. The
        composed poster (DesignedQrPreview) is the primary visual now; this
        container is positioned off-screen, not display:none, so nothing
        about how the library generates or measures the SVG changes.
      */}
      <div ref={containerRef} className="qr-preview-hidden-source" aria-hidden="true" />

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
        {loading ? <div className="qr-preview-loading">Rendering…</div> : <DesignedQrPreview instance={instance} brand={project.brand} designConfig={designConfig} />}
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

      <fieldset className="field qr-design-fieldset">
        <legend>QR Style</legend>
        <div className="qr-design-template-options">
          {DESIGN_TEMPLATE_OPTIONS.map((opt) => {
            const inputId = `design-template-${opt.id}`
            return (
              <label key={opt.id} htmlFor={inputId} className="qr-design-template-option">
                <input
                  id={inputId}
                  type="radio"
                  name="design-template"
                  aria-label={opt.label}
                  checked={designConfig.template === opt.id}
                  onChange={() => onChangeDesign({ template: opt.id as QrDesignTemplateId })}
                />
                <span>
                  <span className="qr-design-template-label">{opt.label}</span>
                  <span className="hint">{opt.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="design-headline">Headline</label>
        <input
          id="design-headline"
          className="input"
          value={designConfig.headline}
          maxLength={40}
          placeholder="Scan to Explore"
          onChange={(e) => onChangeDesign({ headline: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="design-cta">Scan instruction</label>
        <input
          id="design-cta"
          className="input"
          value={designConfig.ctaText}
          maxLength={40}
          placeholder="Scan to explore"
          onChange={(e) => onChangeDesign({ ctaText: e.target.value })}
        />
        <span className="hint">Shown under the QR. Leave either field as-is if you don't want to customize it.</span>
      </div>

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
            <h3 className="qr-export-group-title">Download Designed QR</h3>
            <p className="hint">Professional QR artwork with your branding, headline, and scan instruction.</p>
            <div className="qr-export-btn-row">
              <button
                className="btn btn-primary export-btn"
                disabled={!instance || loading || busy !== null}
                onClick={() => instance && runExport('png', () => downloadDesignedQrPng(instance, project.brand, designConfig, project.slug))}
              >
                <span>{busy === 'png' ? 'Preparing…' : 'PNG'}</span>
                <span className="export-btn-hint">Best for sharing &amp; printing</span>
              </button>
              <button
                className="btn btn-primary export-btn"
                disabled={!instance || loading || busy !== null}
                onClick={() => instance && runExport('svg', () => downloadDesignedQrSvg(instance, project.brand, designConfig, project.slug, shareUrl))}
              >
                <span>{busy === 'svg' ? 'Preparing…' : 'SVG'}</span>
                <span className="export-btn-hint">Best for print &amp; design</span>
              </button>
            </div>
          </div>

          <div className="qr-export-group">
            <h3 className="qr-export-group-title">Digital / Clickable</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary export-btn"
                disabled={!instance || loading || busy !== null}
                onClick={() => instance && runExport('digital', () => openDigitalQr(instance, project.brand, designConfig, shareUrl))}
              >
                <span>{busy === 'digital' ? 'Preparing…' : 'Open Digital QR'}</span>
                <span className="export-btn-hint">Clickable version for digital use</span>
              </button>
              <button className="btn btn-secondary" disabled={!shareUrl} onClick={() => handleCopy('QR link', shareUrl)}>
                Copy QR Link
              </button>
            </div>
          </div>

          <p className="hint qr-export-explainer">
            Scan it when it's printed. Click it when it's on a screen. SVG is best for print &amp; design software —
            some phones don't open SVG files directly, so on mobile use "Open Digital QR" or the PNG instead. For
            PowerPoint, PDFs, or a webpage, add the copied link as the hyperlink behind the QR image. For messaging
            apps, share the image for scanning, or share the link directly for one-tap access.
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
