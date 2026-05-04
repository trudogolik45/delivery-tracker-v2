import { Hono } from 'hono'
import { BrandSchema } from '@delivery/schemas'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'
import { requireAuth, type AuthEnv } from '../auth/middleware.js'
import { requireAdminBrand, type BrandEnv } from '../middleware/tenant.js'

type AdminEnv = AuthEnv & BrandEnv

export const adminRoutes = new Hono<AdminEnv>()

adminRoutes.use('*', requireAuth)

adminRoutes.get('/brands', async (c) => {
  const rows = await db.select().from(brands)
  const result = rows.map((b) =>
    BrandSchema.parse({
      id: b.id,
      slug: b.slug,
      name: b.name,
    }),
  )
  return c.json(result)
})

const brandScoped = new Hono<AdminEnv>()
brandScoped.use('*', requireAdminBrand)

brandScoped.get('/dashboard', (c) => {
  return c.json({ brand: c.get('brand') })
})

brandScoped.get('/trips', (c) => {
  return c.json([])
})

adminRoutes.route('/b/:brandSlug', brandScoped)
