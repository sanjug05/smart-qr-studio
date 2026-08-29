import type { BrandingStyle, QRStyleConfig } from '@/types/project'
import { companyInitials, sanitizeCompanyName } from '@/lib/validation'

/**
 * How company identity gets into the QR code, safely.
 *
 * We deliberately do NOT try to reshape the QR's own data modules into
 * letterforms — that is not a reliable technique with standard QR decoders
 * and would fight directly against error correction. Instead every
 * branding style resolves to a small *image* dropped into the QR's center,
 * exactly like a logo. High error-correction (level H, ~30% recovery)
 * tolerates the obscured modules underneath it, and qr-code-styling's
 * `hideBackgroundDots`/`imageSize` keep that obscured area bounded and
 * centered rather than scattered across the code.
 *
 * Text-based styles (initials / company name) render the text onto an
 * offscreen canvas and use *that bitmap* as the logo image — so from the
 * QR engine's point of view a company name is indistinguishable from an
 * uploaded logo. This is the "controlled central branding area" approach:
 * safe because the branding footprint is capped, not because the text is
 * literally made of QR modules.
 */

export interface EffectiveBranding {
  image?: string
  imageSize: number
  note?: string
}

const MAX_INITIALS_IMAGE_SIZE = 0.2
const MAX_NAME_IMAGE_SIZE = 0.26
const MAX_LOGO_IMAGE_SIZE = 0.28

// The branding canvas is CANVAS_SIZE px square (see renderTextToImage); this
// is the smallest font size still treated as legibly printable once shrunk
// to fit. MIN_LEGIBLE_FONT_SIZE / CANVAS_SIZE ≈ 12% of the branding plate's
// height, which is roughly what renderTextToImage's own shrink loop floors
// out at for initials-length strings today.
const CANVAS_SIZE = 240
const MIN_LEGIBLE_FONT_SIZE = 28
const CANVAS_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Does `text` fit inside the branding plate at a still-legible size?
 *
 * A character *count* is a poor proxy for this: "Global Industrial" (18
 * Latin characters, narrow glyphs) can be narrower on screen than a
 * 6-character string set in a wide script, and CJK/other wide-glyph text
 * in particular is undercounted by length alone — an 8-character Japanese
 * company name can be visually denser than a 10-character Latin one. This
 * measures actual rendered glyph width via Canvas2D's `measureText`
 * against the same font stack `renderTextToImage` will really draw with,
 * which is the technically reliable signal a character-count threshold
 * can only approximate.
 */
function fitsBrandingPlate(text: string): boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length <= 10 // no canvas support to measure with — fall back to the old heuristic
  ctx.font = `700 ${MIN_LEGIBLE_FONT_SIZE}px ${CANVAS_FONT_FAMILY}`
  const maxWidth = CANVAS_SIZE - 8 * 4 // matches renderTextToImage's padding math
  return ctx.measureText(text).width <= maxWidth
}

export function resolveBranding(
  style: BrandingStyle,
  companyName: string,
  logoDataUrl: string | undefined,
  foregroundColor: string,
  customText?: string
): EffectiveBranding {
  const name = sanitizeCompanyName(companyName)

  switch (style) {
    case 'none':
      return { imageSize: 0 }

    case 'logo':
      if (!logoDataUrl) return { imageSize: 0, note: 'No logo uploaded — showing plain QR.' }
      return { image: logoDataUrl, imageSize: MAX_LOGO_IMAGE_SIZE }

    case 'initials': {
      const initials = companyInitials(name)
      if (!initials) return { imageSize: 0, note: 'Enter a company name to brand the QR with initials.' }
      return {
        image: renderTextToImage(initials, foregroundColor),
        imageSize: MAX_INITIALS_IMAGE_SIZE
      }
    }

    case 'name': {
      if (!name) return { imageSize: 0, note: 'Enter a company name to brand the QR.' }
      if (!fitsBrandingPlate(name)) {
        // The full name would need a branding area too large to stay
        // reliably scannable — fall back to initials automatically rather
        // than shipping an attractive-but-unreadable QR.
        const initials = companyInitials(name)
        return {
          image: renderTextToImage(initials, foregroundColor),
          imageSize: MAX_INITIALS_IMAGE_SIZE,
          note: `"${name}" is too long to render safely inside the QR — using initials ("${initials}") instead.`
        }
      }
      return {
        image: renderTextToImage(name, foregroundColor),
        imageSize: MAX_NAME_IMAGE_SIZE
      }
    }

    case 'custom': {
      if (logoDataUrl) return { image: logoDataUrl, imageSize: MAX_LOGO_IMAGE_SIZE }
      const text = sanitizeCompanyName(customText || name)
      if (!text) return { imageSize: 0, note: 'Upload a custom image or enter text to brand the QR.' }
      const useInitials = !fitsBrandingPlate(text)
      const label = useInitials ? companyInitials(text) : text
      return {
        image: renderTextToImage(label, foregroundColor),
        imageSize: useInitials ? MAX_INITIALS_IMAGE_SIZE : MAX_NAME_IMAGE_SIZE
      }
    }

    default:
      return { imageSize: 0 }
  }
}

/** Shrinks the branding footprint one notch — used when scan validation fails. */
export function stepDownBranding(branding: EffectiveBranding): EffectiveBranding | undefined {
  if (!branding.image || branding.imageSize <= 0.12) return undefined
  return { ...branding, imageSize: Math.max(0.12, branding.imageSize - 0.06) }
}

function renderTextToImage(text: string, color: string): string {
  const canvas = document.createElement('canvas')
  const size = 240
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.clearRect(0, 0, size, size)

  // White rounded plate behind the text so it stays legible against
  // whatever sits immediately around the QR's cleared center area.
  const pad = 8
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, 28)
  ctx.fill()

  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let fontSize = text.length <= 3 ? 96 : text.length <= 6 ? 64 : 40
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const maxWidth = size - pad * 4
  while (ctx.measureText(text).width > maxWidth && fontSize > 18) {
    fontSize -= 4
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  }

  ctx.fillText(text, size / 2, size / 2 + 2)
  return canvas.toDataURL('image/png')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function moduleStyleToDotType(style: QRStyleConfig['moduleStyle']) {
  switch (style) {
    case 'square':
      return 'square'
    case 'dots':
      return 'dots'
    case 'rounded':
    default:
      return 'rounded'
  }
}

export function moduleStyleToCornerSquareType(style: QRStyleConfig['moduleStyle']) {
  switch (style) {
    case 'square':
      return 'square'
    case 'dots':
      return 'dot'
    case 'rounded':
    default:
      return 'extra-rounded'
  }
}

export function moduleStyleToCornerDotType(style: QRStyleConfig['moduleStyle']) {
  return style === 'square' ? 'square' : 'dot'
}
