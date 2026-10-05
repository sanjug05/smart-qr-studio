import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import type { QRProject } from '@/types/project'
import { createNewProject } from '@/types/project'

type Library = ReturnType<typeof makeLibrary>
const makeLibrary = () => ({
  status: 'signedOut' as 'loading' | 'unavailable' | 'signedOut' | 'signedIn',
  user: null as null | { uid: string },
  local: [] as QRProject[],
  cloud: [] as QRProject[],
  localOnly: [] as QRProject[],
  loading: false,
  error: null as string | null,
  migrationDismissed: false,
  refresh: vi.fn(),
  saveToCloud: vi.fn(),
  removeLocal: vi.fn(),
  removeCloud: vi.fn(),
  duplicate: vi.fn(),
  skipMigration: vi.fn()
})
let library: Library = makeLibrary()

vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => library }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signIn: vi.fn(), signingIn: false }) }))

const { default: MyQRCodes } = await import('./MyQRCodes')
const render = () =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <MyQRCodes />
    </StaticRouter>
  )

const project = (name: string, over: Partial<QRProject> = {}): QRProject => {
  const p = createNewProject()
  p.brand.companyName = name
  return { ...p, ...over }
}

describe('My QR Codes', () => {
  beforeEach(() => {
    library = makeLibrary()
  })

  it('signed out (cloud configured): invites Google sign-in and still lists on-device QR codes', () => {
    library.local = [project('Device Co')]
    const html = render()
    expect(html).toContain('Sign in with Google to save QR codes and access them across devices.')
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Device Co')
  })

  it('signed out, no cloud configured: the original local-only wording, no sign-in prompt', () => {
    library.status = 'unavailable'
    library.local = [project('Device Co')]
    const html = render()
    expect(html).toContain('Stored locally in this browser')
    expect(html).not.toContain('Continue with Google')
  })

  it('signed out and empty: the empty state', () => {
    expect(render()).toContain('No QR codes yet.')
  })

  it('signed in: lists the account library under "Saved to your account" with type and badges', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.cloud = [project('Cloud Co'), project('Dyn Co', { qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } })]
    const html = render()
    expect(html).toContain('Saved to your account')
    expect(html).toContain('Cloud Co')
    expect(html).toContain('In your account')
    expect(html).toContain('Static QR')
    expect(html).toContain('Dynamic QR')
    expect(html).toContain('Refresh')
  })

  it('signed in: Duplicate is offered for static QR codes only (a Dynamic QR has one permanent link)', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.cloud = [project('Static Co')]
    expect(render()).toContain('Duplicate')
    library.cloud = [project('Dyn Co', { qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } })]
    expect(render()).not.toContain('Duplicate')
  })

  it('signed in with no cloud QR codes yet: explains how to save one', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    const html = render()
    expect(html).toContain('No QR codes in your account yet.')
  })

  it('signed in with device-only QR codes: offers Save All / Choose QR Codes / Skip, and never auto-uploads', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.localOnly = [project('Old A'), project('Old B')]
    const html = render()
    expect(html).toContain('Save your existing QR codes to your account')
    expect(html).toContain('Save All')
    expect(html).toContain('Choose QR Codes')
    expect(html).toContain('Skip')
    expect(html).toContain('On this device only')
    expect(html).toContain('Save to account')
    expect(library.saveToCloud).not.toHaveBeenCalled()
  })

  it('after Skip the migration prompt is gone but device-only QR codes stay listed with per-card Save', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.localOnly = [project('Old A')]
    library.migrationDismissed = true
    const html = render()
    expect(html).not.toContain('Save your existing QR codes to your account')
    expect(html).toContain('Old A')
    expect(html).toContain('Save to account')
  })

  it('no migration prompt when everything is already in the account', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.cloud = [project('Cloud Co')]
    expect(render()).not.toContain('Save your existing QR codes')
  })

  it('shows a load failure with a retry', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.error = 'Couldn’t load your QR codes from your account.'
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Retry')
  })

  it('shows a loading state while the library loads', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.loading = true
    expect(render()).toContain('aria-busy="true"')
  })

  it('never renders a management token or a destination URL for a Dynamic QR card', () => {
    library.status = 'signedIn'
    library.user = { uid: 'u1' }
    library.cloud = [project('Dyn Co', { qrMode: 'dynamic', dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } })]
    const html = render()
    expect(html).not.toMatch(/management|token/i)
    expect(html).not.toContain('https://example.com')
  })
})
