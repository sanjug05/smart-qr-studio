import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSafeProductionApiUrl, getDynamicQrApiBaseUrl } from './config'

describe('isSafeProductionApiUrl', () => {
  it('accepts public https endpoints (Cloud Run / Cloud Functions style, with or without a path)', () => {
    expect(isSafeProductionApiUrl('https://api-abc123-uc.a.run.app')).toBe(true)
    expect(isSafeProductionApiUrl('https://us-central1-my-project.cloudfunctions.net/api')).toBe(true)
  })

  it('rejects non-https, loopback, unspecified and malformed values', () => {
    for (const bad of [
      'http://api.example.com',
      'https://localhost:5001/x',
      'https://sub.localhost',
      'https://127.0.0.1',
      'https://127.0.0.1:8787',
      'https://0.0.0.0',
      'https://[::1]',
      'https://[::]',
      'ftp://api.example.com',
      'api.example.com',
      '',
      'not a url'
    ]) {
      expect(isSafeProductionApiUrl(bad), bad).toBe(false)
    }
  })
})

describe('getDynamicQrApiBaseUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed when no endpoint is configured — there is no built-in default', () => {
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', '')
    expect(() => getDynamicQrApiBaseUrl()).toThrow(/not configured/)
  })

  it('in a production build, refuses loopback and non-https endpoints', () => {
    vi.stubEnv('PROD', true)
    for (const bad of ['http://127.0.0.1:5001/x', 'https://localhost:8787', 'http://api.example.com']) {
      vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', bad)
      expect(() => getDynamicQrApiBaseUrl(), bad).toThrow(/public https/)
    }
  })

  it('in a production build, returns a valid endpoint without its trailing slash', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', 'https://api-abc123-uc.a.run.app/')
    expect(getDynamicQrApiBaseUrl()).toBe('https://api-abc123-uc.a.run.app')
  })

  it('in development, allows the local emulator endpoint', () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_DYNAMIC_QR_API_BASE_URL', 'http://127.0.0.1:5001/demo/us-central1/api')
    expect(getDynamicQrApiBaseUrl()).toBe('http://127.0.0.1:5001/demo/us-central1/api')
  })
})
