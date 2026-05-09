import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { timingSafeEqual } from 'crypto'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'
import { env } from '../env.js'

export const internalRoutes = new Hono()

// All internal routes are protected by INTERNAL_TOKEN middleware.
// Additionally, Caddy blocks /api/internal/* before it reaches this handler for
// any request coming through the public-facing :443 block.
// Defense-in-depth: even if Caddy is misconfigured, the token check stops access.

function checkToken(token: string | undefined): boolean {
  if (!token) return false
  const expected = Buffer.from(env.INTERNAL_TOKEN, 'utf8')
  const received = Buffer.from(token, 'utf8')
  // Length pre-check: timingSafeEqual throws on length mismatch.
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

internalRoutes.use('*', async (c, next) => {
  // Accept token from x-internal-token header OR ?token= query param.
  // The query-param fallback is required because Caddy's on_demand_tls.ask
  // uses a plain GET with no custom headers; the token is injected via the URL.
  const token = c.req.header('x-internal-token') ?? c.req.query('token')
  if (!checkToken(token)) {
    // Return 404 (not 401) to avoid disclosing endpoint existence.
    return c.text('not found', 404)
  }
  await next()
})

// Called by Caddy on-demand TLS to validate whether a domain is registered.
// Caddy config: on_demand_tls { ask http://api:3000/internal/validate-domain?token={env.INTERNAL_TOKEN} }
// This endpoint is also blocked at the Caddy layer for public brand domains via:
//   @internal path /api/internal/*
//   handle @internal { respond "Not Found" 404 }
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
