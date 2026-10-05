import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { httpDynamicQrService } from './httpDynamicQrService'
import { dynamicQrAuthorizationService } from './dynamicQrAuthorizationService'
import type { LandingContent } from '@/types/project'

const BASE = 'https://api-abc123-uc.a.run.app'
const CONTENT = {
  brand: { companyName: 'Acme', primaryColor: '#000000', secondaryColor: '#111111', backgroundColor: '#ffffff' },
  destinations: []
} as unknown as LandingContent

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('httpDynamicQrService against the Firebase API endpoint', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', BASE + '/')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('create POSTs to {base}/v1/qr, stores the returned token locally, and never returns it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ publicId: 'AbC123xyz789', managementToken: 'TOKEN-1', content: CONTENT, version: 1 }, 201))
    const result = await httpDynamicQrService.create(CONTENT)

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v1/qr`)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(result).toEqual({ publicId: 'AbC123xyz789', content: CONTENT, version: 1 })
    expect(JSON.stringify(result)).not.toContain('TOKEN-1')
    expect(dynamicQrAuthorizationService.getToken('AbC123xyz789')).toBe('TOKEN-1')
  })

  it('resolve is an unauthenticated GET that sends no Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'active', content: CONTENT, version: 3 }))
    expect(await httpDynamicQrService.resolve('AbC123xyz789')).toEqual({ status: 'active', content: CONTENT, version: 3 })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v1/qr/AbC123xyz789`)
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
  })

  it('resolve maps 404 / disabled / network failure to the existing result statuses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nf' }, 404))
    expect(await httpDynamicQrService.resolve('nope')).toEqual({ status: 'not-found' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'disabled' }))
    expect(await httpDynamicQrService.resolve('off')).toEqual({ status: 'disabled' })
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect(await httpDynamicQrService.resolve('x')).toEqual({ status: 'error' })
  })

  it('update PUTs to the same publicId URL with the stored bearer token', async () => {
    dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'TOKEN-1')
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: CONTENT, version: 2 }))
    expect(await httpDynamicQrService.update('AbC123xyz789', CONTENT)).toEqual({ ok: true, content: CONTENT, version: 2 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/v1/qr/AbC123xyz789`)
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-1')
  })

  it('update surfaces the backend error message, including the document-size rejection', async () => {
    dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'TOKEN-1')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid destination data.', details: ['Content is too large.'] }, 422))
    expect(await httpDynamicQrService.update('AbC123xyz789', CONTENT)).toEqual({ ok: false, error: 'Invalid destination data.' })
  })

  it('setStatus PATCHes {base}/v1/qr/:id/status with the bearer token', async () => {
    dynamicQrAuthorizationService.storeToken('AbC123xyz789', 'TOKEN-1')
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'disabled' }))
    expect(await httpDynamicQrService.setStatus('AbC123xyz789', 'disabled')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/v1/qr/AbC123xyz789/status`)
    expect(init.method).toBe('PATCH')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-1')
    expect(JSON.parse(init.body)).toEqual({ status: 'disabled' })
  })

  it('percent-encodes the publicId in the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nf' }, 404))
    await httpDynamicQrService.resolve('a/b?c')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v1/qr/a%2Fb%3Fc`)
  })

  it('create without any configured endpoint fails closed before sending anything', async () => {
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', '')
    await expect(httpDynamicQrService.create(CONTENT)).rejects.toThrow(/not configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
