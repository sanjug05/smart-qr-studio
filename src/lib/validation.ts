/**
 * Central input validation. Every user-provided URL in the app (destination
 * links, the generated smart-QR link) must pass through here before it is
 * stored, rendered as a link, or opened — this is the app's only line of
 * defense against javascript:, data:, and other unsafe URL schemes.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export interface ValidationResult {
  valid: boolean
  message?: string
}

export function validateUrl(rawUrl: string): ValidationResult {
  const value = rawUrl.trim()
  if (!value) {
    return { valid: false, message: 'Please enter a valid website URL.' }
  }

  let parsed: URL
  try {
    // Bare "example.com" is a common paste; try it with https:// once.
    parsed = new URL(value)
  } catch {
    try {
      parsed = new URL(`https://${value}`)
    } catch {
      return { valid: false, message: 'Please enter a valid website URL.' }
    }
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, message: 'Only http:// and https:// links are allowed.' }
  }

  if (!parsed.hostname) {
    return { valid: false, message: 'Please enter a valid website URL.' }
  }

  return { valid: true }
}

export function normalizeUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  try {
    return new URL(value).toString()
  } catch {
    try {
      return new URL(`https://${value}`).toString()
    } catch {
      return value
    }
  }
}

export function isSafeImageDataUrl(dataUrl: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(dataUrl)
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export function validateImageFile(file: File): ValidationResult {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return { valid: false, message: 'Please upload a supported image format (PNG, JPG, WEBP or SVG).' }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { valid: false, message: 'Please upload an image smaller than 2MB.' }
  }
  return { valid: true }
}

export function sanitizeCompanyName(name: string): string {
  // Strip anything that isn't safe to render as plain text content.
  return name.replace(/[<>]/g, '').trim().slice(0, 60)
}

export function companyInitials(name: string): string {
  const words = sanitizeCompanyName(name).split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
