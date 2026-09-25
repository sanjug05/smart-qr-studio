import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type QRCodeStyling from 'qr-code-styling'
import { downloadQrOnlySvg, downloadQrOnlyPng } from './qrExport'
import { UnsafeShareUrlError } from './qrShare'
import { getQrShareUrl } from '@/services/share/shareLinkService'
import { dynamicProject, staticProject, readBlobText, SECRET_DESTINATION } from '@/test/fixtures'

/** Stand-in for the verified QR instance: `getRawData('svg')` returns a bare QR SVG, as the real library does. */
const BARE_QR_SVG = `<?xml version="1.0" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="#ffffff"/><path d="M16 16h32v32h-32z" fill="#141417"/></svg>`

function fakeInstance(): QRCodeStyling {
  return { getRawData: vi.fn(async () => new Blob([BARE_QR_SVG], { type: 'image/svg+xml' })) } as unknown as QRCodeStyling
}

describe('QR-only export — "Download QR"', () => {
  let downloads: Array<{ filename: string; blob?: Blob; href: string }>
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const blobs = new Map<string, Blob>()

  beforeEach(() => {
    downloads = []
    blobs.clear()
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      const url = `blob:test/${blobs.size}`
      blobs.set(url, blob as Blob)
      return url
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ filename: this.download, href: this.href, blob: blobs.get(this.href) })
    })
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks()
  })

  it('SVG: is ONLY the QR — no company name, tagline, CTA, frame, or footer text — and links to the QR URL', async () => {
    const project = staticProject()
    const url = getQrShareUrl(project)
    await downloadQrOnlySvg(fakeInstance(), project.brand.companyName, project.slug, url)

    expect(downloads).toHaveLength(1)
    expect(downloads[0].filename).toMatch(/-qr\.svg$/)
    expect(downloads[0].filename).not.toMatch(/smart-qr|designed/)
    const svg = await readBlobText(downloads[0].blob!)

    expect(svg).not.toContain('GreenLeaf')
    expect(svg).not.toContain('Fresh. Local.')
    expect(svg).not.toContain('Scan to')
    expect(svg).not.toContain('Powered by')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<image')
    expect(svg).toContain('d="M16 16h32v32h-32z"') // the code's own geometry is untouched

    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('a')!.getAttribute('href')).toBe(url)
  })

  it('SVG (Dynamic): hyperlink is the permanent d.<publicId> URL, never the destination', async () => {
    const project = dynamicProject()
    await downloadQrOnlySvg(fakeInstance(), project.brand.companyName, project.slug, getQrShareUrl(project))
    const svg = await readBlobText(downloads[0].blob!)
    expect(svg).toMatch(/#\/q\/d\.AbC123xyz789/)
    expect(svg).not.toContain('secret-destination')
    expect(svg).not.toContain(SECRET_DESTINATION)
  })

  it('SVG: refuses to write an unsafe link into the file', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'not a url']) {
      await expect(downloadQrOnlySvg(fakeInstance(), 'Co', 'slug', bad)).rejects.toBeInstanceOf(UnsafeShareUrlError)
    }
    expect(downloads).toHaveLength(0)
  })

  it('PNG: surfaces a clear error instead of silently doing nothing when the QR image cannot be rendered', async () => {
    // jsdom cannot decode an <img>; the real rasterization path is exercised in the browser verification.
    const Original = window.Image
    // @ts-expect-error minimal Image stand-in that fires onerror
    window.Image = class {
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.())
      }
      onload?: () => void
      onerror?: () => void
    }
    try {
      await expect(downloadQrOnlyPng(fakeInstance(), 'Co', 'slug')).rejects.toThrow(/Could not render the QR image/)
      expect(downloads).toHaveLength(0)
    } finally {
      window.Image = Original
    }
  })
})
