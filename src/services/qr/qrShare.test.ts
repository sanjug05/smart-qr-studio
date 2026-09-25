import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  assertSafeShareUrl,
  buildEmailQrContent,
  copyEmailQr,
  integerScaleSize,
  nativeQrSize,
  UnsafeShareUrlError,
  EMAIL_CTA_TEXT,
  EMAIL_QR_DISPLAY_SIZE,
  type EmailQrContent
} from './qrShare'
import { getQrShareUrl } from '@/services/share/shareLinkService'
import { dynamicQrAuthorizationService } from '@/services/dynamicQr/dynamicQrAuthorizationService'
import {
  staticProject,
  dynamicProject,
  readBlobText,
  TINY_PNG_DATA_URL,
  SECRET_DESTINATION,
  DYNAMIC_PUBLIC_ID,
  FAKE_MANAGEMENT_TOKEN
} from '@/test/fixtures'

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function emailFor(project = staticProject(), overrides: { qrPngDataUrl?: string } = {}) {
  return buildEmailQrContent({
    brand: project.brand,
    designConfig: project.designConfig!,
    shareUrl: getQrShareUrl(project),
    qrPngDataUrl: overrides.qrPngDataUrl ?? TINY_PNG_DATA_URL
  })
}

describe('assertSafeShareUrl — the existing http(s) allowlist stays authoritative', () => {
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com/x'])(
    'rejects %s',
    (url) => {
      expect(() => assertSafeShareUrl(url)).toThrow(UnsafeShareUrlError)
    }
  )

  it.each(['example.com', '/relative/path', '#/q/d.abc', '', '   '])('rejects a non-absolute value: %j', (url) => {
    expect(() => assertSafeShareUrl(url)).toThrow(UnsafeShareUrlError)
  })

  it('accepts real share links and returns them byte-for-byte unchanged (never re-normalized)', () => {
    for (const project of [staticProject(), dynamicProject()]) {
      const url = getQrShareUrl(project)
      expect(assertSafeShareUrl(url)).toBe(url)
    }
  })
})

describe('buildEmailQrContent — the "Copy for Email" block', () => {
  it('wraps the QR image in a real <a href> pointing at the QR URL', () => {
    const project = staticProject()
    const url = getQrShareUrl(project)
    const doc = parse(emailFor(project).html)

    const img = doc.querySelector('img')!
    const anchor = img.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(url)
    expect(img.getAttribute('src')).toBe(TINY_PNG_DATA_URL)
  })

  it('is self-contained: data-URI image, inline styles only, no scripts, no external resources', () => {
    const { html } = emailFor()
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<style/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/\son\w+=/i)
    const doc = parse(html)
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('src')!.startsWith('data:image/png;base64,')).toBe(true)
    }
  })

  it('email-client hygiene: table layout, explicit image size, border=0, alt text', () => {
    const doc = parse(emailFor().html)
    expect(doc.querySelector('table[role="presentation"]')).not.toBeNull()
    const img = doc.querySelector('img')!
    expect(img.getAttribute('width')).toBe(String(EMAIL_QR_DISPLAY_SIZE))
    expect(img.getAttribute('height')).toBe(String(EMAIL_QR_DISPLAY_SIZE))
    expect(img.getAttribute('style')).toContain(`width:${EMAIL_QR_DISPLAY_SIZE}px`)
    expect(img.getAttribute('border')).toBe('0')
    expect(img.getAttribute('alt')).toMatch(/QR code/i)
  })

  it('includes company name, tagline, and a second plain text link as the CTA (survives image blocking)', () => {
    const project = staticProject()
    const url = getQrShareUrl(project)
    const doc = parse(emailFor(project).html)
    expect(doc.body.textContent).toContain('GreenLeaf Café')
    expect(doc.body.textContent).toContain('Fresh. Local.')
    const ctaLink = Array.from(doc.querySelectorAll('a')).find((a) => a.textContent === EMAIL_CTA_TEXT)
    expect(ctaLink).toBeDefined()
    expect(ctaLink!.getAttribute('href')).toBe(url)
  })

  it('falls back to the headline when there is no tagline, and omits name/subtitle rows when empty', () => {
    const project = staticProject()
    project.brand.tagline = ''
    project.designConfig = { ...project.designConfig!, headline: 'Scan to Explore' }
    expect(parse(emailFor(project).html).body.textContent).toContain('Scan to Explore')

    const bare = staticProject()
    bare.brand.companyName = ''
    bare.brand.tagline = ''
    bare.designConfig = { ...bare.designConfig!, headline: '' }
    const doc = parse(emailFor(bare).html)
    expect(doc.querySelector('img')!.closest('a')).not.toBeNull()
    expect(doc.body.textContent).not.toContain('undefined')
  })

  it('escapes user-controlled text — no HTML injection through company name, tagline, or headline', () => {
    const project = staticProject()
    project.brand.companyName = '<img src=x onerror=alert(1)>"\'&Co'
    project.brand.tagline = '<script>alert(2)</script>'
    const { html } = emailFor(project)
    const doc = parse(html)
    expect(html).not.toContain('<script>alert(2)')
    expect(doc.querySelectorAll('img')).toHaveLength(1) // only the QR, not the injected one
    expect(doc.querySelector('[onerror]')).toBeNull()
    expect(doc.body.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('refuses unsafe hrefs: javascript:, data:, vbscript:', () => {
    for (const shareUrl of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(() =>
        buildEmailQrContent({ brand: { companyName: 'X' }, designConfig: { headline: '' }, shareUrl, qrPngDataUrl: TINY_PNG_DATA_URL })
      ).toThrow(UnsafeShareUrlError)
    }
  })

  it('refuses an image source that is not a PNG data URI (no arbitrary src)', () => {
    for (const qrPngDataUrl of ['https://evil.example/x.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA" onload="x']) {
      expect(() => emailFor(staticProject(), { qrPngDataUrl })).toThrow()
    }
  })

  it('Dynamic: links to the permanent URL and contains no destination URL anywhere', () => {
    const project = dynamicProject()
    const { html, text } = emailFor(project)
    const doc = parse(html)
    expect(doc.querySelector('img')!.closest('a')!.getAttribute('href')).toMatch(new RegExp(`#/q/d\\.${DYNAMIC_PUBLIC_ID}$`))
    expect(html).not.toContain('secret-destination')
    expect(html).not.toContain(SECRET_DESTINATION)
    expect(text).not.toContain('secret-destination')
    expect(html).not.toContain('#/q/p.')
  })

  it('never contains the management token, even when one is stored for this Dynamic QR', () => {
    dynamicQrAuthorizationService.storeToken(DYNAMIC_PUBLIC_ID, FAKE_MANAGEMENT_TOKEN)
    try {
      const { html, text } = emailFor(dynamicProject())
      expect(html).not.toContain(FAKE_MANAGEMENT_TOKEN)
      expect(text).not.toContain(FAKE_MANAGEMENT_TOKEN)
      expect(html.toLowerCase()).not.toContain('bearer')
    } finally {
      dynamicQrAuthorizationService.clearToken(DYNAMIC_PUBLIC_ID)
    }
  })

  it('plain-text alternative carries the name and the link', () => {
    const project = staticProject()
    const { text } = emailFor(project)
    expect(text).toContain('GreenLeaf Café')
    expect(text).toContain(getQrShareUrl(project))
  })
})

describe('PNG scaling helpers — always a whole multiple of the QR native size (no blurry module edges)', () => {
  it('rounds the target UP to the next whole multiple of the native size', () => {
    expect(integerScaleSize(1200, 480)).toBe(1440)
    expect(integerScaleSize(600, 480)).toBe(960)
    expect(integerScaleSize(1200, 300)).toBe(1200)
    expect(integerScaleSize(1200, 1024)).toBe(2048)
  })
  it('never scales below 1x, and tolerates a bad native size', () => {
    expect(integerScaleSize(100, 480)).toBe(480)
    expect(integerScaleSize(1200, 0)).toBe(1440)
    expect(integerScaleSize(1200, -5)).toBe(1440)
  })
  it('reads the native size from the SVG width attribute, defaulting to 480', () => {
    expect(nativeQrSize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"></svg>')).toBe(640)
    expect(nativeQrSize('<?xml version="1.0"?>\n<svg width="480" height="480"></svg>')).toBe(480)
    expect(nativeQrSize('<svg viewBox="0 0 10 10"></svg>')).toBe(480)
    expect(nativeQrSize('not svg')).toBe(480)
  })
})

describe('copyEmailQr — clipboard tiers and graceful fallback', () => {
  const content: EmailQrContent = { html: '<table><tr><td><a href="https://x.test/"><img src="data:image/png;base64,AAAA"></a></td></tr></table>', text: 'plain' }
  const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem
  const originalExec = document.execCommand

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
  }

  afterEach(() => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem
    document.execCommand = originalExec
    setClipboard(undefined)
  })

  class FakeClipboardItem {
    constructor(public items: Record<string, Promise<Blob>>) {}
  }

  it("tier 1 'rich': writes text/html AND text/plain through the async Clipboard API", async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem
    let written: FakeClipboardItem | undefined
    setClipboard({
      write: vi.fn(async (items: FakeClipboardItem[]) => {
        written = items[0]
      }),
      writeText: vi.fn()
    })

    const outcome = await copyEmailQr(async () => content)
    expect(outcome).toEqual({ method: 'rich' })
    expect(await readBlobText(await written!.items['text/html'])).toBe(content.html)
    expect(await readBlobText(await written!.items['text/plain'])).toBe('plain')
  })

  it("tier 2 'selection': used when the async API is unavailable; copies a rendered copy, then cleans up", async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined
    const exec = vi.fn(() => {
      // While the command runs, the selection must contain the rendered link+image.
      expect(document.getSelection()?.toString()).toBeDefined()
      expect(document.querySelector('[contenteditable="true"] a[href="https://x.test/"] img')).not.toBeNull()
      return true
    })
    document.execCommand = exec as unknown as typeof document.execCommand

    expect(await copyEmailQr(async () => content)).toEqual({ method: 'selection' })
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('[contenteditable="true"]')).toBeNull()
  })

  it("falls from a failing async write to tier 2 instead of failing silently", async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem
    setClipboard({ write: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))), writeText: vi.fn() })
    document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand

    expect(await copyEmailQr(async () => content)).toEqual({ method: 'selection' })
  })

  it("tier 3 'source-text': copies the HTML source as text when rich copy is impossible", async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })

    expect(await copyEmailQr(async () => content)).toEqual({ method: 'source-text' })
    expect(writeText).toHaveBeenCalledWith(content.html)
  })

  it("'failed': returns the HTML so the UI can offer it for manual copy — never a silent no-op", async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) })

    expect(await copyEmailQr(async () => content)).toEqual({ method: 'failed', html: content.html })
  })

  it('rejects (rather than reporting a false success) when the content itself cannot be prepared', async () => {
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem
    setClipboard({ write: vi.fn(async (items: FakeClipboardItem[]) => { await items[0].items['text/html'] }), writeText: vi.fn() })
    document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand

    await expect(copyEmailQr(async () => Promise.reject(new Error('QR not ready')))).rejects.toThrow('QR not ready')
  })
})
