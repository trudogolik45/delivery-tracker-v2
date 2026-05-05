import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'

export const internalRoutes = new Hono()

// Called by Caddy on-demand TLS to validate whether a domain is registered.
// Network-isolated: api has no public ports, only reachable from docker network.
internalRoutes.get('/validate-domain', async (c) => {
  const domain = c.req.query('domain')
  if (!domain) return c.text('missing domain', 400)

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.shareDomain, domain))
    .limit(1)

  return brand ? c.text('ok', 200) : c.text('not found', 404)
})
