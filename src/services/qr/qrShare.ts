import type { BrandConfig, QrDesignConfig } from '@/types/project'
import { escapeMarkup } from '@/lib/escapeMarkup'
import { validateUrl } from '@/lib/validation'

/**
 * Thrown when a URL that is about to be written into a link (an `href`, an
 * SVG hyperlink, an email block) is not an absolute http(s) URL.
 */
export class UnsafeShareUrlError extends Error {}

/**
 * The single gate every link-bearing export passes its URL through — the
 * "Copy for Email" block, the Digital QR HTML, and the hyperlinked SVGs.
 * Builds on the app's existing validation rules (`validateUrl`, the
 * http/https allowlist — javascript:, data:, vbscript: and everything else
 * are rejected there) and additionally requires an *absolute* URL that the
 * platform's own URL parser accepts, because `validateUrl` deliberately
 * tolerates a bare `example.com` paste and a share link never should be one.
 *
 * Returns the URL unchanged: it must remain byte-identical to what the QR
 * encodes, so it is validated, never re-normalized.
 */
export function assertSafeShareUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeShareUrlError('The QR link is not a valid absolute URL.')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || !validateUrl(url).valid) {
    throw new UnsafeShareUrlError('Only http(s) links can be shared.')
  }
  return url
}

export interface EmailQrInput {
  brand: Pick<BrandConfig, 'companyName' | 'tagline'>
  designConfig: Pick<QrDesignConfig, 'headline'>
  /** The URL the QR encodes — from `getQrShareUrl`, never a destination. */
  shareUrl: string
  /** `data:image/png;base64,…` of the QR-only image. */
  qrPngDataUrl: string
}

export interface EmailQrContent {
  html: string
  /** Plain-text alternative, for clipboards/targets that don't take HTML. */
  text: string
}

/** Only the exact shape the app itself produces — never an arbitrary `src`. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * Rendered size in the email; the PNG itself is generated at ≥2x this so it
 * stays crisp on high-DPI screens. 300 rather than something smaller
 * because a dense (static) QR has ~3px modules at its native size — shown
 * at 240px the modules drop to ~1.5px and stopped decoding in testing.
 */
export const EMAIL_QR_DISPLAY_SIZE = 300

/**
 * The PNG edge length to rasterize a QR's SVG at: the smallest *whole
 * multiple* of its native size that reaches `target`. qr-code-styling
 * floors every module to whole pixels at native size, so a non-integer
 * scale (say 1.25x) resamples every module edge — measurably blurrier,
 * and (because anti-aliased edges compress badly) a larger file.
 */
export function integerScaleSize(target: number, native: number): number {
  const base = native > 0 ? native : 480
  return base * Math.max(1, Math.ceil(target / base))
}

/** Reads the intrinsic pixel size qr-code-styling stamped on its SVG (`width="480"`); 480 if absent. */
export function nativeQrSize(svgMarkup: string): number {
  const match = /<svg\b[^>]*?\swidth="(\d+(?:\.\d+)?)"/.exec(svgMarkup)
  const value = match ? Number(match[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : 480
}
export const EMAIL_CTA_TEXT = 'Scan or click to explore'

/**
 * Builds the paste-ready email block: company name, optional tagline (or
 * headline), the QR image **inside a real `<a href>`**, and a linked call to
 * action. A raster image cannot itself carry a hyperlink — the link is the
 * anchor around it, which is why this is an HTML fragment and not a file.
 * The CTA text is a second, plain text link on purpose: mail clients that
 * block or strip embedded images still leave the recipient a working link.
 *
 * Email-client conventions followed on purpose: table layout with
 * `role="presentation"`, inline styles only (no `<style>`, no classes),
 * explicit `width`/`height` attributes on the image plus `border="0"` and
 * `display:block` (Outlook's Word-based renderer ignores CSS-only sizing),
 * real `alt` text, and a self-contained `data:` PNG so nothing depends on a
 * local file path or a remote host.
 *
 * Every piece of user text is escaped; the href is validated by
 * `assertSafeShareUrl`; the image source must be a PNG data URI of the exact
 * shape this app generates. Nothing here ever receives a management token.
 */
export function buildEmailQrContent(input: EmailQrInput): EmailQrContent {
  const href = escapeMarkup(assertSafeShareUrl(input.shareUrl))
  if (!PNG_DATA_URL.test(input.qrPngDataUrl)) {
    throw new Error('The QR image is not a PNG data URI.')
  }

  const company = input.brand.companyName.trim()
  const subtitle = (input.brand.tagline ?? '').trim() || input.designConfig.headline.trim()
  const alt = escapeMarkup(company ? `QR code for ${company} — ${EMAIL_CTA_TEXT.toLowerCase()}` : `QR code — ${EMAIL_CTA_TEXT.toLowerCase()}`)
  const font = 'font-family:Arial,Helvetica,sans-serif;'
  const size = EMAIL_QR_DISPLAY_SIZE

  const rows: string[] = []
  if (company) {
    rows.push(
      `<tr><td align="center" style="${font}font-size:20px;line-height:26px;font-weight:bold;color:#141417;padding:0 0 4px 0;">${escapeMarkup(company)}</td></tr>`
    )
  }
  if (subtitle) {
    rows.push(`<tr><td align="center" style="${font}font-size:14px;line-height:20px;color:#55555f;padding:0 0 12px 0;">${escapeMarkup(subtitle)}</td></tr>`)
  }
  rows.push(
    // font-size/line-height 0 on the image cell: an inline <a> wrapping a block image otherwise leaves an empty line box (a visible gap) in most clients.
    `<tr><td align="center" style="padding:0 0 10px 0;font-size:0;line-height:0;"><a href="${href}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">` +
      `<img src="${input.qrPngDataUrl}" width="${size}" height="${size}" alt="${alt}" border="0" style="display:block;border:0;width:${size}px;height:${size}px;background:#ffffff;" />` +
      `</a></td></tr>`
  )
  rows.push(
    `<tr><td align="center" style="${font}font-size:14px;line-height:20px;padding:0;"><a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#3b2fd1;text-decoration:underline;">${escapeMarkup(EMAIL_CTA_TEXT)}</a></td></tr>`
  )

  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:collapse;margin:0 auto;text-align:center;">${rows.join('')}</table>`

  const text = [company, subtitle, `${EMAIL_CTA_TEXT}: ${input.shareUrl}`].filter(Boolean).join('\n')
  return { html, text }
}

/**
 * How the block ended up on the clipboard — surfaced to the user so the
 * message is honest about what they can expect when pasting.
 * - `rich`         — async Clipboard API wrote `text/html` (+ plain text).
 * - `selection`    — legacy copy of a selected, rendered copy of the block
 *                    (older browsers / non-secure contexts).
 * - `source-text`  — only the HTML *source* could be copied as text.
 * - `failed`       — nothing could be written; the caller shows the HTML so
 *                    it can be copied by hand.
 */
export type EmailCopyOutcome = { method: 'rich' | 'selection' | 'source-text' } | { method: 'failed'; html: string }

function copyHtmlViaSelection(html: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const host = document.createElement('div')
  host.setAttribute('contenteditable', 'true')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;'
  // `html` is generated by buildEmailQrContent above: every user string is
  // escaped and the only image source is a validated PNG data URI.
  host.innerHTML = html
  document.body.appendChild(host)
  const selection = window.getSelection()
  let copied = false
  try {
    const range = document.createRange()
    range.selectNodeContents(host)
    selection?.removeAllRanges()
    selection?.addRange(range)
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    selection?.removeAllRanges()
    host.remove()
  }
  return copied
}

async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Puts the email block on the clipboard as rich HTML, degrading gracefully:
 * async Clipboard API → selection-based copy → HTML source as text → a
 * `failed` outcome carrying the HTML so the UI can offer it for manual copy.
 * Never silently does nothing.
 *
 * `getContent` is invoked immediately and its promise handed to the
 * ClipboardItem (rather than awaited first) — Safari only allows a
 * clipboard write during the click's user-activation window, and the QR
 * rasterization inside `getContent` is async.
 *
 * Rejects only if `getContent` itself fails (e.g. the QR isn't ready).
 */
export async function copyEmailQr(getContent: () => Promise<EmailQrContent>): Promise<EmailCopyOutcome> {
  const contentPromise = getContent()
  // Attach a handler now so a rejection can't surface as "unhandled" while
  // the clipboard tiers below are still running; it's re-thrown by the await.
  contentPromise.catch(() => undefined)

  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (ClipboardItemCtor && typeof navigator !== 'undefined' && navigator.clipboard?.write) {
    try {
      const htmlBlob = contentPromise.then((c) => new Blob([c.html], { type: 'text/html' }))
      const textBlob = contentPromise.then((c) => new Blob([c.text], { type: 'text/plain' }))
      // Both derived promises are consumed by the browser inside `write()`,
      // but if it bails out early one of them can be left rejected with no
      // handler attached — the real error is re-thrown by the await below.
      htmlBlob.catch(() => undefined)
      textBlob.catch(() => undefined)
      const item = new ClipboardItemCtor({ 'text/html': htmlBlob, 'text/plain': textBlob })
      await navigator.clipboard.write([item])
      return { method: 'rich' }
    } catch {
      // Fall through to the legacy tiers.
    }
  }

  const content = await contentPromise
  if (copyHtmlViaSelection(content.html)) return { method: 'selection' }
  if (await copyPlainText(content.html)) return { method: 'source-text' }
  return { method: 'failed', html: content.html }
}
