import jsQR from 'jsqr'
import type QRCodeStyling from 'qr-code-styling'

export interface QrValidationResult {
  ok: boolean
  decoded?: string
}

/**
 * Renders the QR to a raster image and runs it back through an independent
 * decoder (jsQR) to confirm it actually decodes to the expected URL. This
 * is the internal safety net required by the branding feature: a QR that
 * *looks* fine but scans wrong (or doesn't scan) must never be presented
 * as the default output.
 */
export async function validateQrScannable(instance: QRCodeStyling, expectedData: string): Promise<QrValidationResult> {
  try {
    const raw = await instance.getRawData('png')
    if (!raw) return { ok: false }
    const blob = raw instanceof Blob ? raw : new Blob([raw as BlobPart])
    const imageData = await blobToImageData(blob)
    const result = jsQR(imageData.data, imageData.width, imageData.height)
    return { ok: !!result && result.data === expectedData, decoded: result?.data }
  } catch {
    return { ok: false }
  }
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
