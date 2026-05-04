import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import length from '@turf/length'
import { ShareResponseSchema, TripSchema } from '@delivery/schemas'
import { db } from '../db/index.js'
import { trips, cargo } from '../db/schema.js'
import { requireShareBrand, type BrandEnv } from '../middleware/tenant.js'

export const shareRoutes = new Hono<BrandEnv>()

shareRoutes.use('*', requireShareBrand)

shareRoutes.get('/:hash', async (c) => {
  const brand = c.get('brand')
  const hash = c.req.param('hash')

  const [row] = await db
    .select({
      tripId: trips.id,
      brandId: trips.brandId,
      startsAt: trips.startsAt,
      routeGeometry: trips.routeGeometry,
      timeline: trips.timeline,
      cargoId: cargo.id,
      cargoTitle: cargo.title,
    })
    .from(trips)
    .innerJoin(cargo, eq(cargo.id, trips.cargoId))
    .where(eq(trips.shareHash, hash))
    .limit(1)

  if (!row || row.brandId !== brand.id) {
    return c.json({ error: 'trip not found' }, 404)
  }

  if (!row.routeGeometry || !row.timeline) {
    return c.json({ error: 'trip not generated' }, 409)
  }

  const polyline = TripSchema.shape.polyline.parse(row.routeGeometry)
  const segments = TripSchema.shape.segments.parse(row.timeline)
  const totalDistance =
    length(
      { type: 'Feature', geometry: polyline, properties: {} },
      { units: 'kilometers' },
    ) * 1000

  const trip = TripSchema.parse({
    startedAt: Math.floor(row.startsAt.getTime() / 1000),
    polyline,
    totalDistance,
    segments,
  })

  return c.json(
    ShareResponseSchema.parse({
      trip,
      cargo: { id: row.cargoId, title: row.cargoTitle },
    }),
  )
})
