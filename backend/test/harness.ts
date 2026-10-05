import { createHandler } from '../src/handler'
import { createMemoryStore } from '../src/memoryStore'
import type { RateLimiter } from '../src/lib/rateLimit'

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

/** Fake identity provider: ID token string → uid. Anything not listed is an invalid token. */
export const idTokens: Record<string, string> = { 'id-token-A': 'uid-A', 'id-token-B': 'uid-B' }

/** Set to a RateLimiter to exercise 429s; undefined (default) leaves limiting off, as most tests need. */
export const limiterRef: { current?: RateLimiter } = {}

export const SELF = {
  fetch(input: string, init?: RequestInit): Promise<Response> {
    const handler = createHandler({
      store,
      verifyIdToken: async (t) => idTokens[t] ?? null,
      limiter: limiterRef.current,
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
