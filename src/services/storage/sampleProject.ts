import type { QRProject } from '@/types/project'
import { createNewProject } from '@/types/project'
import { projectRepository } from './projectRepository'

/**
 * AIS is only a demonstration brand — nothing in the app depends on this
 * name. This factory exists purely so the product can be shown end-to-end
 * without a user typing in sample data first.
 */
export async function loadSampleAisProject(): Promise<QRProject> {
  const base = createNewProject()
  const project: QRProject = {
    ...base,
    brand: {
      companyName: 'AIS',
      tagline: 'Smart Access Solutions',
      primaryColor: '#0F2C59',
      secondaryColor: '#F2A71B',
      backgroundColor: '#FFFFFF'
    },
    destinations: [
      { id: crypto.randomUUID(), type: 'website', label: 'Website', url: 'https://example.com', description: 'Explore our products', icon: '🌐', enabled: true, order: 0 },
      { id: crypto.randomUUID(), type: 'location', label: 'Location', url: 'https://maps.google.com/', description: 'Find our showroom', icon: '📍', enabled: true, order: 1 },
      { id: crypto.randomUUID(), type: 'brochure', label: 'Brochure', url: 'https://example.com/brochure.pdf', description: 'Download our catalogue', icon: '📖', enabled: true, order: 2 },
      { id: crypto.randomUUID(), type: 'virtual-tour', label: 'Virtual Tour', url: 'https://example.com/tour', description: 'Take a 360° tour', icon: '🏠', enabled: true, order: 3 },
      { id: crypto.randomUUID(), type: 'custom', label: 'Contact Us', url: 'https://example.com/contact', description: 'Talk to our team', icon: '📞', enabled: true, order: 4 }
    ],
    qrStyle: {
      ...base.qrStyle,
      moduleStyle: 'rounded',
      foregroundColor: '#0F2C59',
      backgroundColor: '#FFFFFF',
      brandingStyle: 'initials'
    }
  }
  await projectRepository.save(project)
  return project
}
