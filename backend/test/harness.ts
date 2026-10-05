import { createHandler } from '../src/handler'
import { createMemoryStore } from '../src/memoryStore'

/**
 * Test harness: runs the real handler against an in-memory store, with a
 * mutable `env` standing in for deployment configuration (tests flip
 * ENVIRONMENT / DEFAULT_PLAN / override secret to simulate deployments).
 * `SELF.fetch` mirrors the global `fetch` signature the tests call.
 */
export const env: {
  ENVIRONMENT: string
  ALLOWED_ORIGINS: string
  DEFAULT_PLAN?: string
  DYNAMIC_QR_TEST_OVERRIDE_SECRET?: string
} = { ENVIRONMENT: 'development', ALLOWED_ORIGINS: 'http://localhost:5173' }

export const store = createMemoryStore()

export const SELF = {
  fetch(input: string, init?: RequestInit): Promise<Response> {
    const handler = createHandler({
      store,
      config: {
        environment: env.ENVIRONMENT as 'development' | 'staging' | 'production',
        allowedOrigins: env.ALLOWED_ORIGINS,
        defaultPlan: env.DEFAULT_PLAN,
        testOverrideSecret: env.DYNAMIC_QR_TEST_OVERRIDE_SECRET
      }
    })
    return handler(new Request(input, init))
  }
}
