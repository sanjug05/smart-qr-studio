import { describe, it, expect, vi, beforeEach } from 'vitest'
import { staticProject, dynamicProject, SECRET_DESTINATION } from '@/test/fixtures'

// The real library needs a canvas/DOM renderer. What matters here is the
// `data` option the factory hands it — i.e. exactly what the QR encodes.
const constructed: Array<{ data: string }> = []
vi.mock('qr-code-styling', () => ({
  default: class {
    constructor(options: { data: string }) {
      constructed.push(options)
    }
  }
}))

import { buildQr, DynamicQrNotProvisionedError } from './qrCodeFactory'
import { getQrShareUrl } from '@/services/share/shareLinkService'

describe('buildQr — what the QR actually encodes', () => {
  beforeEach(() => {
    constructed.length = 0
  })

  it('Static: encodes the canonical static URL', () => {
    const project = staticProject()
    const { data } = buildQr(project)
    expect(data).toBe(getQrShareUrl(project))
    expect(constructed[0].data).toBe(data)
  })

  it('Dynamic: encodes the permanent d.<publicId> URL and never the destination', () => {
    const project = dynamicProject()
    const { data } = buildQr(project)
    expect(data).toBe(getQrShareUrl(project))
    expect(data).toMatch(/#\/q\/d\.[A-Za-z0-9]+$/)
    expect(constructed[0].data).not.toContain(SECRET_DESTINATION)
    expect(constructed[0].data).not.toContain('secret-destination')
  })

  it('Dynamic without a publicId: throws the "not provisioned" error (re-exported from here for existing importers)', () => {
    expect(() => buildQr(dynamicProject({ dynamicQr: undefined }))).toThrow(DynamicQrNotProvisionedError)
  })
})
