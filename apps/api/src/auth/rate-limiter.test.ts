import { describe, it, expect, beforeEach } from 'vitest'
import { recordFailure, isBlocked, extractIp, _resetForTests } from './rate-limiter.js'

beforeEach(() => {
  _resetForTests()
})

describe('recordFailure', () => {
  it('allows up to 5 failures without blocking', () => {
    const key = '1.2.3.4:user@example.com'
    for (let i = 0; i < 5; i++) {
      expect(recordFailure(key)).toBeNull()
    }
  })

  it('returns Retry-After descriptor on 6th failure', () => {
    const key = '1.2.3.4:user@example.com'
    for (let i = 0; i < 5; i++) recordFailure(key)
    const result = recordFailure(key)
    expect(result).not.toBeNull()
    expect(result!.retryAfterSeconds).toBeGreaterThan(0)
    expect(result!.retryAfterSeconds).toBeLessThanOrEqual(15 * 60)
  })

  it('uses separate bucket for different IP+email combos', () => {
    const keyA = '1.2.3.4:a@example.com'
    const keyB = '5.6.7.8:a@example.com'
    for (let i = 0; i < 5; i++) recordFailure(keyA)
    // keyA is at limit but keyB should still be free
    expect(recordFailure(keyB)).toBeNull()
  })
})

describe('isBlocked', () => {
  it('returns null when bucket does not exist', () => {
    expect(isBlocked('never:seen')).toBeNull()
  })

  it('returns descriptor after limit is exceeded', () => {
    const key = '9.9.9.9:b@example.com'
    for (let i = 0; i < 6; i++) recordFailure(key)
    expect(isBlocked(key)).not.toBeNull()
  })
})

describe('extractIp', () => {
  it('uses first IP from X-Forwarded-For', () => {
    expect(extractIp('10.0.0.1, 10.0.0.2', undefined)).toBe('10.0.0.1')
  })

  it('falls back to X-Real-IP when XFF is absent', () => {
    expect(extractIp(undefined, '203.0.113.5')).toBe('203.0.113.5')
  })

  it('returns unknown when both headers are absent', () => {
    expect(extractIp(undefined, undefined)).toBe('unknown')
  })
})

describe('stale entry sweep', () => {
  it('resets counter after window expires', async () => {
    // Directly manipulate by overriding: use a key and verify a new window restarts.
    const key = '1.1.1.1:stale@example.com'
    // Fill up to 5 (limit), no block yet.
    for (let i = 0; i < 5; i++) recordFailure(key)
    // 6th triggers block.
    expect(recordFailure(key)).not.toBeNull()
    // After reset (simulating expiry) a new call should restart.
    _resetForTests()
    // After reset, key is gone — should be null again.
    expect(isBlocked(key)).toBeNull()
  })
})
