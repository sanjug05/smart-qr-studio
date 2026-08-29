import type { LandingContent, QRProject } from '@/types/project'
import { validateUrl } from '@/lib/validation'

/**
 * The self-contained shareable payload. A QR generated on one device must
 * resolve on any other device with no prior knowledge of the creator's
 * localStorage — this type is exactly (and only) what the customer landing
 * page needs to render itself, base64url-encoded straight into the QR's
 * own URL. See src/services/share/shareLinkService.ts for how this gets
 * turned into an actual link, and README → "Self-contained shareable QR"
 * for the full design rationale and size trade-offs.
 *
 * Field names are deliberately short (single/double letters) — every byte
 * here is a byte the QR has to physically encode, and QR capacity is the
 * binding constraint on scan reliability (see qrCodeFactory.ts).
 */
export interface ShareableDestination {
  l: string // label
  u: string // url
  i: string // icon (emoji or short glyph)
  de?: string // description
}

export interface ShareableQRPayload {
  v: 1 // schema version — bump and branch on this if the shape ever changes
  n: string // company name
  t?: string // tagline
  p: string // primary color
  s: string // secondary color
  bg: string // background color
  d: ShareableDestination[] // enabled, valid destinations only, in display order
}

const MAX_DESTINATIONS = 5

/**
 * Builds the minimal payload from a full project. Deliberately excludes:
 * - `brand.logoDataUrl` / `destination.customIconDataUrl` — these are
 *   uploaded images stored as base64 data URLs, often tens of KB. Embedding
 *   either would blow the QR's data capacity for no good reason. V1 has no
 *   image hosting, so there's no URL to reference instead — the landing
 *   page's existing initials-avatar fallback covers the gap. See README.
 * - disabled destinations, and anything beyond the first 5 enabled ones —
 *   they'd never be shown, so they're not worth the bytes.
 * - id/slug/qrStyle/timestamps — internal bookkeeping the landing page
 *   never reads.
 */
export function buildShareablePayload(project: QRProject): ShareableQRPayload {
  const destinations: ShareableDestination[] = project.destinations
    .filter((d) => d.enabled && validateUrl(d.url).valid)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_DESTINATIONS)
    .map((d) => ({
      l: d.label,
      u: d.url,
      i: d.icon,
      ...(d.description ? { de: d.description } : {})
    }))

  return {
    v: 1,
    n: project.brand.companyName,
    ...(project.brand.tagline ? { t: project.brand.tagline } : {}),
    p: project.brand.primaryColor,
    s: project.brand.secondaryColor,
    bg: project.brand.backgroundColor,
    d: destinations
  }
}

/** Turns a payload into the exact `LandingContent` the landing page renders. */
export function payloadToLandingContent(payload: ShareableQRPayload): LandingContent {
  return {
    brand: {
      companyName: payload.n,
      tagline: payload.t,
      primaryColor: payload.p,
      secondaryColor: payload.s,
      backgroundColor: payload.bg
    },
    destinations: payload.d.map((sd, index) => ({
      id: `d${index}`,
      label: sd.l,
      url: sd.u,
      description: sd.de,
      icon: sd.i,
      enabled: true,
      order: index
    }))
  }
}

export function encodeSharePayload(payload: ShareableQRPayload): string {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decodes and validates a share payload. Returns null for anything that
 * doesn't decode cleanly or doesn't pass the runtime shape/content check —
 * this is untrusted input straight from a URL a stranger's camera app
 * opened, so nothing here is assumed to be well-formed, and destination
 * URLs are re-validated against the same http/https allowlist as the
 * builder uses (a crafted `javascript:`/`data:` URL must not survive).
 */
export function decodeSharePayload(encoded: string): ShareableQRPayload | null {
  let json: string
  try {
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) base64 += '='
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    json = new TextDecoder().decode(bytes)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  return sanitizeSharePayload(parsed)
}

const HEX_COLOR = /^#?[0-9a-fA-F]{3,8}$/

function sanitizeSharePayload(value: unknown): ShareableQRPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.v !== 1) return null // unknown/future schema version — refuse to guess at its shape
  if (typeof raw.n !== 'string' || !raw.n.trim()) return null
  if (typeof raw.p !== 'string' || !HEX_COLOR.test(raw.p)) return null
  if (typeof raw.s !== 'string' || !HEX_COLOR.test(raw.s)) return null
  if (typeof raw.bg !== 'string' || !HEX_COLOR.test(raw.bg)) return null
  if (!Array.isArray(raw.d)) return null

  const destinations: ShareableDestination[] = []
  for (const item of raw.d) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    if (typeof d.l !== 'string' || !d.l.trim()) continue
    if (typeof d.u !== 'string' || !validateUrl(d.u).valid) continue
    const icon = typeof d.i === 'string' ? d.i : ''
    const description = typeof d.de === 'string' ? d.de : undefined
    destinations.push({ l: d.l, u: d.u, i: icon, ...(description ? { de: description } : {}) })
    if (destinations.length >= MAX_DESTINATIONS) break
  }

  if (destinations.length === 0) return null // nothing safe/valid left to show is the same as no payload

  return {
    v: 1,
    n: raw.n,
    ...(typeof raw.t === 'string' && raw.t ? { t: raw.t } : {}),
    p: raw.p,
    s: raw.s,
    bg: raw.bg,
    d: destinations
  }
}
