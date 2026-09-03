/**
 * Backend-side entitlement check for creating a Dynamic QR. Deliberately
 * mirrors src/services/entitlements/entitlements.ts on the frontend (kept
 * as two small, independent copies rather than a shared package — see
 * README → "Current limitations" for why). Enforced here too, not only in
 * the UI, because a client can call this API directly without going
 * through the wizard at all — the same "never trust the client alone"
 * principle already applied to URL validation applies to entitlements.
 *
 * No `users`/`plans` table exists yet (see README → "Current
 * limitations"), so there is no per-user plan to look up. Until real
 * accounts and billing exist, entitlement is decided by the deployed
 * environment alone — exactly what requirement #36 of the approved
 * architecture asked for, and exactly what PLAN_ENTITLEMENTS below still
 * models even though only the environment default is reachable today.
 */
import { timingSafeEqual } from './auth'

export type Plan = 'free' | 'pro' | 'business'
export type EntitlementKey = 'dynamicQr'

export const PLAN_ENTITLEMENTS: Record<Plan, Record<EntitlementKey, boolean>> = {
  free: { dynamicQr: false },
  pro: { dynamicQr: true },
  business: { dynamicQr: true }
}

/** The one header name the test-override mechanism reads. Never a query parameter — see isTestOverrideActive(). */
export const DYNAMIC_QR_TEST_OVERRIDE_HEADER = 'X-Dynamic-QR-Test-Override'

/**
 * Until accounts/billing exist, every caller in a given environment shares
 * one default plan. `development` and `staging` default to `pro` so the
 * feature can be built and tested end-to-end; `production` defaults to
 * `free`, matching requirement #36 ("production entitlement must default
 * safely"). Swapping this for a real per-user plan lookup later changes
 * only this function's body, not its callers.
 */
export function resolveEnvironmentDefaultPlan(environment: string): Plan {
  return environment === 'production' ? 'free' : 'pro'
}

export interface EntitlementCheckInput {
  environment: string
  /** The exact value of the `X-Dynamic-QR-Test-Override` request header, or null if absent. Never read from a query string. */
  overrideHeaderValue: string | null
  /** `env.DYNAMIC_QR_TEST_OVERRIDE_SECRET` — a Worker *secret*, not a `wrangler.toml` var. Undefined on every environment unless explicitly provisioned. */
  configuredOverrideSecret: string | undefined
}

/**
 * A production-configured backend can still be entitlement-tested end to
 * end without granting Dynamic QR to real production traffic — but only
 * if someone has deliberately provisioned a secret for that specific
 * deployment (`wrangler secret put DYNAMIC_QR_TEST_OVERRIDE_SECRET --env
 * production`) AND the caller presents the exact matching value in a
 * request header.
 *
 * Fails closed on every axis:
 * - No secret configured (the default, on every environment) → this
 *   function returns `false` unconditionally, regardless of what header
 *   value (if any) the request sends. An unset secret is never treated as
 *   "matches anything" or "matches empty."
 * - Wrong or missing header → `false`.
 * - This is a request *header*, never a query parameter — a query string
 *   can end up in server logs, browser history, and shared links; a
 *   custom header on a same-purpose management call does not.
 * - This check has no relationship to `localStorage` or any other
 *   client-stored state — it is evaluated entirely from the incoming
 *   request and this Worker's own secret binding, so editing anything in
 *   a browser's storage cannot influence it.
 */
export function isTestOverrideActive(input: Pick<EntitlementCheckInput, 'overrideHeaderValue' | 'configuredOverrideSecret'>): boolean {
  if (!input.configuredOverrideSecret) return false
  if (!input.overrideHeaderValue) return false
  return timingSafeEqual(input.overrideHeaderValue, input.configuredOverrideSecret)
}

export function canUse(key: EntitlementKey, input: EntitlementCheckInput): boolean {
  if (isTestOverrideActive(input)) return true
  const plan = resolveEnvironmentDefaultPlan(input.environment)
  return PLAN_ENTITLEMENTS[plan][key]
}
