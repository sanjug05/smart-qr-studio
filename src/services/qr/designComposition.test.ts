import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { alignedPosterScale, buildDesignedQrSvg, DESIGNED_PNG_TARGET_WIDTH } from './designComposition'
import { createDefaultDesignConfig } from '@/types/project'
import { staticProject } from '@/test/fixtures'

const QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect id="the-qr-marker" width="480" height="480"/></svg>`
const QR_BOX_UNITS = 580 // QR_PANEL_SIZE (700) - 2 * QR_PANEL_PADDING (60)

describe('alignedPosterScale — pixel-aligned Smart QR PNG sizing', () => {
  it('always lands the QR box on a whole multiple of its native size, for any native size', () => {
    for (const native of [200, 256, 300, 360, 400, 480, 512, 640, 800, 1000]) {
      const a = alignedPosterScale(native)
      expect(Number.isInteger(a.qrScale)).toBe(true)
      expect(a.qrScale).toBeGreaterThanOrEqual(1)
      expect(a.qrBoxPx).toBe(native * a.qrScale)
      // The poster layout scale is exactly the QR box's pixels per poster unit.
      expect(a.scale).toBeCloseTo(a.qrBoxPx / QR_BOX_UNITS, 10)
    }
  })

  it('never shrinks the QR below its native size', () => {
    expect(alignedPosterScale(2000).qrScale).toBe(1)
    expect(alignedPosterScale(2000).qrBoxPx).toBe(2000)
  })

  it('keeps the poster aspect ratio (1000 x 1414 units) and the same output size for the default 480px QR', () => {
    const a = alignedPosterScale(480)
    expect(a.qrScale).toBe(2)
    expect(a.width).toBe(1655)
    expect(a.height).toBe(2340)
    expect(Math.abs(a.height / a.width - 1.414)).toBeLessThan(0.001)
  })

  it('stays within a sane distance of the target width', () => {
    for (const native of [300, 360, 480, 640]) {
      const a = alignedPosterScale(native, DESIGNED_PNG_TARGET_WIDTH)
      expect(a.width).toBeGreaterThan(DESIGNED_PNG_TARGET_WIDTH * 0.6)
      expect(a.width).toBeLessThan(DESIGNED_PNG_TARGET_WIDTH * 1.5)
    }
  })
})

describe('buildDesignedQrSvg — omitQr', () => {
  const project = staticProject()
  // jsdom has no canvas; text measuring falls back to its estimate when there is no 2D context.
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
  afterEach(() => { vi.restoreAllMocks() })
  const input = { brand: project.brand, designConfig: createDefaultDesignConfig(), qrSvgMarkup: QR_SVG }

  it('draws the QR by default (SVG and Digital QR output are unchanged)', () => {
    expect(buildDesignedQrSvg(input)).toContain('the-qr-marker')
  })

  it('leaves the QR out but keeps every other element of the poster when omitQr is set', () => {
    const withQr = buildDesignedQrSvg(input)
    const without = buildDesignedQrSvg({ ...input, omitQr: true })
    expect(without).not.toContain('the-qr-marker')
    expect(without).toContain('Powered by Smart QR Studio')
    expect(without).toContain(project.brand.companyName)
    // Same poster otherwise: the only difference is the embedded QR.
    expect(without.length).toBeLessThan(withQr.length)
    expect(withQr.replace(/\s+/g, ' ')).toContain('<rect x="150" y="560" width="700" height="700"')
    expect(without.replace(/\s+/g, ' ')).toContain('<rect x="150" y="560" width="700" height="700"')
  })
})
