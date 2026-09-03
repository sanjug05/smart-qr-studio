import type { LandingContent } from '@/types/project'
import type { DynamicQrCreateResult, DynamicQrResolveResult, DynamicQrService, DynamicQrUpdateResult } from './dynamicQrService'
import { dynamicQrAuthorizationService } from './dynamicQrAuthorizationService'

/**
 * In-memory stand-in for the real backend — same interface, no network
 * dependency. Used by component/unit tests so they can exercise the
 * create → resolve → update → resolve-again → disable flow without a
 * running Worker (see README → "Testability"). Not wired into the app by
 * default; import and construct it directly wherever a test needs it.
 */
export class MockDynamicQrService implements DynamicQrService {
  private records = new Map<string, { content: LandingContent; version: number; status: 'active' | 'disabled' }>()
  private idCounter = 0

  async resolve(publicId: string): Promise<DynamicQrResolveResult> {
    const record = this.records.get(publicId)
    if (!record) return { status: 'not-found' }
    if (record.status === 'disabled') return { status: 'disabled' }
    return { status: 'active', content: record.content, version: record.version }
  }

  async create(content: LandingContent): Promise<DynamicQrCreateResult> {
    const publicId = `mock-${++this.idCounter}`
    const managementToken = `mock-token-${publicId}`
    this.records.set(publicId, { content, version: 1, status: 'active' })
    dynamicQrAuthorizationService.storeToken(publicId, managementToken)
    return { publicId, content, version: 1 }
  }

  async update(publicId: string, content: LandingContent): Promise<DynamicQrUpdateResult> {
    const record = this.records.get(publicId)
    if (!record) return { ok: false, error: 'Not found.' }
    const expectedToken = dynamicQrAuthorizationService.getToken(publicId)
    if (!expectedToken) return { ok: false, error: 'Missing management token.' }

    const nextVersion = record.version + 1
    this.records.set(publicId, { ...record, content, version: nextVersion })
    return { ok: true, content, version: nextVersion }
  }

  async setStatus(publicId: string, status: 'active' | 'disabled'): Promise<{ ok: boolean }> {
    const record = this.records.get(publicId)
    if (!record) return { ok: false }
    this.records.set(publicId, { ...record, status })
    return { ok: true }
  }
}
