import { defineString } from 'firebase-functions/params'
import type { AppConfig } from './types'

/**
 * Deployment configuration, as Cloud Functions *params* (plain, non-secret
 * values with in-repo defaults; override per deployment with a `.env` file
 * or the environment). Nothing here is a credential.
 *
 * - ENVIRONMENT: `production` unless overridden (the emulator/local runs set
 *   `development`).
 * - DEFAULT_PLAN: the product currently operates at Business level — Dynamic
 *   QR is available to everyone. Remove/override to fall back to the safe
 *   per-environment default (production → free). Keep in step with the
 *   frontend's VITE_DEFAULT_PLAN.
 * - ALLOWED_ORIGINS: exact origins allowed to call the API from a browser.
 */
const ENVIRONMENT = defineString('ENVIRONMENT', { default: 'production' })
const DEFAULT_PLAN = defineString('DEFAULT_PLAN', { default: 'business' })
const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS', { default: 'https://sanjugupta.com,https://sanjug05.github.io,http://localhost:5173' })

export function loadConfig(): AppConfig {
  const environment = ENVIRONMENT.value()
  return {
    environment: environment === 'development' || environment === 'staging' ? environment : 'production',
    allowedOrigins: ALLOWED_ORIGINS.value(),
    defaultPlan: DEFAULT_PLAN.value() || undefined,
    // Deliberately not wired to any deployed secret: the override path does not exist unless someone provisions one.
    testOverrideSecret: process.env.DYNAMIC_QR_TEST_OVERRIDE_SECRET || undefined
  }
}
