import type QRCodeStyling from 'qr-code-styling'
import type { BrandConfig, QrDesignConfig } from '@/types/project'
import { escapeMarkup } from '@/lib/escapeMarkup'
import { buildDesignedQrSvg, renderDesignedQrPng } from './designComposition'
import { rasterizeQrSvg } from './qrRaster'
import {
  assertSafeShareUrl,
  buildEmailQrContent,
  copyEmailQr,
  integerScaleSize,
  nativeQrSize,
  EMAIL_QR_DISPLAY_SIZE,
  type EmailCopyOutcome,
  type EmailQrContent
} from './qrShare'

type DesignBrand = Pick<BrandConfig, 'companyName' | 'tagline' | 'logoDataUrl' | 'primaryColor' | 'secondaryColor'>

/** "Download QR" PNG target edge length — large enough to stay sharp in slides, documents and print-at-size (rounded up to a whole multiple of the QR's native size; see integerScaleSize). */
const QR_ONLY_PNG_TARGET = 1200
/** "Copy for Email": twice the on-screen size, so it stays crisp on high-DPI screens without bloating the pasted message. */
const EMAIL_QR_PNG_TARGET = EMAIL_QR_DISPLAY_SIZE * 2

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

export async function getSvgMarkup(instance: QRCodeStyling): Promise<string> {
  const raw = await instance.getRawData('svg')
  if (!raw) throw new Error('QR code has no SVG data to export.')
  const blob = raw instanceof Blob ? raw : new Blob([raw as BlobPart], { type: 'image/svg+xml' })
  return blob.text()
}

/**
 * Rasterizes the bare QR's SVG to a square PNG data URI at exactly `size`px.
 * The source is vector, so this re-renders at the target size rather than
 * upscaling a small bitmap. Opaque white behind the code unless the caller
 * asks for transparency (the QR Style step's "Transparent background"
 * option) — email always asks for opaque, since a transparent QR turns
 * invisible on a dark-mode message background.
 */
async function qrSvgToPngDataUrl(svgMarkup: string, size: number, options: { transparent?: boolean } = {}): Promise<string> {
  return (await rasterizeQrSvg(svgMarkup, size, options)).toDataURL('image/png')
}

/**
 * "Download QR" — PNG (1440px at the default 480px QR size). ONLY the code itself: no company name, logo,
 * tagline, call to action, border, or Smart QR frame. (A branding image
 * *inside* the QR's own center, if the QR Style step enabled one, is part of
 * the code and stays — see README → "How QR branding works".) What it
 * encodes is whatever the verified QR instance encodes — the canonical
 * `getQrShareUrl` value — so a Dynamic QR downloads its permanent link.
 */
export async function downloadQrOnlyPng(instance: QRCodeStyling, companyName: string, slug: string, options: { transparent?: boolean } = {}): Promise<void> {
  const svg = await getSvgMarkup(instance)
  const dataUrl = await qrSvgToPngDataUrl(svg, integerScaleSize(QR_ONLY_PNG_TARGET, nativeQrSize(svg)), options)
  downloadDataUrl(dataUrl, `${slugFilename(companyName, slug)}-qr.png`)
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

/** "Download Smart QR" — PNG. The full branded composition (logo, name, headline, QR, frame, CTA), not the bare QR. Reuses the one composition engine (designComposition.ts). */
export async function downloadDesignedQrPng(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, slug: string): Promise<void> {
  // Not `buildComposedSvg` + a generic SVG rasterizer: the QR is rasterized on
  // its own at a pixel-aligned scale (see renderDesignedQrPng).
  const qrSvgMarkup = await getSvgMarkup(instance)
  const dataUrl = await renderDesignedQrPng({ brand, designConfig, qrSvgMarkup })
  downloadDataUrl(dataUrl, `${slugFilename(brand.companyName, slug)}-smart-qr.png`)
}

/** "Download Smart QR" — SVG. Vector version of the same composition, for print shops and design software. */
export async function downloadDesignedQrSvg(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, slug: string, shareUrl: string): Promise<void> {
  const composedSvg = await buildComposedSvg(instance, brand, designConfig)
  const linked = wrapSvgWithLink(composedSvg, assertSafeShareUrl(shareUrl))
  downloadTextFile(linked, 'image/svg+xml', `${slugFilename(brand.companyName, slug)}-smart-qr.svg`)
}

/**
 * "Download QR" — SVG. The bare vector QR and nothing else, hyperlinked to
 * the QR's own URL for the contexts (browsers, some vector editors) that
 * honor SVG links — the wrapper adds no visible element and cannot change
 * how the code scans.
 */
export async function downloadQrOnlySvg(instance: QRCodeStyling, companyName: string, slug: string, shareUrl: string): Promise<void> {
  const markup = await getSvgMarkup(instance)
  const linked = wrapSvgWithLink(markup, assertSafeShareUrl(shareUrl))
  downloadTextFile(linked, 'image/svg+xml', `${slugFilename(companyName, slug)}-qr.svg`)
}

/**
 * Builds the "Copy for Email" content: the QR-only image (opaque white,
 * 600px PNG — email clients don't render SVG) inside a real link, plus the
 * brand text as live, accessible HTML text rather than baked into a picture.
 * See qrShare.ts for the structure and the reasoning behind it.
 */
export async function prepareEmailQrContent(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, shareUrl: string): Promise<EmailQrContent> {
  const svg = await getSvgMarkup(instance)
  const qrPngDataUrl = await qrSvgToPngDataUrl(svg, integerScaleSize(EMAIL_QR_PNG_TARGET, nativeQrSize(svg)), { transparent: false })
  return buildEmailQrContent({ brand, designConfig, shareUrl, qrPngDataUrl })
}

/** "Copy for Email" — copies the clickable block as rich HTML, degrading gracefully (see copyEmailQr). */
export function copyEmailQrBlock(instance: QRCodeStyling, brand: DesignBrand, designConfig: QrDesignConfig, shareUrl: string): Promise<EmailCopyOutcome> {
  return copyEmailQr(() => prepareEmailQrContent(instance, brand, designConfig, shareUrl))
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
  const href = escapeMarkup(assertSafeShareUrl(shareUrl))

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
