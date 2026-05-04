import { sign, verify } from 'hono/jwt'
import { env } from '../env.js'

export const SESSION_COOKIE_NAME = 'auth'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const ALG = 'HS256' as const

type SessionPayload = {
  sub: string
  iat: number
  exp: number
}

export async function signSession(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: userId,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  }
  return sign(payload, env.JWT_SECRET, ALG)
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const decoded = (await verify(token, env.JWT_SECRET, ALG)) as SessionPayload
    if (typeof decoded.sub !== 'string') return null
    return decoded
  } catch {
    return null
  }
}
