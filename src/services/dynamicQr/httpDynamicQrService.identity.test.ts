import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LandingContent } from '@/types/project'

const getIdToken = vi.fn<() => Promise<string | null>>()
vi.mock('@/services/auth/authService', () => ({ authService: { getIdToken: () => getIdToken() } }))

const { httpDynamicQrService, ID_TOKEN_HEADER } = await import('./httpDynamicQrService')
const { dynamicQrAuthorizationService } = await import('./dynamicQrAuthorizationService')

const BASE = 'https://api-abc123-uc.a.run.app'
const CONTENT = { brand: { companyName: 'Acme', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' }, destinations: [] } as unknown as LandingContent
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Dynamic QR service with a signed-in user', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    getIdToken.mockReset()
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', BASE)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('create sends the ID token so the backend records the owner — and stores the management token locally', async () => {
    getIdToken.mockResolvedValue('ID-TOKEN')
    fetchMock.mockResolvedValueOnce(ok({ publicId: 'AbC123xyz789', managementToken: 'MGMT', content: CONTENT, version: 1 }, 201))
    await httpDynamicQrService.create(CONTENT)
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers[ID_TOKEN_HEADER]).toBe('ID-TOKEN')
    expect(init.headers.Authorization).toBeUndefined()
    expect(dynamicQrAuthorizationService.getToken('AbC123xyz789')).toBe('MGMT')
  })

  it('create works anonymously when signed out (no identity header at all)', async () => {
    getIdToken.mockResolvedValue(null)
    fetchMock.mockResolvedValueOnce(ok({ publicId: 'AbC123xyz789', managementToken: 'MGMT', content: CONTENT, version: 1 }, 201))
    await httpDynamicQrService.create(CONTENT)
    expect(fetchMock.mock.calls[0][1].headers[ID_TOKEN_HEADER]).toBeUndefined()
  })

  it('a failure to obtain an ID token never blocks the request', async () => {
    getIdToken.mockRejectedValue(new Error('auth unavailable'))
    fetchMock.mockResolvedValueOnce(ok({ publicId: 'AbC123xyz789', managementToken: 'MGMT', content: CONTENT, version: 1 }, 201))
    await expect(httpDynamicQrService.create(CONTENT)).resolves.toMatchObject({ publicId: 'AbC123xyz789' })
  })

  it('update by the signed-in owner on a device with NO management token sends only the ID token', async () => {
    getIdToken.mockResolvedValue('ID-TOKEN')
    fetchMock.mockResolvedValueOnce(ok({ content: CONTENT, version: 2 }))
    expect(await httpDynamicQrService.update('AbC123xyz789', CONTENT)).toMatchObject({ ok: true, version: 2 })
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers[ID_TOKEN_HEADER]).toBe('ID-TOKEN')
    expect(headers.Authorization).toBeUndefined()
  })

  it('update on the creating device sends both credentials', async () => {
    getIdToken.mockResolvedValue('ID-TOKEN')
    dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'MGMT')
    fetchMock.mockResolvedValueOnce(ok({ content: CONTENT, version: 2 }))
    await httpDynamicQrService.update('AbC123xyz789', CONTENT)
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers[ID_TOKEN_HEADER]).toBe('ID-TOKEN')
    expect(headers.Authorization).toBe('Bearer MGMT')
  })

  it('public resolve never sends any credential', async () => {
    getIdToken.mockResolvedValue('ID-TOKEN')
    dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'MGMT')
    fetchMock.mockResolvedValueOnce(ok({ status: 'active', content: CONTENT, version: 1 }))
    await httpDynamicQrService.resolve('AbC123xyz789')
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
    expect(getIdToken).not.toHaveBeenCalled()
  })

  describe('claim', () => {
    it('is skipped (no request) unless BOTH an ID token and a management token are available', async () => {
      getIdToken.mockResolvedValue(null)
      dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'MGMT')
      expect(await httpDynamicQrService.claim('AbC123xyz789')).toBe('skipped')

      getIdToken.mockResolvedValue('ID-TOKEN')
      expect(await httpDynamicQrService.claim('NoTokenHere1')).toBe('skipped')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('POSTs to /v1/qr/:id/claim with both credentials and maps the outcomes', async () => {
      getIdToken.mockResolvedValue('ID-TOKEN')
      dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'MGMT')

      fetchMock.mockResolvedValueOnce(ok({ claimed: true }))
      expect(await httpDynamicQrService.claim('AbC123xyz789')).toBe('claimed')
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${BASE}/v1/qr/AbC123xyz789/claim`)
      expect(init.method).toBe('POST')
      expect(init.headers[ID_TOKEN_HEADER]).toBe('ID-TOKEN')
      expect(init.headers.Authorization).toBe('Bearer MGMT')

      fetchMock.mockResolvedValueOnce(ok({ error: 'taken' }, 409))
      expect(await httpDynamicQrService.claim('AbC123xyz789')).toBe('owned-by-other')
      fetchMock.mockResolvedValueOnce(ok({ error: 'x' }, 500))
      expect(await httpDynamicQrService.claim('AbC123xyz789')).toBe('error')
      fetchMock.mockRejectedValueOnce(new TypeError('network'))
      expect(await httpDynamicQrService.claim('AbC123xyz789')).toBe('error')
    })
  })
})
