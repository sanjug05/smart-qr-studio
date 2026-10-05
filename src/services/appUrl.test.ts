import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPublicBaseUrl } from './appUrl'
import { getDynamicShareUrl, getShareUrl, getQrShareUrl } from './share/shareLinkService'
import { createNewProject } from '@/types/project'

describe('public base URL (canonical QR origin)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the configured canonical URL, always ending in a slash', () => {
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'https://sanjugupta.com/qr')
    expect(getPublicBaseUrl()).toBe('https://sanjugupta.com/qr/')
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'https://sanjugupta.com/qr/')
    expect(getPublicBaseUrl()).toBe('https://sanjugupta.com/qr/')
  })

  it('falls back to the current origin + base path when unset or malformed (never a broken QR)', () => {
    vi.stubEnv('VITE_PUBLIC_BASE_URL', '')
    expect(getPublicBaseUrl()).toBe(window.location.origin + import.meta.env.BASE_URL)
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'not a url')
    expect(getPublicBaseUrl()).toBe(window.location.origin + import.meta.env.BASE_URL)
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'javascript:alert(1)')
    expect(getPublicBaseUrl()).toBe(window.location.origin + import.meta.env.BASE_URL)
  })

  it('every QR URL is built on it: Dynamic → /qr/#/q/d.<id>, Static → /qr/#/q/p.<payload>', () => {
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'https://sanjugupta.com/qr/')
    expect(getDynamicShareUrl('AbC123xyz789')).toBe('https://sanjugupta.com/qr/#/q/d.AbC123xyz789')
    const staticProject = createNewProject()
    expect(getShareUrl(staticProject)).toMatch(/^https:\/\/sanjugupta\.com\/qr\/#\/q\/p\.[A-Za-z0-9_-]+$/)
    const dynamic = { ...createNewProject(), qrMode: 'dynamic' as const, dynamicQr: { publicId: 'AbC123xyz789', createdAt: 'x' } }
    expect(getQrShareUrl(dynamic)).toBe('https://sanjugupta.com/qr/#/q/d.AbC123xyz789')
    expect(getQrShareUrl(staticProject)).toBe(getShareUrl(staticProject))
  })

  it('the Dynamic URL never contains a destination URL or a token', () => {
    vi.stubEnv('VITE_PUBLIC_BASE_URL', 'https://sanjugupta.com/qr/')
    const url = getDynamicShareUrl('AbC123xyz789')
    expect(url).not.toContain('example.com')
    expect(url).not.toMatch(/token/i)
  })
})
