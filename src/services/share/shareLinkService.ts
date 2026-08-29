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

export function getShareUrl(project: QRProject): string {
  const payload = buildShareablePayload(project)
  const token = SHARE_TOKEN_PREFIX + encodeSharePayload(payload)
  const base = window.location.origin + import.meta.env.BASE_URL
  return `${base}#/q/${token}`
}

export function isShareToken(token: string): boolean {
  return token.startsWith(SHARE_TOKEN_PREFIX)
}

export function stripShareTokenPrefix(token: string): string {
  return token.slice(SHARE_TOKEN_PREFIX.length)
}
