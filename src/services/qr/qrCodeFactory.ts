import QRCodeStyling, { type Options as QRCodeStylingOptions } from 'qr-code-styling'
import type { QRProject } from '@/types/project'
import { resolveBranding, moduleStyleToCornerDotType, moduleStyleToCornerSquareType, moduleStyleToDotType, type EffectiveBranding } from './branding'
import { getShareUrl, getDynamicShareUrl } from '@/services/share/shareLinkService'

export interface BuildQrResult {
  instance: QRCodeStyling
  branding: EffectiveBranding
  data: string
}

/**
 * Thrown by buildQr() for a `qrMode: 'dynamic'` project that hasn't been
 * created on the Dynamic QR backend yet (no `dynamicQr.publicId`). There is
 * no meaningful URL to encode until that happens — see
 * useDynamicQrProvisioning.ts, which is what actually creates it and is
 * the only thing that should ever clear this state. Distinguished from a
 * generic build failure so callers (see generateVerifiedQr.ts) can show
 * "creating your Dynamic QR…" instead of a scary/wrong error message.
 */
export class DynamicQrNotProvisionedError extends Error {}

/**
 * Chooses what the QR actually encodes. Static projects are completely
 * unaffected — `getShareUrl` is exactly what ran before Dynamic QR
 * existed. A dynamic project instead encodes its permanent publicId, so
 * editing destinations later never requires touching this URL or the
 * printed artwork again (see README → "Dynamic QR architecture").
 */
function resolveQrTargetUrl(project: QRProject): string {
  if (project.qrMode === 'dynamic') {
    if (!project.dynamicQr?.publicId) throw new DynamicQrNotProvisionedError('This project has not been assigned a Dynamic QR identifier yet.')
    return getDynamicShareUrl(project.dynamicQr.publicId)
  }
  return getShareUrl(project)
}

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
