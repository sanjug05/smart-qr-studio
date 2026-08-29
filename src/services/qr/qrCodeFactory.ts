import QRCodeStyling, { type Options as QRCodeStylingOptions } from 'qr-code-styling'
import type { QRProject } from '@/types/project'
import { resolveBranding, moduleStyleToCornerDotType, moduleStyleToCornerSquareType, moduleStyleToDotType, type EffectiveBranding } from './branding'
import { getLandingUrl } from './landingUrl'

export interface BuildQrResult {
  instance: QRCodeStyling
  branding: EffectiveBranding
  data: string
}

/**
 * Builds a ready-to-render QRCodeStyling instance for a project. Always
 * uses error-correction level "H" (~30% recoverable) — the safety margin
 * that makes any center branding tolerable at all. `brandingOverride`
 * lets the validation/fallback loop (see qrValidation.ts) retry with a
 * smaller branding footprint without re-deriving it from scratch.
 */
export function buildQr(project: QRProject, brandingOverride?: EffectiveBranding): BuildQrResult {
  const data = getLandingUrl(project)
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
