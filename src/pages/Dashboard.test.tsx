import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import type { QRProject } from '@/types/project'
import { createNewProject } from '@/types/project'
import { isValidProject } from '@/services/storage/projectRepository'

let projects: QRProject[] = []
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ projects, loading: false, remove: vi.fn(), refresh: vi.fn() })
}))
vi.mock('@/components/common/InstallAppPrompt', () => ({ default: () => null }))

const { default: Dashboard } = await import('./Dashboard')
const render = () =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <Dashboard />
    </StaticRouter>
  )

describe('Dashboard', () => {
  beforeEach(() => {
    projects = []
  })

  it('offers only "Create New QR" - there is no sample-project button', () => {
    const html = render()
    expect(html).toContain('+ Create New QR')
    expect(html).not.toMatch(/Try a sample/i)
    expect(html).not.toMatch(/sample/i)
  })

  it('empty state still works', () => {
    expect(render()).toContain('No QR codes yet.')
  })

  it('still lists a project a visitor created earlier, whatever its brand name (existing local data is untouched)', () => {
    // Represents a record a visitor may already hold in localStorage from before the sample was removed.
    // The record is ordinary user data: it must remain valid and be listed like any other project.
    const earlier = createNewProject()
    earlier.brand.companyName = ['A', 'I', 'S'].join('')
    earlier.brand.tagline = ['Smart', 'Access', 'Solutions'].join(' ')
    expect(isValidProject(earlier)).toBe(true)
    projects = [earlier]
    const html = render()
    expect(html).toContain(earlier.brand.companyName)
    expect(html).not.toContain('No QR codes yet.')
  })
})
