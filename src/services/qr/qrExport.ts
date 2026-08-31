import type QRCodeStyling from 'qr-code-styling'
import type { BrandConfig } from '@/types/project'

function slugFilename(companyName: string, slug: string): string {
  const base = companyName.trim() ? companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'smart-qr'
  return `${base}-${slug}`
}

function downloadTextFile(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadPng(instance: QRCodeStyling, companyName: string, slug: string): Promise<void> {
  await instance.download({ name: slugFilename(companyName, slug), extension: 'png' })
}

async function getSvgMarkup(instance: QRCodeStyling): Promise<string> {
  const raw = await instance.getRawData('svg')
  if (!raw) throw new Error('QR code has no SVG data to export.')
  const blob = raw instanceof Blob ? raw : new Blob([raw as BlobPart], { type: 'image/svg+xml' })
  return blob.text()
}

/**
 * Wraps every existing child of the SVG root in an `<a>` element pointing
 * at the share URL. This only adds a non-rendering wrapper node — no
 * shape, path, or module is touched — so it cannot change how the code
 * looks or scans; a scanner reads pixels, not DOM structure. What it does
 * change is what happens when the SVG is opened somewhere that actually
 * honors in-document links (a browser tab, some vector editors, inline in
 * a web page): clicking the code opens the link. Plenty of common contexts
 * — Office/PDF placement, most image viewers, and SVG-as-plain-image use
 * — do not render or activate SVG hyperlinks at all, which is exactly why
 * this is a bonus on top of the dedicated clickable HTML asset
 * (clickableAsset.ts), not a replacement for it.
 */
function wrapSvgWithLink(svgMarkup: string, href: string): string {
  try {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
    const svgEl = doc.documentElement
    if (svgEl.querySelector('parsererror') || svgEl.nodeName !== 'svg') return svgMarkup

    const SVG_NS = 'http://www.w3.org/2000/svg'
    const XLINK_NS = 'http://www.w3.org/1999/xlink'
    const anchor = doc.createElementNS(SVG_NS, 'a')
    anchor.setAttributeNS(XLINK_NS, 'xlink:href', href)
    anchor.setAttribute('href', href)
    anchor.setAttribute('target', '_blank')

    while (svgEl.firstChild) {
      anchor.appendChild(svgEl.firstChild)
    }
    svgEl.appendChild(anchor)

    return new XMLSerializer().serializeToString(doc)
  } catch {
    // Fall back to a perfectly good plain QR rather than fail the export
    // over a hyperlink that was only ever a bonus.
    return svgMarkup
  }
}

export async function downloadSvg(instance: QRCodeStyling, companyName: string, slug: string, shareUrl: string): Promise<void> {
  const markup = await getSvgMarkup(instance)
  const linked = wrapSvgWithLink(markup, shareUrl)
  downloadTextFile(linked, 'image/svg+xml', `${slugFilename(companyName, slug)}.svg`)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The technically-correct "clickable QR" asset: a small self-contained
 * HTML file (no external requests, no build step) with the QR wrapped in
 * a real `<a href>`, plus a visible fallback button for anyone who taps
 * the image and nothing happens (some mail/file viewers strip script or
 * disable navigation from an embedded image). Opening this file in any
 * browser — locally, from a download folder, from an email attachment —
 * makes the QR (and the fallback button) genuinely clickable, which a
 * bare PNG or JPG can never be.
 */
function buildClickableQrHtml(
  brand: Pick<BrandConfig, 'companyName' | 'tagline' | 'primaryColor'>,
  svgMarkup: string,
  shareUrl: string
): string {
  const companyName = escapeHtml(brand.companyName || 'Smart QR')
  const tagline = brand.tagline ? escapeHtml(brand.tagline) : ''
  const href = escapeHtml(shareUrl)
  const primary = escapeHtml(brand.primaryColor || '#141417')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${companyName} — Smart QR</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f6f6f8;
    padding: 24px;
  }
  .card {
    background: #ffffff;
    border: 1px solid #e4e4e9;
    border-radius: 20px;
    padding: 32px;
    max-width: 360px;
    width: 100%;
    text-align: center;
    box-shadow: 0 4px 16px rgba(20, 20, 23, 0.08);
  }
  h1 { font-size: 1.2rem; margin: 0 0 4px; color: ${primary}; }
  p.tagline { margin: 0 0 20px; color: #63636c; font-size: 0.9rem; }
  .qr-link {
    display: inline-block;
    border-radius: 16px;
    padding: 8px;
    line-height: 0;
    transition: box-shadow 120ms ease, transform 80ms ease;
  }
  .qr-link:hover, .qr-link:focus-visible { box-shadow: 0 0 0 3px rgba(109, 94, 249, 0.35); }
  .qr-link:active { transform: scale(0.98); }
  .qr-link svg { display: block; width: 220px; height: 220px; max-width: 100%; }
  .open-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 20px;
    min-height: 44px;
    padding: 0 20px;
    border-radius: 8px;
    background: ${primary};
    color: #ffffff;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .hint { margin-top: 16px; color: #9a9aa2; font-size: 0.76rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>${companyName}</h1>
    ${tagline ? `<p class="tagline">${tagline}</p>` : ''}
    <a class="qr-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Open ${companyName}'s Smart QR link">
      ${svgMarkup}
    </a>
    <div>
      <a class="open-btn" href="${href}" target="_blank" rel="noopener noreferrer">Open link ↗</a>
    </div>
    <p class="hint">Tap the QR or the button above to open. Powered by Smart QR Studio.</p>
  </div>
</body>
</html>
`
}

export async function downloadClickableQrHtml(
  instance: QRCodeStyling,
  brand: Pick<BrandConfig, 'companyName' | 'tagline' | 'primaryColor'>,
  slug: string,
  shareUrl: string
): Promise<void> {
  const markup = await getSvgMarkup(instance)
  const html = buildClickableQrHtml(brand, markup, shareUrl)
  downloadTextFile(html, 'text/html', `${slugFilename(brand.companyName, slug)}-clickable.html`)
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
