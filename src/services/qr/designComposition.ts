import type { BrandConfig, QrDesignConfig } from '@/types/project'
import { companyInitials, sanitizeCompanyName } from '@/lib/validation'
import { escapeMarkup } from '@/lib/escapeMarkup'
import { getDesignTemplateTheme } from './designTemplates'
import { nativeQrSize } from './qrShare'
import { loadSvgImage, rasterizeQrSvg } from './qrRaster'

/**
 * Renders the verified QR inside a branded poster/card composition —
 * "Brand → Headline → QR → CTA" — instead of shipping a bare QR square as
 * the default download. This is a presentation layer only: it takes the
 * QR's own already-generated, already-verified SVG markup and places it,
 * completely unmodified, inside a larger canvas. No module, path, color,
 * or dimension inside that nested QR is ever touched — see
 * `embedQr` below for exactly how that's enforced (aspect-locked nesting,
 * never a stretch transform).
 *
 * Print-ready portrait canvas at the ISO 216 ratio (1:√2 — the same ratio
 * A4/A5/etc share), so scaling this up or down for any of those paper
 * sizes never distorts the layout.
 */

const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 1414
const MARGIN_X = 80
const CONTENT_WIDTH = CANVAS_WIDTH - MARGIN_X * 2

// Single-quoted multi-word names, not double — this string gets embedded
// directly inside a double-quoted SVG attribute value (font-family="...");
// a literal " here would prematurely close that attribute and corrupt the
// XML, exactly as it did before this was fixed (caught by parsing the
// generated SVG back and finding a real parsererror, not by inspection).
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const AVATAR_CENTER_Y = 190
const AVATAR_RADIUS = 90
const COMPANY_NAME_Y = 380
const HEADLINE_Y = 440
const TAGLINE_Y = 480
const QR_PANEL_Y = 560
const QR_PANEL_SIZE = 700
const QR_PANEL_PADDING = 60
const CTA_Y = QR_PANEL_Y + QR_PANEL_SIZE + 70
const FOOTER_Y = CANVAS_HEIGHT - 44

export interface DesignedQrInput {
  brand: Pick<BrandConfig, 'companyName' | 'tagline' | 'logoDataUrl' | 'primaryColor' | 'secondaryColor'>
  designConfig: QrDesignConfig
  /** Raw SVG markup from the already-verified QR — see qrExport.ts's getSvgMarkup. */
  qrSvgMarkup: string
  /**
   * Draw everything except the QR itself (the panel it sits on is still
   * drawn). Only `renderDesignedQrPng` uses this: it rasterizes the QR
   * separately at a pixel-aligned scale and places it into the panel. The
   * SVG and Digital QR outputs never set it.
   */
  omitQr?: boolean
}

function measure(text: string, size: number, weight = 700): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * size * 0.6 // rough fallback if canvas is unavailable
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`
  return ctx.measureText(text).width
}

function fitFontSize(text: string, maxWidth: number, startSize: number, minSize: number, weight = 700): number {
  let size = startSize
  while (size > minSize && measure(text, size, weight) > maxWidth) {
    size -= 2
  }
  return size
}

function truncateToWidth(text: string, maxWidth: number, size: number, weight = 700): string {
  if (measure(text, size, weight) <= maxWidth) return text
  let truncated = text
  while (truncated.length > 1 && measure(truncated + '…', size, weight) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return truncated.length > 0 ? `${truncated}…` : text.slice(0, 1)
}

const COMPANY_NAME_TARGET_SIZE = 56
const COMPANY_NAME_MIN_SIZE = 34

/**
 * Mirrors the exact "measure, shrink, fall back to initials" strategy
 * already used for in-QR branding text (src/services/qr/branding.ts) —
 * same reasoning: a character count can't tell a long name in a narrow
 * script from a short one in a wide script, so this measures real glyph
 * width and only falls back to initials when the name genuinely can't fit
 * even at the smallest acceptable size.
 */
function resolveCompanyDisplay(rawName: string, maxWidth: number): { text: string; fontSize: number } {
  const name = sanitizeCompanyName(rawName) || 'Smart QR'
  if (measure(name, COMPANY_NAME_MIN_SIZE) <= maxWidth) {
    return { text: name, fontSize: fitFontSize(name, maxWidth, COMPANY_NAME_TARGET_SIZE, COMPANY_NAME_MIN_SIZE) }
  }
  const initials = companyInitials(name) || name.slice(0, 3).toUpperCase()
  return { text: initials, fontSize: COMPANY_NAME_TARGET_SIZE }
}

/**
 * Nests the QR's own SVG inside the poster as a child `<svg>` viewport
 * with its original `viewBox` carried over and equal width/height — the
 * one thing this function can never do is set width ≠ height, since the
 * QR is always literally square, and an unequal box would stretch it.
 * Falls back to a plain `<image>` embed (still aspect-locked) if the
 * markup doesn't parse, rather than failing the whole export over it.
 */
function embedQr(qrSvgMarkup: string, x: number, y: number, size: number): string {
  try {
    const doc = new DOMParser().parseFromString(qrSvgMarkup, 'image/svg+xml')
    const svgEl = doc.documentElement
    if (svgEl.querySelector('parsererror') || svgEl.nodeName !== 'svg') throw new Error('invalid QR markup')
    const viewBox = svgEl.getAttribute('viewBox') || `0 0 ${svgEl.getAttribute('width') || size} ${svgEl.getAttribute('height') || size}`
    const inner = Array.from(svgEl.childNodes)
      .map((n) => new XMLSerializer().serializeToString(n))
      .join('')
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${escapeMarkup(viewBox)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`
  } catch {
    const blob = new Blob([qrSvgMarkup], { type: 'image/svg+xml' })
    const dataUrl = URL.createObjectURL(blob)
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="${dataUrl}" />`
  }
}

export function buildDesignedQrSvg({ brand, designConfig, qrSvgMarkup, omitQr = false }: DesignedQrInput): string {
  const theme = getDesignTemplateTheme(designConfig.template, brand)
  const centerX = CANVAS_WIDTH / 2

  const company = resolveCompanyDisplay(brand.companyName, CONTENT_WIDTH)
  const headlineRaw = designConfig.headline.trim()
  const headlineSize = headlineRaw ? fitFontSize(headlineRaw, CONTENT_WIDTH, 34, 22) : 0
  const headline = headlineRaw ? truncateToWidth(headlineRaw, CONTENT_WIDTH, headlineSize) : ''
  const tagline = brand.tagline?.trim() || ''
  const taglineSize = tagline ? fitFontSize(tagline, CONTENT_WIDTH, 26, 18) : 0
  const ctaRaw = designConfig.ctaText.trim()
  const ctaSize = ctaRaw ? fitFontSize(ctaRaw, CONTENT_WIDTH, 30, 20) : 0
  const cta = ctaRaw ? truncateToWidth(ctaRaw, CONTENT_WIDTH, ctaSize) : ''

  const qrX = (CANVAS_WIDTH - QR_PANEL_SIZE) / 2
  const qrInnerSize = QR_PANEL_SIZE - QR_PANEL_PADDING * 2

  const gradientId = `bg-${Math.random().toString(36).slice(2, 9)}`
  const backgroundFill = theme.background.from === theme.background.to ? theme.background.from : `url(#${gradientId})`

  const logo = brand.logoDataUrl
    ? `<image x="${centerX - AVATAR_RADIUS}" y="${AVATAR_CENTER_Y - AVATAR_RADIUS}" width="${AVATAR_RADIUS * 2}" height="${AVATAR_RADIUS * 2}" preserveAspectRatio="xMidYMid meet" href="${brand.logoDataUrl}" />`
    : `<circle cx="${centerX}" cy="${AVATAR_CENTER_Y}" r="${AVATAR_RADIUS}" fill="${theme.qrPanelBorderColor}" />
       <text x="${centerX}" y="${AVATAR_CENTER_Y + 22}" font-family="${FONT_FAMILY}" font-size="72" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeMarkup(
        (sanitizeCompanyName(brand.companyName) || 'Q').charAt(0).toUpperCase()
      )}</text>`

  const frame =
    theme.decoration === 'frame'
      ? `<rect x="40" y="40" width="${CANVAS_WIDTH - 80}" height="${CANVAS_HEIGHT - 80}" fill="none" stroke="${theme.qrPanelBorderColor}" stroke-width="3" rx="18" />
         <rect x="54" y="54" width="${CANVAS_WIDTH - 108}" height="${CANVAS_HEIGHT - 108}" fill="none" stroke="${theme.qrPanelBorderColor}" stroke-width="1" rx="12" opacity="0.5" />`
      : ''

  return `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${theme.background.from}" />
      <stop offset="100%" stop-color="${theme.background.to}" />
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${backgroundFill}" />
  ${frame}

  ${logo}

  <text x="${centerX}" y="${COMPANY_NAME_Y}" font-family="${FONT_FAMILY}" font-size="${company.fontSize}" font-weight="800" fill="${theme.companyNameColor}" text-anchor="middle">${escapeMarkup(company.text)}</text>

  ${headline ? `<text x="${centerX}" y="${HEADLINE_Y}" font-family="${FONT_FAMILY}" font-size="${headlineSize}" font-weight="600" fill="${theme.headlineColor}" text-anchor="middle">${escapeMarkup(headline)}</text>` : ''}

  ${tagline ? `<text x="${centerX}" y="${TAGLINE_Y}" font-family="${FONT_FAMILY}" font-size="${taglineSize}" font-weight="400" fill="${theme.taglineColor}" text-anchor="middle">${escapeMarkup(tagline)}</text>` : ''}

  <!--
    The QR's safe panel: always a light, high-contrast surface, independent
    of the poster theme above. This is what keeps "never sacrifice QR
    scannability for branding" true even if a Premium background is dark —
    the QR is never drawn directly on it.
  -->
  <rect x="${qrX}" y="${QR_PANEL_Y}" width="${QR_PANEL_SIZE}" height="${QR_PANEL_SIZE}" rx="24" fill="${theme.qrPanelColor}" stroke="${theme.qrPanelBorderColor}" stroke-width="2" />
  ${omitQr ? '' : embedQr(qrSvgMarkup, qrX + QR_PANEL_PADDING, QR_PANEL_Y + QR_PANEL_PADDING, qrInnerSize)}

  ${cta ? `<text x="${centerX}" y="${CTA_Y}" font-family="${FONT_FAMILY}" font-size="${ctaSize}" font-weight="600" fill="${theme.ctaColor}" text-anchor="middle">${escapeMarkup(cta)}</text>` : ''}

  <text x="${centerX}" y="${FOOTER_Y}" font-family="${FONT_FAMILY}" font-size="18" font-weight="400" fill="${theme.ctaColor}" opacity="0.6" text-anchor="middle">Powered by Smart QR Studio</text>
</svg>`
}

/** Poster PNG width to aim for; the real width is nudged so the QR lands on a whole-number scale (see alignedPosterScale). */
export const DESIGNED_PNG_TARGET_WIDTH = 1600

export interface AlignedPosterScale {
  /** Whole-number multiple of the QR's native size the QR is rasterized at. */
  qrScale: number
  /** The QR's raster edge in output pixels: `nativeQr * qrScale`, always an integer. */
  qrBoxPx: number
  /** Output pixels per poster unit. */
  scale: number
  width: number
  height: number
}

/**
 * Chooses the poster PNG size so the QR box lands on a whole multiple of its
 * native size — without changing the poster's layout at all.
 *
 * The QR box is `QR_PANEL_SIZE - 2*QR_PANEL_PADDING` (580) poster units and
 * the poster is 1000 units wide, so any output width fixes the QR's scale
 * (`580/N * width/1000`). A fixed width (the old 1200) therefore forces a
 * fractional one — about 1.45x for a 480px QR. Instead, pick the whole
 * multiple `k` nearest the target width, then derive the width from it:
 * `width = 1000 * (N*k) / 580`. Everything else in the poster is vector and
 * simply follows that scale. The QR is never made smaller to achieve this;
 * only the output resolution moves (about 1655px wide for the default QR).
 */
export function alignedPosterScale(nativeQr: number, targetWidth = DESIGNED_PNG_TARGET_WIDTH): AlignedPosterScale {
  const native = Math.max(1, Math.round(nativeQr))
  const qrInner = QR_PANEL_SIZE - QR_PANEL_PADDING * 2
  const qrScale = Math.max(1, Math.round((targetWidth * (qrInner / CANVAS_WIDTH)) / native))
  const qrBoxPx = native * qrScale
  const scale = qrBoxPx / qrInner
  return { qrScale, qrBoxPx, scale, width: Math.round(CANVAS_WIDTH * scale), height: Math.round(CANVAS_HEIGHT * scale) }
}

/**
 * The "Smart QR" PNG. Two layers, so the QR is never resampled by the
 * poster's own scaling:
 *   1. the poster (background, frame, logo, text, panel — everything from
 *      `buildDesignedQrSvg`, unchanged) rasterized at the aligned width; and
 *   2. the QR rasterized on its own at a whole multiple of its native size
 *      and copied 1:1 onto the panel at whole-pixel coordinates, centered
 *      exactly where the SVG version places it.
 * The QR's data, colors and geometry are exactly those of the verified
 * instance; only *how it is sampled into pixels* differs.
 */
export async function renderDesignedQrPng(input: DesignedQrInput, targetWidth = DESIGNED_PNG_TARGET_WIDTH): Promise<string> {
  const aligned = alignedPosterScale(nativeQrSize(input.qrSvgMarkup), targetWidth)

  const posterImg = await loadSvgImage(buildDesignedQrSvg({ ...input, omitQr: true }))
  const canvas = document.createElement('canvas')
  canvas.width = aligned.width
  canvas.height = aligned.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(posterImg, 0, 0, CANVAS_WIDTH * aligned.scale, CANVAS_HEIGHT * aligned.scale)

  // Same centre the SVG embed uses: panel origin + padding + half the inner box.
  const centerX = ((CANVAS_WIDTH - QR_PANEL_SIZE) / 2 + QR_PANEL_PADDING + (QR_PANEL_SIZE - QR_PANEL_PADDING * 2) / 2) * aligned.scale
  const centerY = (QR_PANEL_Y + QR_PANEL_PADDING + (QR_PANEL_SIZE - QR_PANEL_PADDING * 2) / 2) * aligned.scale
  const qrCanvas = await rasterizeQrSvg(input.qrSvgMarkup, aligned.qrBoxPx, { transparent: true })
  ctx.drawImage(qrCanvas, Math.round(centerX - aligned.qrBoxPx / 2), Math.round(centerY - aligned.qrBoxPx / 2))

  return canvas.toDataURL('image/png')
}
