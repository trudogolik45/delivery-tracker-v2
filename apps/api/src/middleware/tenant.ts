import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import type { Brand } from '@delivery/schemas'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'

export type BrandEnv = {
  Variables: {
    brand: Brand
  }
}

async function loadBrandBy(
  field: typeof brands.slug | typeof brands.shareDomain,
  value: string,
): Promise<Brand | null> {
  const [row] = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      shareDomain: brands.shareDomain,
    })
    .from(brands)
    .where(eq(field, value))
    .limit(1)

  return row ?? null
}

export const requireAdminBrand = createMiddleware<BrandEnv>(async (c, next) => {
  const slug = c.req.param('brandSlug')
  if (!slug) {
    return c.json({ error: 'brand not found' }, 404)
  }

  const brand = await loadBrandBy(brands.slug, slug)
  if (!brand) {
    return c.json({ error: 'brand not found' }, 404)
  }

  c.set('brand', brand)
  await next()
})
