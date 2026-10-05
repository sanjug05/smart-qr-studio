import type { QRProject } from '@/types/project'
import { isValidProject } from '@/services/storage/projectRepository'

/**
 * The cloud representation of a project: configuration only. It never
 * contains a rendered QR image (PNG/SVG are regenerated on the client), a
 * management token, or an owner id (ownership is the document's path,
 * `users/{uid}/projects/{id}`, enforced by firestore.rules).
 *
 * Timestamps are epoch-millisecond integers (unambiguous for security rules
 * and cheap to compare); the local project keeps its ISO strings.
 */
export interface CloudProjectDoc {
  schemaVersion: 1
  id: string
  slug: string
  qrMode: 'static' | 'dynamic'
  brand: QRProject['brand']
  destinations: QRProject['destinations']
  qrStyle: QRProject['qrStyle']
  designConfig?: QRProject['designConfig']
  dynamicQr?: { publicId: string; createdAt: string }
  createdAt: number
  updatedAt: number
  version: number
  /** True when an uploaded logo/icon was too large to sync (the rest of the project is intact). */
  imagesOmitted?: boolean
}

/** Combined size of all embedded images (data URLs) allowed in one cloud project — keeps documents small and cheap. */
export const CLOUD_IMAGE_BUDGET_CHARS = 250_000

const toMillis = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isFinite(t) && t > 0 ? t : Date.now()
}

/** Builds the document to write for `project` at cloud revision `version`. Pure. */
export function toCloudDoc(project: QRProject, version: number): CloudProjectDoc {
  let remaining = CLOUD_IMAGE_BUDGET_CHARS
  let omitted = false
  const keepImage = (dataUrl: string | undefined): string | undefined => {
    if (!dataUrl) return undefined
    if (dataUrl.length <= remaining) {
      remaining -= dataUrl.length
      return dataUrl
    }
    omitted = true
    return undefined
  }

  const { logoDataUrl, ...brandRest } = project.brand
  const logo = keepImage(logoDataUrl)
  const brand = { ...brandRest, ...(logo ? { logoDataUrl: logo } : {}) }

  const { brandingLogoDataUrl, ...styleRest } = project.qrStyle
  const brandingLogo = keepImage(brandingLogoDataUrl)
  const qrStyle = { ...styleRest, ...(brandingLogo ? { brandingLogoDataUrl: brandingLogo } : {}) }

  const destinations = project.destinations.slice(0, 5).map((d) => {
    const { customIconDataUrl, ...rest } = d
    const icon = keepImage(customIconDataUrl)
    return { ...rest, ...(icon ? { customIconDataUrl: icon } : {}) }
  })

  const isDynamic = project.qrMode === 'dynamic' && Boolean(project.dynamicQr?.publicId)
  return {
    schemaVersion: 1,
    id: project.id,
    slug: project.slug,
    qrMode: isDynamic ? 'dynamic' : 'static',
    brand,
    destinations,
    qrStyle,
    ...(project.designConfig ? { designConfig: project.designConfig } : {}),
    ...(isDynamic && project.dynamicQr ? { dynamicQr: { publicId: project.dynamicQr.publicId, createdAt: project.dynamicQr.createdAt } } : {}),
    createdAt: toMillis(project.createdAt),
    updatedAt: toMillis(project.updatedAt),
    version,
    ...(omitted ? { imagesOmitted: true } : {})
  }
}

/** Rebuilds a local project from a cloud document, or null if it isn't a usable project. */
export function fromCloudDoc(raw: unknown): QRProject | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<CloudProjectDoc>
  if (typeof d.createdAt !== 'number' || typeof d.updatedAt !== 'number' || typeof d.version !== 'number') return null

  const updatedAt = new Date(d.updatedAt).toISOString()
  const project = {
    id: d.id,
    slug: d.slug,
    brand: d.brand,
    destinations: d.destinations,
    qrStyle: d.qrStyle,
    ...(d.designConfig ? { designConfig: d.designConfig } : {}),
    qrMode: d.qrMode === 'dynamic' ? 'dynamic' : 'static',
    ...(d.dynamicQr ? { dynamicQr: d.dynamicQr } : {}),
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt,
    cloud: { version: d.version, syncedAt: updatedAt }
  }
  return isValidProject(project) ? (project as QRProject) : null
}

/** True when the local copy has edits the cloud doesn't have yet. */
export function hasUnsavedChanges(project: QRProject): boolean {
  if (!project.cloud) return true
  return project.updatedAt > project.cloud.syncedAt
}

/** Marks `project` as in step with cloud revision `version` (what a successful cloud save produces). */
export function withCloudSync(project: QRProject, version: number): QRProject {
  return { ...project, cloud: { version, syncedAt: project.updatedAt } }
}
