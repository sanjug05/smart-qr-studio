import type { QRProject } from '@/types/project'
import { buildQr, DynamicQrNotProvisionedError, type BuildQrResult } from './qrCodeFactory'
import { stepDownBranding } from './branding'
import { validateQrScannable } from './qrValidation'

export interface VerifiedQrResult {
  result: BuildQrResult | null
  verified: boolean
  fallbackApplied: boolean
  message?: string
  /** True only for a `qrMode: 'dynamic'` project with no publicId yet — see useDynamicQrProvisioning.ts. */
  notProvisioned?: boolean
}

const MAX_ATTEMPTS = 4
const DATA_TOO_LARGE_MESSAGE =
  'This QR contains too much data to generate reliably — try shortening destination URLs, labels, or descriptions.'

/**
 * Generates a QR for the project, then verifies it decodes correctly by
 * round-tripping it through an independent decoder. If verification fails
 * — the branding image is obscuring too much of the code — the branding
 * footprint is automatically shrunk and retried, and finally dropped
 * entirely, rather than shipping an attractive but unreliable default.
 *
 * Since the QR now encodes a full self-contained share payload rather
 * than a short slug (see shareLinkService.ts), `data` can be large enough
 * to occasionally fail for reasons that have nothing to do with branding —
 * either the underlying encoder throws outright ("code length overflow"
 * past QR version 40's capacity) or a branding-free code still fails
 * verification. Both are reported distinctly from the branding-fallback
 * messages so the user isn't told to simplify a logo that was never the
 * problem.
 *
 * We do not claim the result is guaranteed to scan under every real-world
 * camera/lighting condition; this only proves the encoded bitmap is
 * decodable by a standards-compliant reader.
 */
export async function generateVerifiedQr(project: QRProject): Promise<VerifiedQrResult> {
  let built: BuildQrResult
  try {
    built = buildQr(project)
  } catch (err) {
    if (err instanceof DynamicQrNotProvisionedError) {
      return { result: null, verified: false, fallbackApplied: false, notProvisioned: true }
    }
    return { result: null, verified: false, fallbackApplied: false, message: DATA_TOO_LARGE_MESSAGE }
  }

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

    if (built.branding.imageSize === 0) {
      // No branding was ever applied — a failure here is about the amount
      // of data being encoded, not about branding, so don't suggest
      // simplifying branding that was never on.
      return { result: built, verified: false, fallbackApplied, message: DATA_TOO_LARGE_MESSAGE }
    }

    const smaller = stepDownBranding(built.branding)
    attempts += 1
    fallbackApplied = true

    try {
      if (!smaller) {
        built = buildQr(project, { imageSize: 0 })
        const finalCheck = await validateQrScannable(built.instance, built.data)
        return {
          result: built,
          verified: finalCheck.ok,
          fallbackApplied: true,
          message: finalCheck.ok
            ? 'QR branding was too aggressive and has been removed to keep the code scannable.'
            : DATA_TOO_LARGE_MESSAGE
        }
      }
      built = buildQr(project, smaller)
    } catch {
      return { result: null, verified: false, fallbackApplied: true, message: DATA_TOO_LARGE_MESSAGE }
    }
  }

  return {
    result: built,
    verified: false,
    fallbackApplied,
    message: 'QR branding is too aggressive. Please reduce the branding area or use a simpler style.'
  }
}
