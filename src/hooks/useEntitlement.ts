import type { EntitlementKey } from '@/types/entitlements'
import { entitlementService } from '@/services/entitlements/entitlementService'

/**
 * The only thing wizard UI should ever call to decide whether a feature is
 * available — never a plan comparison inline in a component. See README →
 * "Entitlements".
 */
export function useEntitlement(key: EntitlementKey): { allowed: boolean; plan: ReturnType<typeof entitlementService.currentPlan> } {
  return { allowed: entitlementService.canUse(key), plan: entitlementService.currentPlan() }
}
