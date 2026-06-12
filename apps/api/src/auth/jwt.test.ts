import { describe, it, expect, vi } from 'vitest'
import { sign } from 'hono/jwt'

vi.mock('../env.js', () => ({
  env: { JWT_SECRET: 'a'.repeat(32) },
  isProd: false,
}))

import { signSession, verifySession, SESSION_TTL_SECONDS } from './jwt.js'

describe('jwt primitives', () => {
  it('round-trip: verifySession returns payload with correct sub and TTL', async () => {
    const token = await signSession('user-1')
    const payload = await verifySession(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-1')
    expect(payload!.exp - payload!.iat).toBe(SESSION_TTL_SECONDS)
    // iat should be within ±2 seconds of now
    const now = Math.floor(Date.now() / 1000)
    expect(Math.abs(payload!.iat - now)).toBeLessThanOrEqual(2)
  })

  it('garbage token returns null', async () => {
    const result = await verifySession('garbage')
    expect(result).toBeNull()
  })

  it('token signed with wrong secret returns null', async () => {
    const now = Math.floor(Date.now() / 1000)
    const wrongToken = await sign(
      { sub: 'user-2', iat: now, exp: now + SESSION_TTL_SECONDS },
      'b'.repeat(32),
      'HS256',
    )
    const result = await verifySession(wrongToken)
    expect(result).toBeNull()
  })

  it('expired token returns null', async () => {
    const now = Math.floor(Date.now() / 1000)
    const expiredToken = await sign(
      { sub: 'user-3', iat: now - 10, exp: now - 5 },
      'a'.repeat(32),
      'HS256',
    )
    const result = await verifySession(expiredToken)
    expect(result).toBeNull()
  })

  it('token without sub returns null', async () => {
    const now = Math.floor(Date.now() / 1000)
    const noSubToken = await sign(
      { iat: now, exp: now + SESSION_TTL_SECONDS },
      'a'.repeat(32),
      'HS256',
    )
    const result = await verifySession(noSubToken)
    expect(result).toBeNull()
  })
})
