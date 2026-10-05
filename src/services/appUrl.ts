/**
 * The one place that decides the public base URL every QR link is built on
 * (see shareLinkService.ts) — e.g. `https://sanjugupta.com/qr/`.
 *
 * `VITE_PUBLIC_BASE_URL` (set in the production build) pins QR links to the
 * canonical production address even if the app is opened from another origin
 * (a preview deploy, the default Firebase domain, localhost). Without it the
 * current origin + the build's base path is used, which is right for local
 * development. Nothing else in the app hard-codes a domain.
 *
 * The result always ends in "/", so callers append `#/q/...` directly.
 */
export function getPublicBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_BASE_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
        return `${url.origin}${path}`
      }
    } catch {
      // A malformed override must never produce a broken QR — fall back to the current location.
    }
  }
  return window.location.origin + import.meta.env.BASE_URL
}
