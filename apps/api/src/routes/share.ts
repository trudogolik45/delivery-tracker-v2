import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import length from '@turf/length'
import { ShareResponseSchema } from '@delivery/schemas'
import type { Trip } from '@delivery/schemas'
import { db } from '../db/index.js'
import { brands } from '../db/schema.js'
import { tenantDb } from '../db/tenant.js'
import { resolvePhotoUrls } from '../uploads.js'

export const shareRoutes = new Hono()

shareRoutes.get('/:hash', async (c) => {
  const hash = c.req.param('hash')

  // Host -> brand resolution. Strip port, lowercase. Without a Host header
  // we cannot scope; return 404 with no body leak.
  const host = c.req.header('host')?.split(':')[0]?.toLowerCase()
  if (!host) {
    return c.json({ error: 'trip not found' }, 404)
  }

  // Brands is the resolution table — direct query is allowed here. Uses the
  // brands_share_domain_lower_idx (migration 0011) for case-insensitive match.
  const [brand] = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      shareDomain: brands.shareDomain,
    })
    .from(brands)
    .where(sql`lower(${brands.shareDomain}) = ${host}`)
    .limit(1)

  // Unknown host: 404 with the same body as a missing trip — never reveal
  // whether the host or the hash is the cause (no brand-info oracle).
  if (!brand) {
    return c.json({ error: 'trip not found' }, 404)
  }

  // Tenant-scoped lookup: cross-brand hash collisions resolve to undefined.
  const row = await tenantDb(brand).trips.byShareHash(hash)
  if (!row) {
    return c.json({ error: 'trip not found' }, 404)
  }

  if (!row.routeGeometry || !row.timeline) {
    return c.json({ error: 'trip not generated' }, 409)
  }

  // The row was validated by TripSchema at INSERT (trip generation), so we
  // trust the stored jsonb on read and cast instead of re-parsing. The single
  // ShareResponseSchema.parse below is the one outbound contract guard — it
  // re-validates the whole trip, so intermediate parses were pure overhead.
  const polyline = row.routeGeometry as Trip['polyline']
  const segments = row.timeline as Trip['segments']

  // Prefer the persisted total (computed once at trip generation). Fall back
  // to a turf recompute only for legacy rows that pre-date the column.
  const totalDistance =
    row.totalDistanceMeters ??
    Math.round(
      length({ type: 'Feature', geometry: polyline, properties: {} }, { units: 'kilometers' }) *
        1000,
    )

  const photoUrls = await resolvePhotoUrls(brand.id, row.cargoPhotoUploadIds)

  return c.json(
    ShareResponseSchema.parse({
      trip: {
        startedAt: Math.floor(row.startsAt.getTime() / 1000),
        polyline,
        totalDistance,
        segments,
        pauses: Array.isArray(row.pauses) ? row.pauses : [],
      },
      cargo: {
        id: row.cargoId,
        title: row.cargoTitle,
        fields: row.cargoFields as Record<string, string>,
        photoUrls,
      },
    }),
  )
})
