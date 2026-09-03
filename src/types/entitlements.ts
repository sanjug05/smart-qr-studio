/**
 * Provider-neutral plan/entitlement domain model (see backend/src/lib/entitlements.ts
 * for the server-side mirror — kept as two small independent copies rather than
 * a shared package; see README → "Current limitations"). Nothing here knows
 * about Stripe, Razorpay, App Store billing, or any other billing provider —
 * billing's only job, whenever it exists, is to end up writing a `Plan`
 * somewhere an `EntitlementService` implementation can read.
 */

export type Plan = 'free' | 'pro' | 'business'

/** Only `dynamicQr` is implemented today — see src/services/entitlements/entitlementService.ts. */
export type EntitlementKey = 'dynamicQr'

export const PLAN_ENTITLEMENTS: Record<Plan, Record<EntitlementKey, boolean>> = {
  free: { dynamicQr: false },
  pro: { dynamicQr: true },
  business: { dynamicQr: true }
}
