import { Hono } from 'hono'
import { requireShareBrand, type BrandEnv } from '../middleware/tenant.js'

export const shareRoutes = new Hono<BrandEnv>()

shareRoutes.use('*', requireShareBrand)

shareRoutes.get('/', (c) => {
  return c.json({ brand: c.get('brand') })
})
