import type { BrandConfig, QrDesignTemplateId } from '@/types/project'

export interface QrDesignTemplateTheme {
  id: QrDesignTemplateId
  label: string
  /** Poster background — a solid fill or a 2-stop linear gradient. */
  background: { from: string; to: string }
  headlineColor: string
  companyNameColor: string
  ctaColor: string
  taglineColor: string
  /** The panel the QR itself sits on — always light, always high-contrast, regardless of theme. */
  qrPanelColor: string
  qrPanelBorderColor: string
  /** 'none' | 'frame' — a frame adds a thin decorative border inset from the poster edge. */
  decoration: 'none' | 'frame'
}

const WHITE = '#FFFFFF'
const NEAR_BLACK = '#141417'
const MUTED_LIGHT = 'rgba(255,255,255,0.75)'
const MUTED_DARK = '#63636c'

/**
 * Relative luminance (WCAG formula, simplified for sRGB hex input) — used
 * only to decide whether the Premium template's body text should be white
 * or dark. Brand primary colors are usually dark (that's the common case
 * this whole app is built around), but nothing stops a user from picking a
 * pale one, and white-on-pale-yellow would be illegible. This is the cheap,
 * correct fix rather than assuming "primary color = dark".
 */
function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  if (clean.length !== 6 && clean.length !== 3) return true // unparseable — assume dark, the common case
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const [rl, gl, bl] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
  return luminance < 0.5
}

function shade(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const r = Math.max(0, Math.min(255, parseInt(clean.slice(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(clean.slice(2, 4), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(clean.slice(4, 6), 16) + amount))
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Builds the visual theme for a template from the project's own brand
 * colors — nothing here is hard-coded to any specific company. The QR's
 * own panel is deliberately excluded from this derivation: it is always a
 * light, high-contrast surface no matter what the surrounding theme does,
 * which is what keeps "never sacrifice QR scannability for branding" true
 * by construction rather than by a runtime contrast check.
 */
export function getDesignTemplateTheme(template: QrDesignTemplateId, brand: Pick<BrandConfig, 'primaryColor' | 'secondaryColor'>): QrDesignTemplateTheme {
  const primary = brand.primaryColor || NEAR_BLACK
  const secondary = brand.secondaryColor || '#6D5EF9'

  switch (template) {
    case 'premium': {
      const dark = isDarkColor(primary)
      return {
        id: 'premium',
        label: 'Premium',
        background: { from: primary, to: shade(primary, dark ? -24 : 24) },
        headlineColor: dark ? WHITE : NEAR_BLACK,
        companyNameColor: dark ? WHITE : NEAR_BLACK,
        ctaColor: dark ? MUTED_LIGHT : 'rgba(20,20,23,0.7)',
        taglineColor: dark ? MUTED_LIGHT : 'rgba(20,20,23,0.7)',
        qrPanelColor: WHITE,
        qrPanelBorderColor: secondary,
        decoration: 'none'
      }
    }
    case 'classic':
      return {
        id: 'classic',
        label: 'Classic',
        background: { from: WHITE, to: WHITE },
        headlineColor: primary,
        companyNameColor: primary,
        ctaColor: MUTED_DARK,
        taglineColor: MUTED_DARK,
        qrPanelColor: WHITE,
        qrPanelBorderColor: secondary,
        decoration: 'frame'
      }
    case 'clean':
    default:
      return {
        id: 'clean',
        label: 'Clean',
        background: { from: WHITE, to: WHITE },
        headlineColor: primary,
        companyNameColor: primary,
        ctaColor: MUTED_DARK,
        taglineColor: MUTED_DARK,
        qrPanelColor: WHITE,
        qrPanelBorderColor: '#e4e4e9',
        decoration: 'none'
      }
  }
}

export const DESIGN_TEMPLATE_OPTIONS: Array<{ id: QrDesignTemplateId; label: string; hint: string }> = [
  { id: 'clean', label: 'Clean', hint: 'Minimal light background, generous whitespace.' },
  { id: 'premium', label: 'Premium', hint: 'Elegant brand-colored background, QR on a bright panel.' },
  { id: 'classic', label: 'Classic', hint: 'Light background with a subtle decorative frame.' }
]
