import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { SESSION_COOKIE_NAME, verifySession } from './jwt.js'

export type AuthUser = {
  id: string
  email: string
}

export type AuthEnv = {
  Variables: {
    user: AuthUser
  }
}

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) {
    return c.json({ error: 'unauthenticated' }, 401)
  }

  const payload = await verifySession(token)
  if (!payload) {
    return c.json({ error: 'unauthenticated' }, 401)
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1)

  if (!user) {
    return c.json({ error: 'unauthenticated' }, 401)
  }

  c.set('user', user)
  await next()
})
