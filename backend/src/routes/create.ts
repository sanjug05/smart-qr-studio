import type { Env } from '../types'
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
 * fails closed whenever `DYNAMIC_QR_TEST_OVERRIDE_SECRET` isn't configured.
 */
export async function createQr(request: Request, env: Env): Promise<Response> {
  const allowed = canUse('dynamicQr', {
    environment: env.ENVIRONMENT,
    configuredDefaultPlan: env.DEFAULT_PLAN,
    overrideHeaderValue: request.headers.get(DYNAMIC_QR_TEST_OVERRIDE_HEADER),
    configuredOverrideSecret: env.DYNAMIC_QR_TEST_OVERRIDE_SECRET
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
  const contentJson = JSON.stringify(outcome.content)

  for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt++) {
    const publicId = generatePublicId()
    try {
      await env.DB.prepare(
        'INSERT INTO dynamic_qr (public_id, owner_id, token_hash, status, content, version, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, 1, ?, ?)'
      )
        .bind(publicId, tokenHash, 'active', contentJson, now, now)
        .run()

      return jsonResponse(
        {
          publicId,
          managementToken,
          content: outcome.content,
          version: 1
        },
        201
      )
    } catch (err) {
      // A UNIQUE constraint failure on public_id is the only expected
      // failure mode here — astronomically unlikely, but retried rather
      // than trusted to never happen (see lib/ids.ts).
      if (!isUniqueConstraintError(err)) throw err
    }
  }

  return errorResponse('Could not generate a unique QR identifier. Please try again.', 500)
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique/i.test(err.message)
}
