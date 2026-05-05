import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { BrandSchema, GenerateTripInputSchema } from '@delivery/schemas'
import { generateTrip, HosError } from '@delivery/simulation/generate'
import { db } from '../db/index.js'
import { brands, cargo, trips } from '../db/schema.js'
import { requireAuth, type AuthEnv } from '../auth/middleware.js'
import { requireAdminBrand, type BrandEnv } from '../middleware/tenant.js'
import { env } from '../env.js'

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

brandScoped.post('/trips', zValidator('json', GenerateTripInputSchema), async (c) => {
  if (!env.MAPBOX_TOKEN) {
    return c.json({ error: 'MAPBOX_TOKEN not configured on server' }, 503)
  }

  const input = c.req.valid('json')
  const brand = c.get('brand')

  const [cargoRow] = await db
    .select({ id: cargo.id })
    .from(cargo)
    .where(and(eq(cargo.id, input.cargoId), eq(cargo.brandId, brand.id)))
    .limit(1)

  if (!cargoRow) {
    return c.json({ error: 'cargo not found' }, 404)
  }

  let trip
  try {
    trip = await generateTrip(input, { mapboxToken: env.MAPBOX_TOKEN })
  } catch (err) {
    if (err instanceof HosError) {
      return c.json({ error: err.message, minimumArrival: err.minimumArrival }, 422)
    }
    throw err
  }

  const shareHash = nanoid(16)
  const [row] = await db
    .insert(trips)
    .values({
      brandId: brand.id,
      cargoId: input.cargoId,
      shareHash,
      origin: input.origin,
      destination: input.destination,
      waypoints: input.waypoints,
      startsAt: new Date(input.startedAt * 1000),
      desiredArrival: new Date(input.desiredArrival * 1000),
      routeGeometry: trip.polyline,
      timeline: trip.segments,
    })
    .returning({ id: trips.id, shareHash: trips.shareHash })

  return c.json({ tripId: row!.id, shareHash: row!.shareHash }, 201)
})

adminRoutes.route('/b/:brandSlug', brandScoped)
