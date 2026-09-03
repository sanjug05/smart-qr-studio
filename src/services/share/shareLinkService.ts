import type { QRProject } from '@/types/project'
import { buildShareablePayload, encodeSharePayload } from './sharePayload'

/**
 * Every "what URL does this QR encode" decision in the app goes through
 * here — QR generation, "Copy QR Link", the PNG/SVG downloads, and the
 * project-list "Copy link" action all call `getShareUrl`, never construct
 * a URL themselves. That's deliberate: it's the seam where V1's
 * encode-everything-into-the-URL strategy can be swapped for a real
 * backend later (V2: POST the project, get back a short ID-based URL)
 * without touching any of those call sites — see README → "Future
 * migration off self-contained links".
 *
 * The `p.` prefix distinguishes this from the legacy plain-slug format
 * (`#/q/<8-char-hex>`, resolved via localStorage) that QR codes generated
 * before this feature existed still use — see src/pages/Landing.tsx for
 * the corresponding dispatch. A short unambiguous prefix character (`.`
 * never appears in base64url output) means no fragile length/pattern
 * guessing is needed to tell the two formats apart.
 */
const SHARE_TOKEN_PREFIX = 'p.'

/**
 * Dynamic QR's own unambiguous prefix, added alongside `p.` (static) and
 * the legacy plain slug — never replacing either. Same reasoning as the
 * comment above: a short prefix that can't appear in the other two
 * formats means Landing.tsx can dispatch on it directly, with no
 * length/pattern guessing (see README → "Static/Dynamic resolution").
 */
const DYNAMIC_TOKEN_PREFIX = 'd.'

export function getShareUrl(project: QRProject): string {
  const payload = buildShareablePayload(project)
  const token = SHARE_TOKEN_PREFIX + encodeSharePayload(payload)
  const base = window.location.origin + import.meta.env.BASE_URL
  return `${base}#/q/${token}`
}

/**
 * The permanent Dynamic QR URL — encodes only `publicId`, never any
 * destination data. This is what actually gets printed; the backend is
 * consulted fresh on every scan (see src/services/dynamicQr).
 */
export function getDynamicShareUrl(publicId: string): string {
  const base = window.location.origin + import.meta.env.BASE_URL
  return `${base}#/q/${DYNAMIC_TOKEN_PREFIX}${publicId}`
}

export function isShareToken(token: string): boolean {
  return token.startsWith(SHARE_TOKEN_PREFIX)
}

export function stripShareTokenPrefix(token: string): string {
  return token.slice(SHARE_TOKEN_PREFIX.length)
}

export function isDynamicShareToken(token: string): boolean {
  return token.startsWith(DYNAMIC_TOKEN_PREFIX)
}

export function stripDynamicShareTokenPrefix(token: string): string {
  return token.slice(DYNAMIC_TOKEN_PREFIX.length)
}
