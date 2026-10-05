import type { RouteCtx } from '../handler'
import { readJsonBody, jsonResponse, errorResponse } from '../lib/json'
import { validateDynamicQrContent } from '../lib/validation'
import { generatePublicId, generateManagementToken, hashToken } from '../lib/ids'
import { canUse, DYNAMIC_QR_TEST_OVERRIDE_HEADER } from '../lib/entitlements'

const MAX_ID_COLLISION_RETRIES = 5

/**
 * POST /v1/qr — creates a Dynamic QR. Entitlement is checked here, not
 * only in the wizard UI (see lib/entitlements.ts) — a direct API call must
 * not be able to bypass the same rule the UI enforces. The test-override
 * header is read here and nowhere else; see lib/entitlements.ts for why it
 * fails closed whenever no override secret is configured.
 */
export async function createQr(request: Request, { store, config, caller }: RouteCtx): Promise<Response> {
  // A presented-but-unverifiable ID token is an error, never silently downgraded to an anonymous create.
  if (caller.kind === 'invalid') return errorResponse('Invalid or expired sign-in. Please sign in again.', 401)

  const allowed = canUse('dynamicQr', {
    environment: config.environment,
    configuredDefaultPlan: config.defaultPlan,
    overrideHeaderValue: request.headers.get(DYNAMIC_QR_TEST_OVERRIDE_HEADER),
    configuredOverrideSecret: config.testOverrideSecret
  })
  if (!allowed) {
    return errorResponse('Dynamic QR is not available on the current plan.', 403)
  }

  const body = await readJsonBody(request)
  const outcome = validateDynamicQrContent(body)
  if (!outcome.valid || !outcome.content) {
    return jsonResponse({ error: 'Invalid destination data.', details: outcome.errors }, 422)
  }

  const managementToken = generateManagementToken()
  const tokenHash = await hashToken(managementToken)
  const now = new Date().toISOString()

  for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt++) {
    const publicId = generatePublicId()
    // `create` never overwrites: an id collision (astronomically unlikely, see lib/ids.ts) is retried, not trusted to never happen.
    const created = await store.create({
      publicId,
      // Derived only from the verified ID token — nothing in the request body can set the owner.
      ownerId: caller.kind === 'user' ? caller.uid : null,
      tokenHash,
      status: 'active',
      content: outcome.content,
      version: 1,
      createdAt: now,
      updatedAt: now
    })
    if (created) {
      return jsonResponse({ publicId, managementToken, content: outcome.content, version: 1 }, 201)
    }
  }

  return errorResponse('Could not generate a unique QR identifier. Please try again.', 500)
}
