import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

async function loadService(env: { PROD: boolean; plan?: string }) {
  vi.resetModules()
  vi.stubEnv('PROD', env.PROD)
  vi.stubEnv('DEV', !env.PROD)
  vi.stubEnv('VITE_DEFAULT_PLAN', env.plan as string)
  vi.stubEnv('VITE_DYNAMIC_QR_TEST_OVERRIDE_SECRET', '')
  return (await import('./entitlementService')).entitlementService
}

describe('entitlementService — configured plan (currently Business-level)', () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllEnvs())

  it('a production build declared VITE_DEFAULT_PLAN=business can use Dynamic QR', async () => {
    const svc = await loadService({ PROD: true, plan: 'business' })
    expect(svc.currentPlan()).toBe('business')
    expect(svc.canUse('dynamicQr')).toBe(true)
  })

  it('keeps the safe default: a production build with no plan configured is still free', async () => {
    const svc = await loadService({ PROD: true })
    expect(svc.currentPlan()).toBe('free')
    expect(svc.canUse('dynamicQr')).toBe(false)
  })

  it('ignores an unrecognized or differently-cased plan and falls back to the environment default', async () => {
    for (const bad of ['enterprise', 'BUSINESS', '', 'toString', '__proto__']) {
      const svc = await loadService({ PROD: true, plan: bad })
      expect(svc.currentPlan()).toBe('free')
      expect(svc.canUse('dynamicQr')).toBe(false)
    }
  })

  it('an explicit free plan still locks Dynamic QR, even in a dev build (the seam for future tiers)', async () => {
    const svc = await loadService({ PROD: false, plan: 'free' })
    expect(svc.currentPlan()).toBe('free')
    expect(svc.canUse('dynamicQr')).toBe(false)
  })

  it('a dev build with nothing configured keeps its original pro default', async () => {
    const svc = await loadService({ PROD: false })
    expect(svc.currentPlan()).toBe('pro')
    expect(svc.canUse('dynamicQr')).toBe(true)
  })
})
