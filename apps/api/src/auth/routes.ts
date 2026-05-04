import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { LoginInputSchema, LoginResponseSchema, MeResponseSchema } from '@delivery/schemas'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { isProd } from '../env.js'
import { verifyPassword } from './passwords.js'
import { signSession, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './jwt.js'
import { requireAuth, type AuthEnv } from './middleware.js'

export const authRoutes = new Hono<AuthEnv>()

authRoutes.post('/login', zValidator('json', LoginInputSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const normalizedEmail = email.trim().toLowerCase()

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    return c.json({ error: 'invalid credentials' }, 401)
  }

  const token = await signSession(user.id)
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return c.json(
    LoginResponseSchema.parse({
      user: { id: user.id, email: user.email },
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
