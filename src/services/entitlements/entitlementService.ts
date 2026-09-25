import { PLAN_ENTITLEMENTS, type EntitlementKey, type Plan } from '@/types/entitlements'
import { getDynamicQrTestOverrideSecret } from '@/services/dynamicQr/config'

/**
 * The single question the UI is allowed to ask: "can this feature be used
 * right now?" No component ever compares a plan string directly (no
 * `if (plan === 'pro')` scattered around) — see README → "Entitlements".
 * Swapping this for a real per-account plan lookup later (once billing
 * exists) means replacing the implementation below, not any call site —
 * every consumer only ever imports `entitlementService`.
 */
export interface EntitlementService {
  canUse(key: EntitlementKey): boolean
  /** Exposed for UI copy ("Upgrade to Pro") — never for gating logic itself. */
  currentPlan(): Plan
}

/**
 * The plan this build was explicitly configured to run as, via the
 * build-time `VITE_DEFAULT_PLAN` (`free` | `pro` | `business`). Missing or
 * unrecognized values yield `undefined`, so a typo can never grant more than
 * the environment default below would.
 */
function configuredPlan(): Plan | undefined {
  const value: string | undefined = import.meta.env.VITE_DEFAULT_PLAN
  return value !== undefined && Object.prototype.hasOwnProperty.call(PLAN_ENTITLEMENTS, value) ? (value as Plan) : undefined
}

/**
 * V1 implementation: no accounts/billing exist yet, so entitlement is
 * decided by the deployed environment alone. The product is currently
 * operated at Business level, which the GitHub Pages workflow declares
 * with `VITE_DEFAULT_PLAN=business` — no plan tiers are sold yet. Without
 * that variable the original safe defaults apply: `development` and any
 * Vite dev server run as `pro` so Dynamic QR can be built and tested
 * end-to-end without billing; a production build defaults every visitor to
 * `free` ("production entitlement must default safely").
 *
 * The one exception is a deliberately-configured test-override build (see
 * config.ts's `getDynamicQrTestOverrideSecret`) — this only ever comes
 * from a build-time env var, never a query string or `localStorage`, so it
 * cannot be flipped on by an end user inspecting or editing this app in
 * their own browser. Note this only changes what the *UI* shows as
 * available; the backend enforces its own independent, separately
 * configured copy of this same override on every `POST /v1/qr` (see
 * backend/src/lib/entitlements.ts) regardless of what this class decides —
 * so even a tampered frontend bundle claiming `canUse('dynamicQr')` is
 * `true` cannot make the backend actually create one without also holding
 * the backend's matching secret.
 */
class EnvironmentEntitlementService implements EntitlementService {
  private readonly plan: Plan = configuredPlan() ?? (import.meta.env.PROD && !getDynamicQrTestOverrideSecret() ? 'free' : 'pro')

  canUse(key: EntitlementKey): boolean {
    return PLAN_ENTITLEMENTS[this.plan][key]
  }

  currentPlan(): Plan {
    return this.plan
  }
}

// Single shared instance, mirroring the existing `projectRepository` pattern
// (see src/services/storage/projectRepository.ts) — replace with a
// `RemoteEntitlementService` once accounts/billing exist.
export const entitlementService: EntitlementService = new EnvironmentEntitlementService()
