import { createMiddleware } from 'hono/factory'
import { and, eq } from 'drizzle-orm'
import type { Brand } from '@delivery/schemas'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'
import type { AuthEnv } from '../auth/middleware.js'

export type BrandEnv = {
  Variables: {
    brand: Brand
  }
}

export const requireAdminBrand = createMiddleware<AuthEnv & BrandEnv>(async (c, next) => {
  const slug = c.req.param('brandSlug')
  if (!slug) {
    return c.json({ error: 'brand not found' }, 404)
  }

  const user = c.get('user')
  const [row] = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      shareDomain: brands.shareDomain,
    })
    .from(brands)
    .where(and(eq(brands.slug, slug), eq(brands.ownerId, user.id)))
    .limit(1)

  if (!row) {
    return c.json({ error: 'brand not found' }, 404)
  }

  c.set('brand', row)
  await next()
})
