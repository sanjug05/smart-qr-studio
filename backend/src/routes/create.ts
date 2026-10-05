import type { Ctx } from '../handler'
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
export async function createQr(request: Request, { store, config }: Ctx): Promise<Response> {
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
      ownerId: null,
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
