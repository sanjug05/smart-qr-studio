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
  createdAt: string
  updatedAt: string
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

export function createNewProject(): QRProject {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    slug: generateSlug(),
    brand: createDefaultBrand(),
    destinations: createDefaultDestinations(),
    qrStyle: createDefaultQRStyle(),
    createdAt: now,
    updatedAt: now
  }
}

export function generateSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}
