import type { QRProject } from '@/types/project'
import { createNewProject } from '@/types/project'

/** A destination URL no export/share path may ever contain for a Dynamic QR. */
export const SECRET_DESTINATION = 'https://secret-destination.example.org/landing'
export const DYNAMIC_PUBLIC_ID = 'AbC123xyz789'
export const FAKE_MANAGEMENT_TOKEN = 'MGMT-TOKEN-must-never-leave-the-auth-service'

/** A 1x1 PNG — the exact `data:image/png;base64,…` shape the app produces. */
export const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export function staticProject(overrides: Partial<QRProject> = {}): QRProject {
  const project = createNewProject()
  project.brand.companyName = 'GreenLeaf Café'
  project.brand.tagline = 'Fresh. Local.'
  project.destinations[0].url = SECRET_DESTINATION
  return { ...project, ...overrides }
}

export function dynamicProject(overrides: Partial<QRProject> = {}): QRProject {
  return staticProject({
    qrMode: 'dynamic',
    dynamicQr: { publicId: DYNAMIC_PUBLIC_ID, createdAt: new Date().toISOString() },
    ...overrides
  })
}

/** Reads a Blob as text (jsdom's Blob has no `.text()`). */
export function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
