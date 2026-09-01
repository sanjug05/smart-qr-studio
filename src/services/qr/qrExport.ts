import type QRCodeStyling from 'qr-code-styling'
import type { BrandConfig, QrDesignConfig } from '@/types/project'
import { escapeMarkup } from '@/lib/escapeMarkup'
import { buildDesignedQrSvg, designedSvgToPngDataUrl } from './designComposition'

type DesignBrand = Pick<BrandConfig, 'companyName' | 'tagline' | 'logoDataUrl' | 'primaryColor' | 'secondaryColor'>

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

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

export async function downloadPng(instance: QRCodeStyling, companyName: string, slug: string): Promise<void> {
  await instance.download({ name: slugFilename(companyName, slug), extension: 'png' })
}

export async function getSvgMarkup(instance: QRCodeStyling): Promise<string> {
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
 * this is a bonus, not a replacement for the dedicated digital QR experience.
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

/**
 * Builds the full branded poster (logo → company → headline → QR → CTA)
 * around the exact verified QR SVG. Used by every "designed" export below
 * — PNG, SVG, and the digital HTML experience — so all three always show
 * the identical composition, never three different ad-hoc layouts.
 */
async function buildComposedSvg(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig): Promise<string> {
  const qrSvgMarkup = await getSvgMarkup(instance)
  return buildDesignedQrSvg({ brand, designConfig, qrSvgMarkup })
}

/** "Download Designed QR" — the primary, print-ready PNG export: the full composition, not the bare QR. */
export async function downloadDesignedQrPng(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, slug: string): Promise<void> {
  const composedSvg = await buildComposedSvg(instance, brand, designConfig)
  const dataUrl = await designedSvgToPngDataUrl(composedSvg)
  downloadDataUrl(dataUrl, `${slugFilename(brand.companyName, slug)}-designed.png`)
}

/** Vector version of the same composition — for print shops and design software. */
export async function downloadDesignedQrSvg(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, slug: string, shareUrl: string): Promise<void> {
  const composedSvg = await buildComposedSvg(instance, brand, designConfig)
  const linked = wrapSvgWithLink(composedSvg, shareUrl)
  downloadTextFile(linked, 'image/svg+xml', `${slugFilename(brand.companyName, slug)}-designed.svg`)
}

/** The bare, undecorated QR — kept available internally (e.g. for advanced/future export scenarios) but no longer the primary user-facing action. */
export async function downloadRawQrSvg(instance: QRCodeStyling, companyName: string, slug: string, shareUrl: string): Promise<void> {
  const markup = await getSvgMarkup(instance)
  const linked = wrapSvgWithLink(markup, shareUrl)
  downloadTextFile(linked, 'image/svg+xml', `${slugFilename(companyName, slug)}.svg`)
}

/**
 * The digital QR page: the same branded composition as the PNG/SVG
 * exports, inline in a self-contained HTML document, with the QR wrapped
 * in a real `<a href>` plus a visible "Open link" fallback for anyone who
 * taps the image and nothing happens (some mail/file viewers strip script
 * or block navigation from an embedded image). No external requests, no
 * build step — opening it anywhere makes the QR genuinely clickable,
 * which a bare PNG or JPG can never be.
 */
function buildDigitalQrHtml(brand: DesignBrand, composedSvgMarkup: string, shareUrl: string): string {
  const companyName = escapeMarkup(brand.companyName || 'Smart QR')
  const href = escapeMarkup(shareUrl)

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
    overflow-x: hidden;
  }
  .qr-link {
    display: block;
    width: 100%;
    max-width: 420px;
    line-height: 0;
    border-radius: 20px;
    transition: box-shadow 120ms ease, transform 80ms ease;
  }
  .qr-link:hover, .qr-link:focus-visible { box-shadow: 0 0 0 4px rgba(109, 94, 249, 0.35); }
  .qr-link:active { transform: scale(0.99); }
  .qr-link svg { display: block; width: 100%; height: auto; border-radius: 20px; }
  .open-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 16px auto 0;
    max-width: 420px;
    min-height: 44px;
    padding: 0 20px;
    border-radius: 8px;
    background: #141417;
    color: #ffffff;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .wrap { width: 100%; max-width: 420px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="qr-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Open ${companyName}'s Smart QR link">
      ${composedSvgMarkup}
    </a>
    <a class="open-btn" href="${href}" target="_blank" rel="noopener noreferrer">Open link ↗</a>
  </div>
</body>
</html>
`
}

/**
 * "Open Digital QR" — opens the branded, clickable composition directly in
 * a new browser tab (rather than a file the user has to go find afterward,
 * which is exactly the friction mobile downloads of HTML/SVG files run
 * into). The tab is a real page: taps or clicks on the QR, or the fallback
 * button, navigate to the exact share URL.
 */
export async function openDigitalQr(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, shareUrl: string): Promise<void> {
  const composedSvg = await buildComposedSvg(instance, brand, designConfig)
  const html = buildDigitalQrHtml(brand, composedSvg, shareUrl)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  // Popup blockers can silently refuse window.open — fall back to a normal
  // navigation in the current tab rather than doing nothing.
  if (!opened) window.location.assign(url)
}

function digitalQrFilename(companyName: string): string {
  const base = companyName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base ? `${base}-digital-qr.html` : 'digital-qr.html'
}

/**
 * "Download Digital QR" — saves the exact same self-contained page that
 * "Open Digital QR" opens in a tab, as a standalone .html file. Both share
 * the same `buildDigitalQrHtml` output, so there is one composition (and
 * one place that escapes user text into it) behind both actions — this
 * only changes what happens to that markup afterward (download vs open).
 */
export async function downloadDigitalQrHtml(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, shareUrl: string): Promise<void> {
  const composedSvg = await buildComposedSvg(instance, brand, designConfig)
  const html = buildDigitalQrHtml(brand, composedSvg, shareUrl)
  downloadTextFile(html, 'text/html', digitalQrFilename(brand.companyName))
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
