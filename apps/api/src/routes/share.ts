import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import length from '@turf/length'
import { ShareResponseSchema, TripSchema } from '@delivery/schemas'
import { db } from '../db/index.js'
import { trips, cargo, brands } from '../db/schema.js'
import { resolvePhotoUrls } from '../uploads.js'

export const shareRoutes = new Hono()

shareRoutes.get('/:hash', async (c) => {
  const hash = c.req.param('hash')

  const [row] = await db
    .select({
      tripId: trips.id,
      brandShareDomain: brands.shareDomain,
      startsAt: trips.startsAt,
      routeGeometry: trips.routeGeometry,
      timeline: trips.timeline,
      pauses: trips.pauses,
      cargoId: cargo.id,
      cargoTitle: cargo.title,
      cargoFields: cargo.fields,
      cargoPhotoUploadIds: cargo.photoUploadIds,
    })
    .from(trips)
    .innerJoin(cargo, eq(cargo.id, trips.cargoId))
    .innerJoin(brands, eq(brands.id, trips.brandId))
    .where(eq(trips.shareHash, hash))
    .limit(1)

  if (!row) {
    return c.json({ error: 'trip not found' }, 404)
  }

  const host = c.req.header('host')?.split(':')[0]?.toLowerCase()
  if (host !== row.brandShareDomain) {
    return c.json(
      { redirectTo: `https://${row.brandShareDomain}/s/${hash}` },
      421,
    )
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
    pauses: Array.isArray(row.pauses) ? row.pauses : [],
  })

  const photoUrls = await resolvePhotoUrls(row.cargoPhotoUploadIds)

  return c.json(
    ShareResponseSchema.parse({
      trip,
      cargo: {
        id: row.cargoId,
        title: row.cargoTitle,
        fields: row.cargoFields as Record<string, string>,
        photoUrls,
      },
    }),
  )
})
