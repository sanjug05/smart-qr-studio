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

/**
 * Thrown for a `qrMode: 'dynamic'` project that hasn't been created on the
 * Dynamic QR backend yet (no `dynamicQr.publicId`). There is no meaningful
 * URL to encode or share until that happens — see useDynamicQr.ts, which is
 * what actually creates it. Distinguished from a generic failure so callers
 * (see generateVerifiedQr.ts) can show "creating your Dynamic QR…" instead
 * of a scary/wrong error message.
 */
export class DynamicQrNotProvisionedError extends Error {}

/**
 * THE canonical answer to "what URL does this project's QR encode?" — the
 * one function every display, download, copy, and email path consumes, so
 * no feature can drift into building its own URL:
 *
 * - Static  → the self-contained `p.<payload>` link (unchanged behavior).
 * - Dynamic → the permanent `d.<publicId>` link, never the current
 *   destinations and never anything derived from them.
 *
 * Deliberately takes only the project (no management token, no
 * destination URL anywhere in its output for a Dynamic QR). `getShareUrl`
 * and `getDynamicShareUrl` above remain the low-level builders; call sites
 * outside this file should use this instead of picking one themselves.
 *
 * @throws DynamicQrNotProvisionedError for a dynamic project with no publicId yet.
 */
export function getQrShareUrl(project: QRProject): string {
  if (project.qrMode === 'dynamic') {
    if (!project.dynamicQr?.publicId) throw new DynamicQrNotProvisionedError('This project has not been assigned a Dynamic QR identifier yet.')
    return getDynamicShareUrl(project.dynamicQr.publicId)
  }
  return getShareUrl(project)
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
