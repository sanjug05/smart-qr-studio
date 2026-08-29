import type { QRProject } from '@/types/project'
import { buildQr, type BuildQrResult } from './qrCodeFactory'
import { stepDownBranding } from './branding'
import { validateQrScannable } from './qrValidation'

export interface VerifiedQrResult {
  result: BuildQrResult
  verified: boolean
  fallbackApplied: boolean
  message?: string
}

const MAX_ATTEMPTS = 4

/**
 * Generates a QR for the project, then verifies it decodes correctly by
 * round-tripping it through an independent decoder. If verification fails
 * — the branding image is obscuring too much of the code — the branding
 * footprint is automatically shrunk and retried, and finally dropped
 * entirely, rather than shipping an attractive but unreliable default.
 *
 * We do not claim the result is guaranteed to scan under every real-world
 * camera/lighting condition; this only proves the encoded bitmap is
 * decodable by a standards-compliant reader.
 */
export async function generateVerifiedQr(project: QRProject): Promise<VerifiedQrResult> {
  let built = buildQr(project)
  let attempts = 0
  let fallbackApplied = false

  while (attempts < MAX_ATTEMPTS) {
    const validation = await validateQrScannable(built.instance, built.data)
    if (validation.ok) {
      return {
        result: built,
        verified: true,
        fallbackApplied,
        message: fallbackApplied
          ? 'Branding was automatically simplified to keep the QR reliably scannable.'
          : built.branding.note
      }
    }

    const smaller = stepDownBranding(built.branding)
    attempts += 1
    fallbackApplied = true

    if (!smaller) {
      built = buildQr(project, { imageSize: 0 })
      const finalCheck = await validateQrScannable(built.instance, built.data)
      return {
        result: built,
        verified: finalCheck.ok,
        fallbackApplied: true,
        message: finalCheck.ok
          ? 'QR branding was too aggressive and has been removed to keep the code scannable.'
          : 'QR branding is too aggressive. Please reduce the branding area or use a simpler style.'
      }
    }

    built = buildQr(project, smaller)
  }

  return {
    result: built,
    verified: false,
    fallbackApplied,
    message: 'QR branding is too aggressive. Please reduce the branding area or use a simpler style.'
  }
}
