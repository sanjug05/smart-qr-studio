import { describe, it, expect } from 'vitest'
import { canUse, isTestOverrideActive, resolveEnvironmentDefaultPlan } from '../src/lib/entitlements'

describe('resolveEnvironmentDefaultPlan', () => {
  it('defaults production to free (dynamicQr disabled)', () => {
    expect(resolveEnvironmentDefaultPlan('production')).toBe('free')
  })
  it('defaults development and staging to pro (dynamicQr enabled)', () => {
    expect(resolveEnvironmentDefaultPlan('development')).toBe('pro')
    expect(resolveEnvironmentDefaultPlan('staging')).toBe('pro')
  })
})

describe('isTestOverrideActive — fails closed on every axis', () => {
  it('is false when no secret is configured, even if a header is sent', () => {
    expect(isTestOverrideActive({ overrideHeaderValue: 'anything', configuredOverrideSecret: undefined })).toBe(false)
  })
  it('is false when the configured secret is an empty string', () => {
    expect(isTestOverrideActive({ overrideHeaderValue: 'anything', configuredOverrideSecret: '' })).toBe(false)
  })
  it('is false when a secret is configured but no header is sent', () => {
    expect(isTestOverrideActive({ overrideHeaderValue: null, configuredOverrideSecret: 'real-secret' })).toBe(false)
  })
  it('is false when the header value does not match the configured secret', () => {
    expect(isTestOverrideActive({ overrideHeaderValue: 'wrong-value', configuredOverrideSecret: 'real-secret' })).toBe(false)
  })
  it('is true only when a secret is configured AND the header exactly matches it', () => {
    expect(isTestOverrideActive({ overrideHeaderValue: 'real-secret', configuredOverrideSecret: 'real-secret' })).toBe(true)
  })
})

describe('canUse — production stays safe by default, override is the only escape hatch', () => {
  it('denies dynamicQr in production with no override configured', () => {
    expect(canUse('dynamicQr', { environment: 'production', overrideHeaderValue: null, configuredOverrideSecret: undefined })).toBe(false)
  })
  it('denies dynamicQr in production even if a header is sent, when no secret is configured for this deployment', () => {
    expect(canUse('dynamicQr', { environment: 'production', overrideHeaderValue: 'guessed-value', configuredOverrideSecret: undefined })).toBe(false)
  })
  it('denies dynamicQr in production when the header does not match the configured secret', () => {
    expect(canUse('dynamicQr', { environment: 'production', overrideHeaderValue: 'wrong', configuredOverrideSecret: 'right' })).toBe(false)
  })
  it('grants dynamicQr in production only with the exact matching override header and a configured secret', () => {
    expect(canUse('dynamicQr', { environment: 'production', overrideHeaderValue: 'right', configuredOverrideSecret: 'right' })).toBe(true)
  })
  it('grants dynamicQr in development/staging regardless of override state (unchanged existing behavior)', () => {
    expect(canUse('dynamicQr', { environment: 'development', overrideHeaderValue: null, configuredOverrideSecret: undefined })).toBe(true)
    expect(canUse('dynamicQr', { environment: 'staging', overrideHeaderValue: null, configuredOverrideSecret: undefined })).toBe(true)
  })
})
