import type { QRProject } from '@/types/project'

/**
 * The QR code never encodes a destination URL directly — it always points
 * here. This indirection is what lets a printed QR code keep working after
 * destinations are edited later (see README → "Future dynamic QR
 * capability"). `import.meta.env.BASE_URL` carries the configured deploy
 * subpath, and HashRouter means no server-side rewrite rule is needed for
 * this route to survive a hard refresh.
 */
export function getLandingPath(slug: string): string {
  return `#/q/${slug}`
}

export function getLandingUrl(project: Pick<QRProject, 'slug'>): string {
  const base = window.location.origin + import.meta.env.BASE_URL
  return `${base}${getLandingPath(project.slug)}`
}
