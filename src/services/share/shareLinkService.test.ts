import { describe, it, expect } from 'vitest'
import { getQrShareUrl, getShareUrl, getDynamicShareUrl, DynamicQrNotProvisionedError, isDynamicShareToken, isShareToken } from './shareLinkService'
import { dynamicQrAuthorizationService } from '@/services/dynamicQr/dynamicQrAuthorizationService'
import { staticProject, dynamicProject, SECRET_DESTINATION, DYNAMIC_PUBLIC_ID, FAKE_MANAGEMENT_TOKEN } from '@/test/fixtures'

describe('getQrShareUrl — the one canonical "what does this QR encode" answer', () => {
  it('Static: returns the existing self-contained p.<payload> URL, unchanged', () => {
    const project = staticProject()
    const url = getQrShareUrl(project)
    expect(url).toBe(getShareUrl(project))
    expect(url).toMatch(/#\/q\/p\./)
  })

  it('Static: a project with no qrMode (saved before Dynamic QR existed) is still static', () => {
    const project = staticProject()
    delete project.qrMode
    expect(getQrShareUrl(project)).toBe(getShareUrl(project))
  })

  it('Dynamic: returns exactly the permanent d.<publicId> URL', () => {
    const url = getQrShareUrl(dynamicProject())
    expect(url).toBe(getDynamicShareUrl(DYNAMIC_PUBLIC_ID))
    expect(url.endsWith(`#/q/d.${DYNAMIC_PUBLIC_ID}`)).toBe(true)
  })

  it('Dynamic: never contains the destination URL or its (base64) payload', () => {
    const project = dynamicProject()
    const url = getQrShareUrl(project)
    expect(url).not.toContain('secret-destination')
    expect(url).not.toContain('#/q/p.')
    expect(url).not.toContain(btoa(SECRET_DESTINATION).slice(0, 12))
  })

  it('Dynamic: editing destinations or brand never changes the URL (the QR never needs regenerating)', () => {
    const before = getQrShareUrl(dynamicProject())
    const edited = dynamicProject()
    edited.destinations[0].url = 'https://brand-new-website.example.net'
    edited.brand.companyName = 'Renamed Co'
    edited.brand.tagline = 'A different tagline'
    expect(getQrShareUrl(edited)).toBe(before)
  })

  it('Static: editing destinations DOES change the URL (a static QR is a snapshot)', () => {
    const before = getQrShareUrl(staticProject())
    const edited = staticProject()
    edited.destinations[0].url = 'https://brand-new-website.example.net'
    expect(getQrShareUrl(edited)).not.toBe(before)
  })

  it('Dynamic: never includes the management token, even when one is stored for this publicId', () => {
    dynamicQrAuthorizationService.storeToken(DYNAMIC_PUBLIC_ID, FAKE_MANAGEMENT_TOKEN)
    try {
      expect(getQrShareUrl(dynamicProject())).not.toContain(FAKE_MANAGEMENT_TOKEN)
    } finally {
      dynamicQrAuthorizationService.clearToken(DYNAMIC_PUBLIC_ID)
    }
  })

  it('Dynamic without a publicId yet: throws a distinguishable error rather than falling back to a static URL', () => {
    const project = dynamicProject({ dynamicQr: undefined })
    expect(() => getQrShareUrl(project)).toThrow(DynamicQrNotProvisionedError)
  })

  it('the three link formats stay unambiguously distinguishable (legacy slug / static / dynamic)', () => {
    expect(isShareToken('p.abc')).toBe(true)
    expect(isDynamicShareToken('d.abc')).toBe(true)
    expect(isShareToken('d.abc')).toBe(false)
    expect(isDynamicShareToken('p.abc')).toBe(false)
    expect(isShareToken('596041f1')).toBe(false)
    expect(isDynamicShareToken('596041f1')).toBe(false)
  })
})
