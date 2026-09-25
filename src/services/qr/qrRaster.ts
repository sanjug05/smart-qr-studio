/**
 * The one place a bare QR's SVG is turned into pixels. Used by every raster
 * export — "Download QR", "Copy for Email", and the QR inside the "Smart QR"
 * PNG — so they all share the same rules:
 *
 * Callers pass an edge length that is a whole multiple of the QR's native
 * size (see `integerScaleSize` / `alignedPosterScale`). qr-code-styling
 * floors every module to whole pixels at native size, so an integer
 * multiple keeps every module the same integer number of pixels wide —
 * uniform module widths are what a decoder's sampling grid depends on. A
 * fractional scale (as the poster used to apply) resamples every module
 * edge, giving modules mixed widths and blurred boundaries.
 */

/** Decodes SVG markup into an <img>, rejecting with a clear error instead of hanging. */
export async function loadSvgImage(svgMarkup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render the QR image.'))
    })
    return img
  } finally {
    // Safe once decoded: the browser holds the decoded bitmap, not the URL.
    URL.revokeObjectURL(url)
  }
}

/**
 * Rasterizes the bare QR SVG onto a fresh square canvas of exactly `size`px.
 * Opaque white behind the code unless `transparent` (the QR Style step's
 * "Transparent background"), in which case the QR's own background — which
 * may itself be transparent — shows through untouched.
 */
export async function rasterizeQrSvg(svgMarkup: string, size: number, options: { transparent?: boolean } = {}): Promise<HTMLCanvasElement> {
  const img = await loadSvgImage(svgMarkup)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  if (!options.transparent) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
  }
  ctx.drawImage(img, 0, 0, size, size)
  return canvas
}
