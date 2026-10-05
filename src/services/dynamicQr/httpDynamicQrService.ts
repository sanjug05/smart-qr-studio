import type { LandingContent } from '@/types/project'
import type { DynamicQrClaimResult, DynamicQrCreateResult, DynamicQrResolveResult, DynamicQrService, DynamicQrUpdateResult } from './dynamicQrService'
import { dynamicQrAuthorizationService } from './dynamicQrAuthorizationService'
import { authService } from '@/services/auth/authService'
import { getDynamicQrApiBaseUrl, getDynamicQrTestOverrideSecret, DYNAMIC_QR_TEST_OVERRIDE_HEADER } from './config'

/**
 * The real implementation, talking to the Firebase Cloud Functions + Firestore API
 * described in /README.md → "Dynamic QR architecture". Every management
 * call attaches its Authorization header via
 * `dynamicQrAuthorizationService` — this file never reads or writes a
 * token itself, only asks that service for the headers to send.
 */
/** Must match ID_TOKEN_HEADER in backend/src/lib/identity.ts. */
export const ID_TOKEN_HEADER = 'X-Firebase-ID-Token'

/**
 * The signed-in user's Firebase ID token as a header, or nothing when signed
 * out / unavailable. Sent on create (so the backend records the owner) and on
 * every management call (so the owner can manage from any device). A failure
 * to obtain one never blocks anonymous use — the request just goes without.
 */
async function identityHeaders(): Promise<Record<string, string>> {
  try {
    const token = await authService.getIdToken()
    return token ? { [ID_TOKEN_HEADER]: token } : {}
  } catch {
    return {}
  }
}

class HttpDynamicQrService implements DynamicQrService {
  async resolve(publicId: string): Promise<DynamicQrResolveResult> {
    let res: Response
    try {
      res = await fetch(`${getDynamicQrApiBaseUrl()}/v1/qr/${encodeURIComponent(publicId)}`)
    } catch {
      return { status: 'error' }
    }

    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) return { status: 'error' }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { status: 'error' }
    }

    if (!body || typeof body !== 'object') return { status: 'error' }
    const parsed = body as { status?: string; content?: LandingContent; version?: number }

    if (parsed.status === 'disabled') return { status: 'disabled' }
    if (parsed.status === 'active' && parsed.content) {
      return { status: 'active', content: parsed.content, version: parsed.version ?? 0 }
    }
    return { status: 'error' }
  }

  async create(content: LandingContent): Promise<DynamicQrCreateResult> {
    const overrideSecret = getDynamicQrTestOverrideSecret()
    const res = await fetch(`${getDynamicQrApiBaseUrl()}/v1/qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await identityHeaders()),
        ...(overrideSecret ? { [DYNAMIC_QR_TEST_OVERRIDE_HEADER]: overrideSecret } : {})
      },
      body: JSON.stringify(content)
    })
    if (!res.ok) {
      const body = await safeJson(res)
      throw new Error(errorMessageFrom(body, res.status, 'create'))
    }
    const body = (await res.json()) as { publicId: string; managementToken: string; content: LandingContent; version: number }

    // The one and only place the plaintext token is ever stored — never
    // returned again by the backend after this response.
    dynamicQrAuthorizationService.storeToken(body.publicId, body.managementToken)

    return { publicId: body.publicId, content: body.content, version: body.version }
  }

  async update(publicId: string, content: LandingContent): Promise<DynamicQrUpdateResult> {
    const res = await fetch(`${getDynamicQrApiBaseUrl()}/v1/qr/${encodeURIComponent(publicId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await identityHeaders()), ...dynamicQrAuthorizationService.authorizationHeaders(publicId) },
      body: JSON.stringify(content)
    })
    if (!res.ok) {
      const body = await safeJson(res)
      return { ok: false, error: errorMessageFrom(body, res.status, 'update') }
    }
    const body = (await res.json()) as { content: LandingContent; version: number }
    return { ok: true, content: body.content, version: body.version }
  }

  async setStatus(publicId: string, status: 'active' | 'disabled'): Promise<{ ok: boolean }> {
    const res = await fetch(`${getDynamicQrApiBaseUrl()}/v1/qr/${encodeURIComponent(publicId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await identityHeaders()), ...dynamicQrAuthorizationService.authorizationHeaders(publicId) },
      body: JSON.stringify({ status })
    })
    return { ok: res.ok }
  }

  async claim(publicId: string): Promise<DynamicQrClaimResult> {
    const identity = await identityHeaders()
    const management = dynamicQrAuthorizationService.authorizationHeaders(publicId)
    // Both credentials are required by the backend; without either there is nothing to claim.
    if (!identity[ID_TOKEN_HEADER] || !management.Authorization) return 'skipped'
    try {
      const res = await fetch(`${getDynamicQrApiBaseUrl()}/v1/qr/${encodeURIComponent(publicId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...identity, ...management },
        body: '{}'
      })
      if (res.ok) return 'claimed'
      if (res.status === 409) return 'owned-by-other'
      return 'error'
    } catch {
      return 'error'
    }
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function errorMessageFrom(body: unknown, status: number, action: 'create' | 'update'): string {
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string') {
    return (body as Record<string, string>).error
  }
  if (status === 401) return 'This device is not authorized to manage this Dynamic QR.'
  if (status === 403) return 'Dynamic QR is not available on the current plan.'
  return `Could not ${action} the Dynamic QR (${status}).`
}

export const httpDynamicQrService: DynamicQrService = new HttpDynamicQrService()
