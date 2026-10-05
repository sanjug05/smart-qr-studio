/**
 * Core data model. Kept storage-agnostic and free of any browser-only
 * assumptions so the same shapes work behind localStorage today and a
 * real backend/API later (see src/services/storage).
 */

export type ModuleStyle = 'square' | 'rounded' | 'dots'

export type BrandingStyle = 'none' | 'logo' | 'initials' | 'name' | 'custom'

export interface BrandConfig {
  companyName: string
  tagline?: string
  logoDataUrl?: string
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
}

export interface QRStyleConfig {
  moduleStyle: ModuleStyle
  size: number
  quietZone: number
  foregroundColor: string
  backgroundColor: string
  transparentBackground: boolean
  brandingStyle: BrandingStyle
  brandingLogoDataUrl?: string
}

/**
 * The three poster/card layouts the designed-QR export can use. Purely a
 * presentation choice — see src/services/qr/designTemplates.ts for what
 * each one actually looks like. Universal by construction: every field a
 * template reads (company name, logo, brand colors, tagline) already
 * exists on every project regardless of what kind of organization it is.
 */
export type QrDesignTemplateId = 'clean' | 'premium' | 'classic'

export interface QrDesignConfig {
  template: QrDesignTemplateId
  /** Shown above the QR. User-editable; never invented from nothing. */
  headline: string
  /** Shown below the QR as the scan instruction. User-editable. */
  ctaText: string
}

/**
 * Whether this project's QR is self-contained (`static`, the original
 * architecture — see sharePayload.ts) or resolves through the Dynamic QR
 * backend by a permanent identifier (`dynamic` — see
 * src/services/dynamicQr). Optional and defaulting to `static` for the
 * same backward-compatibility reason `designConfig` is optional: every
 * project saved before this feature existed lacks the field entirely, and
 * must keep behaving exactly as it always has (see README → "Migration
 * safety" — existing projects are never auto-converted).
 */
export type QrMode = 'static' | 'dynamic'

/**
 * Present once a Dynamic QR has actually been created on the backend
 * (see DynamicQrService.create). `publicId` is permanent — printed QR
 * artwork encodes it directly and must never be regenerated when it
 * changes. Deliberately does NOT include the management token — that is
 * looked up separately via `dynamicQrAuthorizationService`, keyed by
 * `publicId`, so a secret credential is never mixed into project data
 * that might later be exported/backed up (see Settings → "Export backup").
 */
export interface DynamicQrInfo {
  publicId: string
  createdAt: string
}

export type DestinationType = 'website' | 'location' | 'brochure' | 'virtual-tour' | 'custom'

export interface Destination {
  id: string
  type: DestinationType
  label: string
  url: string
  description?: string
  icon: string
  customIconDataUrl?: string
  enabled: boolean
  order: number
}

export interface QRProject {
  id: string
  slug: string
  brand: BrandConfig
  destinations: Destination[]
  qrStyle: QRStyleConfig
  /**
   * Optional because projects saved before this feature existed won't have
   * it — every read site falls back to `createDefaultDesignConfig()`
   * rather than assuming it's present. New projects always get one.
   */
  designConfig?: QrDesignConfig
  /** See QrMode. Absent on projects saved before Dynamic QR existed — every read site falls back to 'static'. */
  qrMode?: QrMode
  /** Present only once qrMode === 'dynamic' AND the Dynamic QR has actually been created on the backend. */
  dynamicQr?: DynamicQrInfo
  /**
   * Present only on a project that has been saved to the signed-in user's
   * cloud library (see src/services/cloud). `version` is the cloud revision
   * this local copy is based on; `syncedAt` is the `updatedAt` it had when it
   * was last in step with the cloud — a local `updatedAt` later than that
   * means unsaved changes. Never contains a credential.
   */
  cloud?: CloudSyncInfo
  createdAt: string
  updatedAt: string
}

export interface CloudSyncInfo {
  version: number
  syncedAt: string
}

export const DEFAULT_DESTINATION_ICONS: Record<DestinationType, string> = {
  website: '🌐',
  location: '📍',
  brochure: '📖',
  'virtual-tour': '🏠',
  custom: '📞'
}

export function createDefaultDestinations(): Destination[] {
  const defaults: Array<[DestinationType, string, string]> = [
    ['website', 'Website', 'https://example.com'],
    ['location', 'Location', 'https://maps.google.com/'],
    ['brochure', 'Brochure', 'https://example.com/brochure.pdf'],
    ['virtual-tour', 'Virtual Tour', 'https://example.com/tour'],
    ['custom', 'Contact Us', 'https://example.com/contact']
  ]
  return defaults.map(([type, label, url], index) => ({
    id: crypto.randomUUID(),
    type,
    label,
    url,
    description: '',
    icon: DEFAULT_DESTINATION_ICONS[type],
    enabled: true,
    order: index
  }))
}

export function createDefaultBrand(): BrandConfig {
  return {
    companyName: '',
    tagline: '',
    primaryColor: '#141417',
    secondaryColor: '#6D5EF9',
    backgroundColor: '#FFFFFF'
  }
}

export function createDefaultQRStyle(): QRStyleConfig {
  return {
    moduleStyle: 'rounded',
    size: 480,
    quietZone: 16,
    foregroundColor: '#141417',
    backgroundColor: '#FFFFFF',
    transparentBackground: false,
    brandingStyle: 'none'
  }
}

export function createDefaultDesignConfig(): QrDesignConfig {
  return {
    template: 'clean',
    headline: 'Scan to Explore',
    ctaText: 'Scan to explore'
  }
}

export function createNewProject(): QRProject {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    slug: generateSlug(),
    brand: createDefaultBrand(),
    destinations: createDefaultDestinations(),
    qrStyle: createDefaultQRStyle(),
    designConfig: createDefaultDesignConfig(),
    qrMode: 'static',
    createdAt: now,
    updatedAt: now
  }
}

export function generateSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Everything the customer landing page actually reads to render itself —
 * nothing more. A full `QRProject` satisfies this structurally (it has all
 * these fields and then some), and so does content reconstructed from a
 * decoded share payload (see src/services/share/sharePayload.ts), which
 * has no `id`/`slug`/`qrStyle`/timestamps at all. Keeping the landing view
 * scoped to this shape is what lets both sources render through the same
 * component with no adapter object pretending to be a full project.
 */
export interface LandingContent {
  brand: Pick<BrandConfig, 'companyName' | 'tagline' | 'logoDataUrl' | 'primaryColor' | 'secondaryColor' | 'backgroundColor'>
  destinations: Array<Pick<Destination, 'id' | 'label' | 'url' | 'description' | 'icon' | 'customIconDataUrl' | 'enabled' | 'order'>>
}

/**
 * Builds the exact payload a Dynamic QR create/update call sends — the
 * same `LandingContent` shape the landing page already renders, with
 * internal-only fields (e.g. `Destination.type`) explicitly left out
 * rather than forwarded to a backend that has no use for them.
 */
export function toLandingContent(project: Pick<QRProject, 'brand' | 'destinations'>): LandingContent {
  return {
    brand: {
      companyName: project.brand.companyName,
      tagline: project.brand.tagline,
      logoDataUrl: project.brand.logoDataUrl,
      primaryColor: project.brand.primaryColor,
      secondaryColor: project.brand.secondaryColor,
      backgroundColor: project.brand.backgroundColor
    },
    destinations: project.destinations.map((d) => ({
      id: d.id,
      label: d.label,
      url: d.url,
      description: d.description,
      icon: d.icon,
      customIconDataUrl: d.customIconDataUrl,
      enabled: d.enabled,
      order: d.order
    }))
  }
}
