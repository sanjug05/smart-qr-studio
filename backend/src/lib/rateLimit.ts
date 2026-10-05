/**
 * A small in-memory sliding-window limiter — a cost/abuse safeguard for a
 * free public tool, not a security boundary. State is per Cloud Functions
 * instance (instances are capped by `maxInstances`), so it blunts trivial
 * scripted floods of creation/management calls without adding a paid
 * service or a Firestore write per request. Legitimate use stays far below
 * every limit here.
 */
export interface RateLimiter {
  /** Records one hit for `key`; returns the seconds to wait if the caller is over `limit` within `windowMs`, else null. */
  hit(key: string, limit: number, windowMs: number, now?: number): number | null
}

const MAX_TRACKED_KEYS = 20_000

export function createRateLimiter(): RateLimiter {
  const hits = new Map<string, number[]>()

  return {
    hit(key, limit, windowMs, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000))
      }
      recent.push(now)
      hits.set(key, recent)

      if (hits.size > MAX_TRACKED_KEYS) {
        for (const [k, times] of hits) {
          if (times.every((t) => now - t >= windowMs)) hits.delete(k)
        }
      }
      return null
    }
  }
}

/** Best-effort client address: the first hop of X-Forwarded-For (set by Google's front end), else a shared bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || 'unknown'
}
