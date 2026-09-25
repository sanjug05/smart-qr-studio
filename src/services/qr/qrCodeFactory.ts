import QRCodeStyling, { type Options as QRCodeStylingOptions } from 'qr-code-styling'
import type { QRProject } from '@/types/project'
import { resolveBranding, moduleStyleToCornerDotType, moduleStyleToCornerSquareType, moduleStyleToDotType, type EffectiveBranding } from './branding'
import { getQrShareUrl, DynamicQrNotProvisionedError } from '@/services/share/shareLinkService'

// Re-exported so existing importers (generateVerifiedQr.ts) keep working
// unchanged — the class itself now lives next to the canonical URL helper.
export { DynamicQrNotProvisionedError }

export interface BuildQrResult {
  instance: QRCodeStyling
  branding: EffectiveBranding
  data: string
}

/**
 * What the QR encodes is decided in exactly one place —
 * `getQrShareUrl` (see shareLinkService.ts). Static projects are unchanged;
 * a dynamic project encodes its permanent publicId, so editing destinations
 * later never requires touching this URL or the printed artwork again.
 */
const resolveQrTargetUrl = getQrShareUrl

/**
 * Builds a ready-to-render QRCodeStyling instance for a project. Always
 * uses error-correction level "H" (~30% recoverable) — the safety margin
 * that makes any center branding tolerable at all. `brandingOverride`
 * lets the validation/fallback loop (see qrValidation.ts) retry with a
 * smaller branding footprint without re-deriving it from scratch.
 *
 * `data` is the self-contained share URL (see shareLinkService.ts), not a
 * short slug — the QR must resolve on a device that has never talked to
 * this browser's localStorage. That makes `data` meaningfully longer than
 * a plain link, which is exactly why the scan-reliability verification in
 * generateVerifiedQr.ts matters more here than it would for a short URL.
 */
export function buildQr(project: QRProject, brandingOverride?: EffectiveBranding): BuildQrResult {
  const data = resolveQrTargetUrl(project)
  const { qrStyle, brand } = project

  const branding =
    brandingOverride ??
    resolveBranding(qrStyle.brandingStyle, brand.companyName, qrStyle.brandingLogoDataUrl ?? brand.logoDataUrl, qrStyle.foregroundColor)

  const options: Partial<QRCodeStylingOptions> = {
    width: qrStyle.size,
    height: qrStyle.size,
    type: 'svg',
    data,
    margin: qrStyle.quietZone,
    qrOptions: {
      errorCorrectionLevel: 'H'
    },
    image: branding.image || undefined,
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: branding.imageSize || 0,
      margin: 4,
      crossOrigin: 'anonymous'
    },
    dotsOptions: {
      color: qrStyle.foregroundColor,
      type: moduleStyleToDotType(qrStyle.moduleStyle)
    },
    backgroundOptions: {
      color: qrStyle.transparentBackground ? 'transparent' : qrStyle.backgroundColor
    },
    cornersSquareOptions: {
      color: qrStyle.foregroundColor,
      type: moduleStyleToCornerSquareType(qrStyle.moduleStyle)
    },
    cornersDotOptions: {
      color: qrStyle.foregroundColor,
      type: moduleStyleToCornerDotType(qrStyle.moduleStyle)
    }
  }

  return { instance: new QRCodeStyling(options as QRCodeStylingOptions), branding, data }
}
