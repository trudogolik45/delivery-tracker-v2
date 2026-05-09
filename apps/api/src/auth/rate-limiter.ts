// In-memory token-bucket rate limiter for login attempts.
// Key: "<ip>:<normalizedEmail>" — separate bucket per IP+email combination.
// Limit: 5 failures per 15-minute window. Successful logins do NOT count.
//
// Trusted-proxy assumption: IP is extracted from X-Forwarded-For set by Caddy.
// If Caddy is not in front (e.g., local dev without proxy), 'unknown' is used.
// Do not expose this API server publicly without Caddy — any proxy hop is trusted.

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const MAX_MAP_SIZE = 10_000
const SWEEP_INTERVAL = 100

type Bucket = { count: number; windowStart: number }

const buckets = new Map<string, Bucket>()
let callCount = 0

function sweep(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) {
      buckets.delete(key)
    }
  }
}

function evictOldest(): void {
  // Drop the entry with the oldest windowStart to cap map size.
  let oldestKey: string | undefined
  let oldestTs = Infinity
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < oldestTs) {
      oldestTs = bucket.windowStart
      oldestKey = key
    }
  }
  if (oldestKey !== undefined) {
    buckets.delete(oldestKey)
  }
}

export function extractIp(
  forwardedFor: string | undefined,
  realIp: string | undefined,
): string {
  const xff = forwardedFor?.split(',')[0]?.trim()
  return xff ?? realIp ?? 'unknown'
}

/**
 * Record a failed login attempt for the given key.
 * Returns a 429 descriptor if limit exceeded, or null if still within limit.
 */
export function recordFailure(key: string): { retryAfterSeconds: number } | null {
  callCount++
  if (callCount % SWEEP_INTERVAL === 0) sweep()

  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    // New or expired window — start fresh with count 1.
    if (buckets.size >= MAX_MAP_SIZE) evictOldest()
    buckets.set(key, { count: 1, windowStart: now })
    return null
  }

  existing.count++

  if (existing.count > MAX_FAILURES) {
    const windowEndMs = existing.windowStart + WINDOW_MS
    const retryAfterSeconds = Math.ceil((windowEndMs - now) / 1000)
    return { retryAfterSeconds }
  }

  return null
}

/**
 * Check whether the bucket for key is already over limit (without recording).
 * Used to reject immediately on subsequent calls after hitting the cap.
 */
export function isBlocked(key: string): { retryAfterSeconds: number } | null {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= WINDOW_MS) return null
  if (existing.count > MAX_FAILURES) {
    const windowEndMs = existing.windowStart + WINDOW_MS
    const retryAfterSeconds = Math.ceil((windowEndMs - now) / 1000)
    return { retryAfterSeconds }
  }
  return null
}

// Exported for tests only — reset state between test runs.
export function _resetForTests(): void {
  buckets.clear()
  callCount = 0
}
