import { useRef, useState } from 'react'
import type { DynamicQrInfo, QRProject, QrDesignConfig, QrDesignTemplateId } from '@/types/project'
import { createDefaultDesignConfig } from '@/types/project'
import { useVerifiedQr } from '@/hooks/useVerifiedQr'
import { useDynamicQr } from '@/hooks/useDynamicQr'
import {
  downloadDesignedQrPng,
  downloadDesignedQrSvg,
  downloadQrOnlyPng,
  downloadQrOnlySvg,
  copyEmailQrBlock,
  openDigitalQr,
  downloadDigitalQrHtml,
  copyToClipboard
} from '@/services/qr/qrExport'
import { DESIGN_TEMPLATE_OPTIONS } from '@/services/qr/designTemplates'
import DesignedQrPreview from './DesignedQrPreview'
import LandingPreviewModal from './LandingPreviewModal'
import './QRPreviewPanel.css'

export default function QRPreviewPanel({
  project,
  showDownloads,
  onChangeDesign,
  onDynamicQrCreated
}: {
  project: QRProject
  showDownloads: boolean
  onChangeDesign: (patch: Partial<QrDesignConfig>) => void
  onDynamicQrCreated: (info: DynamicQrInfo) => void
}) {
  const { containerRef, instance, verified, fallbackApplied, message, loading, shareUrl, notProvisioned } = useVerifiedQr(project)
  const isDynamic = project.qrMode === 'dynamic'
  const dynamicQr = useDynamicQr(project, onDynamicQrCreated)
  const [showLandingPreview, setShowLandingPreview] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // HTML source shown for manual copying only when every clipboard route failed.
  const [manualEmailHtml, setManualEmailHtml] = useState<string | null>(null)

  const designConfig = project.designConfig ?? createDefaultDesignConfig()

  // One timer at a time: a newer message must not be wiped early by an older message's timeout.
  const statusTimer = useRef<number>()
  const showStatus = (message: string, ms = 3000) => {
    window.clearTimeout(statusTimer.current)
    setCopyStatus(message)
    statusTimer.current = window.setTimeout(() => setCopyStatus(null), ms)
  }

  const handleCopy = async (label: string, value: string) => {
    const ok = await copyToClipboard(value)
    showStatus(ok ? `${label} copied.` : `Copy failed — select and copy manually.`, 2500)
  }

  const runExport = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    try {
      await action()
    } catch (err) {
      showStatus(err instanceof Error && err.message ? `Export failed — ${err.message}` : 'Export failed. Please try again.', 5000)
    } finally {
      setBusy(null)
    }
  }

  const handleCopyForEmail = async () => {
    if (!instance) return
    setManualEmailHtml(null)
    setBusy('email')
    try {
      const outcome = await copyEmailQrBlock(instance, project.brand, designConfig, shareUrl)
      if (outcome.method === 'failed') {
        setManualEmailHtml(outcome.html)
        showStatus('Couldn’t reach the clipboard — copy the HTML below manually.', 7000)
      } else if (outcome.method === 'source-text') {
        showStatus('Copied as HTML source — this browser can’t copy rich content. Paste it into an editor with an HTML/source view.', 7000)
      } else {
        showStatus('Email QR copied')
      }
    } catch (err) {
      showStatus(err instanceof Error && err.message ? `Couldn’t prepare the email block — ${err.message}` : 'Couldn’t prepare the email block.', 5000)
    } finally {
      setBusy(null)
    }
  }

  const qrIsReady = Boolean(shareUrl) && !loading
  const isProvisioningDynamicQr = isDynamic && (notProvisioned || dynamicQr.provisioning)

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
        {isProvisioningDynamicQr ? (
          <div className="qr-preview-loading" role="status">
            Creating your Dynamic QR…
          </div>
        ) : loading ? (
          <div className="qr-preview-loading">Rendering…</div>
        ) : (
          <DesignedQrPreview instance={instance} brand={project.brand} designConfig={designConfig} />
        )}
      </a>
      {qrIsReady ? <p className="hint qr-preview-click-hint">Tap the QR to open its link.</p> : null}

      {isDynamic ? (
        <div className="qr-preview-status">
          <span className="badge badge-accent">Dynamic QR</span>
          {project.dynamicQr?.publicId ? <span className="hint">ID: {project.dynamicQr.publicId}</span> : null}
        </div>
      ) : null}

      {dynamicQr.error ? <p className="qr-preview-message">{dynamicQr.error}</p> : null}

      {isDynamic && project.dynamicQr?.publicId ? (
        <div className="field" style={{ marginBottom: 12 }}>
          <button className="btn btn-secondary" style={{ width: '100%' }} disabled={dynamicQr.publishing} onClick={() => dynamicQr.publish()}>
            {dynamicQr.publishing ? 'Publishing…' : 'Publish changes'}
          </button>
          <span className="hint">
            The printed QR never changes. Publishing updates what it resolves to — the next scan sees these
            destinations.
          </span>
          <span className="hint">Your management access is stored on this device. Account-based QR management will be added later.</span>
          {dynamicQr.publishedVersion !== null && !dynamicQr.publishing && !dynamicQr.error ? (
            <span className="hint" role="status">
              Published (version {dynamicQr.publishedVersion}).
            </span>
          ) : null}
        </div>
      ) : null}

      {!isProvisioningDynamicQr ? (
        <div className="qr-preview-status">
          {loading ? null : verified ? (
            <span className="badge badge-success">✓ Verified scannable</span>
          ) : (
            <span className="badge badge-danger">⚠ Could not verify</span>
          )}
          {fallbackApplied && !loading ? <span className="badge badge-warning">Branding auto-adjusted</span> : null}
        </div>
      ) : null}

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
          {/* On the Preview step the share list below has the Copy Link action. */}
          {!showDownloads ? (
            <button className="btn btn-secondary" disabled={!shareUrl} onClick={() => handleCopy('Share link', shareUrl)}>
              Copy
            </button>
          ) : null}
        </div>
        <span className="hint">
          {isDynamic
            ? 'This permanent link is exactly what the QR encodes. The destinations behind it can be updated anytime — the link never changes.'
            : 'This is exactly what the QR encodes — a self-contained link that works on any device, with no dependency on this browser.'}
        </span>
      </div>

      <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8 }} onClick={() => setShowLandingPreview(true)}>
        Preview customer page
      </button>

      {showDownloads ? (
        <section className="qr-share" aria-labelledby="qr-share-heading">
          <h3 id="qr-share-heading" className="qr-share-title">
            Share &amp; download
          </h3>
          <ul className="qr-share-list">
            <li className="qr-share-item">
              <div className="qr-share-item-text">
                <span className="qr-share-item-name">Download QR</span>
                <span className="hint">QR only · PNG / SVG</span>
              </div>
              <div className="qr-share-item-actions" role="group" aria-label="Download QR only">
                <button
                  className="btn btn-primary"
                  disabled={!instance || loading || busy !== null}
                  aria-label="Download QR only as PNG"
                  onClick={() =>
                    instance && runExport('qr-png', () => downloadQrOnlyPng(instance, project.brand.companyName, project.slug, { transparent: project.qrStyle.transparentBackground }))
                  }
                >
                  {busy === 'qr-png' ? 'Preparing…' : 'PNG'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!instance || loading || busy !== null}
                  aria-label="Download QR only as SVG"
                  onClick={() => instance && runExport('qr-svg', () => downloadQrOnlySvg(instance, project.brand.companyName, project.slug, shareUrl))}
                >
                  {busy === 'qr-svg' ? 'Preparing…' : 'SVG'}
                </button>
              </div>
            </li>

            <li className="qr-share-item">
              <div className="qr-share-item-text">
                <span className="qr-share-item-name">Download Smart QR</span>
                <span className="hint">Branded design · PNG / SVG</span>
              </div>
              <div className="qr-share-item-actions" role="group" aria-label="Download Smart QR, the branded design">
                <button
                  className="btn btn-primary"
                  disabled={!instance || loading || busy !== null}
                  aria-label="Download Smart QR as PNG"
                  onClick={() => instance && runExport('smart-png', () => downloadDesignedQrPng(instance, project.brand, designConfig, project.slug))}
                >
                  {busy === 'smart-png' ? 'Preparing…' : 'PNG'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!instance || loading || busy !== null}
                  aria-label="Download Smart QR as SVG"
                  onClick={() => instance && runExport('smart-svg', () => downloadDesignedQrSvg(instance, project.brand, designConfig, project.slug, shareUrl))}
                >
                  {busy === 'smart-svg' ? 'Preparing…' : 'SVG'}
                </button>
              </div>
            </li>

            <li className="qr-share-item">
              <div className="qr-share-item-text">
                <span className="qr-share-item-name">Copy for Email</span>
                <span className="hint">Clickable QR + message</span>
              </div>
              <div className="qr-share-item-actions">
                <button className="btn btn-secondary" disabled={!instance || loading || busy !== null} onClick={handleCopyForEmail}>
                  {busy === 'email' ? 'Preparing…' : 'Copy'}
                </button>
              </div>
            </li>

            <li className="qr-share-item">
              <div className="qr-share-item-text">
                <span className="qr-share-item-name">Download Digital QR</span>
                <span className="hint">Self-contained clickable HTML</span>
              </div>
              <div className="qr-share-item-actions" role="group" aria-label="Digital QR">
                <button
                  className="btn btn-secondary"
                  disabled={!instance || loading || busy !== null}
                  onClick={() => instance && runExport('digital-download', () => downloadDigitalQrHtml(instance, project.brand, designConfig, shareUrl))}
                >
                  {busy === 'digital-download' ? 'Preparing…' : 'Download'}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!instance || loading || busy !== null}
                  aria-label="Open Digital QR in your browser"
                  onClick={() => instance && runExport('digital-open', () => openDigitalQr(instance, project.brand, designConfig, shareUrl))}
                >
                  {busy === 'digital-open' ? 'Opening…' : 'Open'}
                </button>
              </div>
            </li>

            <li className="qr-share-item">
              <div className="qr-share-item-text">
                <span className="qr-share-item-name">Copy Link</span>
                <span className="hint">Copy QR URL</span>
              </div>
              <div className="qr-share-item-actions">
                <button className="btn btn-secondary" disabled={!shareUrl} onClick={() => handleCopy('QR link', shareUrl)}>
                  Copy
                </button>
              </div>
            </li>
          </ul>

          <p className="hint qr-share-explainer">
            <strong>Download QR</strong> is just the code — drop it into slides or documents. <strong>Download Smart QR</strong> adds your
            branding for print. A picture can't hold a link, so <strong>Copy for Email</strong> pastes a clickable block instead. SVG is best
            for print &amp; design; on a phone, the PNG or Digital QR is easier.
          </p>
        </section>
      ) : null}

      {copyStatus ? (
        <p role="status" className="hint qr-share-status">
          {copyStatus}
        </p>
      ) : null}

      {manualEmailHtml ? (
        <div className="field">
          <label htmlFor="email-html-manual">Email block (HTML)</label>
          <textarea id="email-html-manual" className="input" readOnly rows={5} value={manualEmailHtml} onFocus={(e) => e.currentTarget.select()} />
          <span className="hint">Select all and copy, then paste into an email editor that accepts HTML.</span>
        </div>
      ) : null}

      {showLandingPreview ? <LandingPreviewModal project={project} onClose={() => setShowLandingPreview(false)} /> : null}
    </aside>
  )
}
