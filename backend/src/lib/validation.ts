/**
 * Server-side validation for Dynamic QR content. Deliberately mirrors the
 * rules in src/lib/validation.ts and the length limits already enforced by
 * the wizard's form inputs (DestinationsStep.tsx `maxLength` attributes) —
 * kept as an independent copy rather than a shared import (see README →
 * "Current limitations": the backend and frontend are separate deployable
 * projects with no shared build tooling between them). If either file's
 * rules change, update the other by hand.
 *
 * This is the one place "do not trust the client" is enforced for Dynamic
 * QR: every field here is re-validated from scratch, regardless of what
 * the wizard already checked before sending the request.
 */
import type { DynamicQrBrand, DynamicQrContent, DynamicQrDestination } from '../types'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/
const MAX_DESTINATIONS = 5
const MAX_LABEL_LENGTH = 30
const MAX_DESCRIPTION_LENGTH = 60
const MAX_COMPANY_NAME_LENGTH = 120
const MAX_TAGLINE_LENGTH = 160
const MAX_ICON_LENGTH = 8 // a short emoji/glyph, never arbitrary text
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/
const MAX_IMAGE_DATA_URL_LENGTH = 3_000_000 // ~2.2MB of binary once decoded — matches the frontend's 2MB upload cap plus base64 overhead
// A Firestore document is capped at 1 MiB and the whole published content (images included, as data URLs)
// lives in one document, so the *total* must fit with headroom for the other fields. This — not the
// per-image cap above — is the effective image budget for a Dynamic QR.
export const MAX_CONTENT_BYTES = 900_000

export interface ValidationOutcome {
  valid: boolean
  errors: string[]
  content?: DynamicQrContent
}

export function validateUrl(rawUrl: string): boolean {
  const value = rawUrl.trim()
  if (!value) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname)
}

/** Mirrors the frontend's normalizeUrl() — canonicalizes an already-validated URL string. */
function normalizeUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl.trim()).toString()
  } catch {
    return rawUrl.trim()
  }
}

function isSafeImageDataUrl(value: string): boolean {
  return SAFE_IMAGE_DATA_URL.test(value) && value.length <= MAX_IMAGE_DATA_URL_LENGTH
}

/**
 * Validates and normalizes an untrusted request body into a
 * `DynamicQrContent`. Never trusts the input's shape — every field is
 * type-checked, and unexpected extra fields are dropped rather than
 * stored, so a malicious or malformed body can't smuggle unrelated data
 * into the published record.
 */
export function validateDynamicQrContent(input: unknown): ValidationOutcome {
  const errors: string[] = []
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object.'] }
  }
  const raw = input as Record<string, unknown>

  const brand = validateBrand(raw.brand, errors)
  const destinations = validateDestinations(raw.destinations, errors)

  if (errors.length > 0 || !brand) {
    return { valid: false, errors }
  }

  const content = { brand, destinations }
  if (new TextEncoder().encode(JSON.stringify(content)).length > MAX_CONTENT_BYTES) {
    return { valid: false, errors: ['Content is too large. Use a smaller logo or icon images (about 600 KB combined at most).'] }
  }

  return { valid: true, errors: [], content }
}

function validateBrand(value: unknown, errors: string[]): DynamicQrBrand | null {
  if (!value || typeof value !== 'object') {
    errors.push('brand is required.')
    return null
  }
  const b = value as Record<string, unknown>

  const companyName = typeof b.companyName === 'string' ? b.companyName.trim().slice(0, MAX_COMPANY_NAME_LENGTH) : ''

  const primaryColor = typeof b.primaryColor === 'string' && HEX_COLOR.test(b.primaryColor) ? b.primaryColor : null
  const secondaryColor = typeof b.secondaryColor === 'string' && HEX_COLOR.test(b.secondaryColor) ? b.secondaryColor : null
  const backgroundColor = typeof b.backgroundColor === 'string' && HEX_COLOR.test(b.backgroundColor) ? b.backgroundColor : null
  if (!primaryColor) errors.push('brand.primaryColor must be a valid hex color.')
  if (!secondaryColor) errors.push('brand.secondaryColor must be a valid hex color.')
  if (!backgroundColor) errors.push('brand.backgroundColor must be a valid hex color.')

  let tagline: string | undefined
  if (typeof b.tagline === 'string' && b.tagline.trim()) {
    tagline = b.tagline.trim().slice(0, MAX_TAGLINE_LENGTH)
  }

  let logoDataUrl: string | undefined
  if (typeof b.logoDataUrl === 'string' && b.logoDataUrl) {
    if (!isSafeImageDataUrl(b.logoDataUrl)) {
      errors.push('brand.logoDataUrl must be a supported image data URL under the size limit.')
    } else {
      logoDataUrl = b.logoDataUrl
    }
  }

  if (!primaryColor || !secondaryColor || !backgroundColor) return null

  return {
    companyName,
    ...(tagline ? { tagline } : {}),
    ...(logoDataUrl ? { logoDataUrl } : {}),
    primaryColor,
    secondaryColor,
    backgroundColor
  }
}

function validateDestinations(value: unknown, errors: string[]): DynamicQrDestination[] {
  if (!Array.isArray(value)) {
    errors.push('destinations must be an array.')
    return []
  }
  // Extra destinations are silently dropped rather than rejected — the same
  // behavior the frontend's own buildShareablePayload() already applies to
  // the static payload (see src/services/share/sharePayload.ts).

  const destinations: DynamicQrDestination[] = []
  value.slice(0, MAX_DESTINATIONS).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`destinations[${index}] must be an object.`)
      return
    }
    const d = item as Record<string, unknown>

    const id = typeof d.id === 'string' && d.id ? d.id : `d${index}`
    const label = typeof d.label === 'string' ? d.label.trim().slice(0, MAX_LABEL_LENGTH) : ''
    const enabled = typeof d.enabled === 'boolean' ? d.enabled : true
    const order = typeof d.order === 'number' ? d.order : index
    const icon = typeof d.icon === 'string' ? d.icon.slice(0, MAX_ICON_LENGTH) : ''

    if (enabled) {
      if (typeof d.url !== 'string' || !validateUrl(d.url)) {
        errors.push(`destinations[${index}].url must be a valid http(s) URL.`)
        return
      }
    }
    const rawUrl = typeof d.url === 'string' ? d.url.trim() : ''
    const url = enabled ? normalizeUrl(rawUrl) : rawUrl

    let description: string | undefined
    if (typeof d.description === 'string' && d.description.trim()) {
      description = d.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
    }

    let customIconDataUrl: string | undefined
    if (typeof d.customIconDataUrl === 'string' && d.customIconDataUrl) {
      if (!isSafeImageDataUrl(d.customIconDataUrl)) {
        errors.push(`destinations[${index}].customIconDataUrl must be a supported image data URL under the size limit.`)
      } else {
        customIconDataUrl = d.customIconDataUrl
      }
    }

    destinations.push({
      id,
      label,
      url,
      ...(description ? { description } : {}),
      icon,
      ...(customIconDataUrl ? { customIconDataUrl } : {}),
      enabled,
      order
    })
  })

  return destinations
}
