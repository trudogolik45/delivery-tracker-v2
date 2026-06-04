import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { LoginInputSchema, LoginResponseSchema, MeResponseSchema } from '@delivery/schemas'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { isProd } from '../env.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { signSession, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './jwt.js'
import { requireAuth, type AuthEnv } from './middleware.js'
import { recordFailure, isBlocked, extractIp } from './rate-limiter.js'

export const authRoutes = new Hono<AuthEnv>()

// Precomputed dummy hash used for constant-time comparison when a user is not
// found. Without this, missing-user paths return in <5ms while existing-user
// paths take ~50ms (argon2 time cost), leaking user enumeration via timing.
// We initialise it lazily on first login attempt to avoid blocking app startup.
let dummyHash: string | null = null
async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await hashPassword('dummy-constant-time-not-used')
  }
  return dummyHash
}

authRoutes.post('/login', zValidator('json', LoginInputSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const normalizedEmail = email.trim().toLowerCase()

  const ip = extractIp(c.req.header('x-forwarded-for'), c.req.header('x-real-ip'))
  const rateLimitKey = `${ip}:${normalizedEmail}`

  // Reject immediately if already over limit from prior requests.
  const preCheck = isBlocked(rateLimitKey)
  if (preCheck) {
    return c.json({ error: 'too many failed login attempts' }, 429, {
      'Retry-After': String(preCheck.retryAfterSeconds),
    })
  }

  const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)

  let credentialsValid: boolean
  if (!user) {
    // Constant-time path: always run argon2 against a dummy hash so the response
    // time is indistinguishable from a real user lookup + failed verify.
    await verifyPassword(await getDummyHash(), password)
    credentialsValid = false
  } else {
    credentialsValid = await verifyPassword(user.passwordHash, password)
  }

  if (!credentialsValid) {
    const limited = recordFailure(rateLimitKey)
    if (limited) {
      return c.json({ error: 'too many failed login attempts' }, 429, {
        'Retry-After': String(limited.retryAfterSeconds),
      })
    }
    return c.json({ error: 'invalid credentials' }, 401)
  }

  const token = await signSession(user!.id)
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return c.json(
    LoginResponseSchema.parse({
      user: { id: user!.id, email: user!.email },
    }),
  )
})

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  return c.body(null, 204)
})

authRoutes.get('/me', requireAuth, (c) => {
  const user = c.get('user')
  return c.json(MeResponseSchema.parse({ user }))
})
