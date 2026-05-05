import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, and, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import length from '@turf/length'
import { TripSchema } from '@delivery/schemas'
import {
  BrandSchema,
  GenerateTripInputSchema,
  CargoCreateSchema,
  CargoUpdateSchema,
  TripPreviewInputSchema,
} from '@delivery/schemas'
import { generateTrip, HosError } from '@delivery/simulation/generate'
import { db } from '../db/index.js'
import { brands, cargo, trips, uploads } from '../db/schema.js'
import { requireAuth, type AuthEnv } from '../auth/middleware.js'
import { requireAdminBrand, type BrandEnv } from '../middleware/tenant.js'
import { env } from '../env.js'
import { storage, makeKey } from '../storage/index.js'

type AdminEnv = AuthEnv & BrandEnv

export const adminRoutes = new Hono<AdminEnv>()

adminRoutes.use('*', requireAuth)

adminRoutes.get('/brands', async (c) => {
  const rows = await db.select().from(brands)
  return c.json(
    rows.map((b) =>
      BrandSchema.parse({ id: b.id, slug: b.slug, name: b.name, shareDomain: b.shareDomain }),
    ),
  )
})

// Mapbox geocoding proxy — keeps token server-side
adminRoutes.get('/geocode', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q || q.length < 2) return c.json([])
  if (!env.MAPBOX_TOKEN) return c.json([])

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${env.MAPBOX_TOKEN}&limit=5&types=address,place`
  const res = await fetch(url)
  if (!res.ok) return c.json([])

  const data = (await res.json()) as {
    features: Array<{ place_name: string; center: [number, number] }>
  }
  return c.json(
    data.features.map((f) => ({ label: f.place_name, lng: f.center[0], lat: f.center[1] })),
  )
})

// ─── Brand-scoped routes ──────────────────────────────────────────────────────

const brandScoped = new Hono<AdminEnv>()
brandScoped.use('*', requireAdminBrand)

brandScoped.get('/dashboard', (c) => c.json({ brand: c.get('brand') }))

// ── Cargo CRUD ────────────────────────────────────────────────────────────────

async function resolvePhotoUrls(photoUploadIds: string[]): Promise<string[]> {
  if (photoUploadIds.length === 0) return []
  const rows = await db
    .select({ id: uploads.id, storageKey: uploads.storageKey })
    .from(uploads)
    .where(inArray(uploads.id, photoUploadIds))
  const keyMap = new Map(rows.map((r) => [r.id, r.storageKey]))
  return photoUploadIds
    .map((id) => keyMap.get(id))
    .filter((k): k is string => k !== undefined)
    .map((k) => storage.url(k))
}

brandScoped.get('/cargo', async (c) => {
  const brand = c.get('brand')
  const rows = await db.select().from(cargo).where(eq(cargo.brandId, brand.id))
  const result = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      fields: r.fields as Record<string, string>,
      photoUploadIds: r.photoUploadIds,
      photoUrls: await resolvePhotoUrls(r.photoUploadIds),
      createdAt: r.createdAt.toISOString(),
    })),
  )
  return c.json(result)
})

brandScoped.post('/cargo', zValidator('json', CargoCreateSchema), async (c) => {
  const brand = c.get('brand')
  const { title, fields, photoUploadIds } = c.req.valid('json')
  const [row] = await db
    .insert(cargo)
    .values({ brandId: brand.id, title, fields, photoUploadIds })
    .returning()
  return c.json(
    {
      id: row!.id,
      title: row!.title,
      fields: row!.fields as Record<string, string>,
      photoUploadIds: row!.photoUploadIds,
      photoUrls: await resolvePhotoUrls(row!.photoUploadIds),
      createdAt: row!.createdAt.toISOString(),
    },
    201,
  )
})

brandScoped.get('/cargo/:cargoId', async (c) => {
  const brand = c.get('brand')
  const { cargoId } = c.req.param()
  const [row] = await db
    .select()
    .from(cargo)
    .where(and(eq(cargo.id, cargoId), eq(cargo.brandId, brand.id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({
    id: row.id,
    title: row.title,
    fields: row.fields as Record<string, string>,
    photoUploadIds: row.photoUploadIds,
    photoUrls: await resolvePhotoUrls(row.photoUploadIds),
    createdAt: row.createdAt.toISOString(),
  })
})

brandScoped.put('/cargo/:cargoId', zValidator('json', CargoUpdateSchema), async (c) => {
  const brand = c.get('brand')
  const { cargoId } = c.req.param()
  const updates = c.req.valid('json')

  const [existing] = await db
    .select({ id: cargo.id })
    .from(cargo)
    .where(and(eq(cargo.id, cargoId), eq(cargo.brandId, brand.id)))
    .limit(1)
  if (!existing) return c.json({ error: 'not found' }, 404)

  const [row] = await db
    .update(cargo)
    .set({ ...updates, fields: updates.fields ?? undefined })
    .where(eq(cargo.id, cargoId))
    .returning()
  return c.json({
    id: row!.id,
    title: row!.title,
    fields: row!.fields as Record<string, string>,
    photoUploadIds: row!.photoUploadIds,
    photoUrls: await resolvePhotoUrls(row!.photoUploadIds),
    createdAt: row!.createdAt.toISOString(),
  })
})

brandScoped.delete('/cargo/:cargoId', async (c) => {
  const brand = c.get('brand')
  const { cargoId } = c.req.param()
  const [deleted] = await db
    .delete(cargo)
    .where(and(eq(cargo.id, cargoId), eq(cargo.brandId, brand.id)))
    .returning({ id: cargo.id })
  if (!deleted) return c.json({ error: 'not found' }, 404)
  return c.body(null, 204)
})

// ── Trips ─────────────────────────────────────────────────────────────────────

brandScoped.get('/trips', async (c) => {
  const brand = c.get('brand')
  const rows = await db
    .select({
      id: trips.id,
      shareHash: trips.shareHash,
      cargoId: trips.cargoId,
      origin: trips.origin,
      destination: trips.destination,
      startsAt: trips.startsAt,
      desiredArrival: trips.desiredArrival,
      timeline: trips.timeline,
      routeGeometry: trips.routeGeometry,
      cargoTitle: cargo.title,
    })
    .from(trips)
    .leftJoin(cargo, eq(trips.cargoId, cargo.id))
    .where(eq(trips.brandId, brand.id))
  return c.json(
    rows.map((r) => {
      return {
        id: r.id,
        shareHash: r.shareHash,
        cargoId: r.cargoId,
        cargoTitle: r.cargoTitle ?? '',
        origin: r.origin,
        destination: r.destination,
        startsAt: r.startsAt.toISOString(),
        desiredArrival: r.desiredArrival.toISOString(),
        startedAt: Array.isArray(r.timeline) && r.timeline.length > 0
          ? (r.timeline[0] as { tStart: number }).tStart
          : null,
        totalDistance: (r.routeGeometry as { totalDistance?: number } | null)?.totalDistance ?? null,
        timeline: r.timeline,
      }
    }),
  )
})

brandScoped.get('/trips/:tripId', async (c) => {
  const brand = c.get('brand')
  const { tripId } = c.req.param()
  const [row] = await db
    .select({
      id: trips.id,
      shareHash: trips.shareHash,
      cargoId: trips.cargoId,
      origin: trips.origin,
      destination: trips.destination,
      waypoints: trips.waypoints,
      startsAt: trips.startsAt,
      desiredArrival: trips.desiredArrival,
      timeline: trips.timeline,
      routeGeometry: trips.routeGeometry,
      cargoTitle: cargo.title,
    })
    .from(trips)
    .leftJoin(cargo, eq(trips.cargoId, cargo.id))
    .where(and(eq(trips.id, tripId), eq(trips.brandId, brand.id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)

  let tripObj = null
  if (row.routeGeometry && row.timeline) {
    const polyline = TripSchema.shape.polyline.parse(row.routeGeometry)
    const segments = TripSchema.shape.segments.parse(row.timeline)
    const totalDistance =
      length(
        { type: 'Feature', geometry: polyline, properties: {} },
        { units: 'kilometers' },
      ) * 1000
    tripObj = TripSchema.parse({
      startedAt: segments[0]!.tStart,
      polyline,
      totalDistance,
      segments,
    })
  }

  return c.json({
    id: row.id,
    shareHash: row.shareHash,
    shareDomain: brand.shareDomain,
    cargoId: row.cargoId,
    cargoTitle: row.cargoTitle ?? '',
    origin: row.origin,
    destination: row.destination,
    waypoints: row.waypoints,
    startsAt: row.startsAt.toISOString(),
    desiredArrival: row.desiredArrival.toISOString(),
    trip: tripObj,
  })
})

brandScoped.delete('/trips/:tripId', async (c) => {
  const brand = c.get('brand')
  const { tripId } = c.req.param()
  const [deleted] = await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), eq(trips.brandId, brand.id)))
    .returning({ id: trips.id })
  if (!deleted) return c.json({ error: 'not found' }, 404)
  return c.body(null, 204)
})

brandScoped.post('/trips/preview', zValidator('json', TripPreviewInputSchema), async (c) => {
  if (!env.MAPBOX_TOKEN) {
    return c.json({ error: 'MAPBOX_TOKEN not configured on server' }, 503)
  }
  const input = c.req.valid('json')
  try {
    const trip = await generateTrip(input as Parameters<typeof generateTrip>[0], {
      mapboxToken: env.MAPBOX_TOKEN,
    })
    return c.json({ trip })
  } catch (err) {
    if (err instanceof HosError) {
      return c.json({ error: err.message, minimumArrival: err.minimumArrival }, 422)
    }
    throw err
  }
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
  if (!cargoRow) return c.json({ error: 'cargo not found' }, 404)

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

// ── Uploads ───────────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 10 * 1024 * 1024

brandScoped.post('/uploads', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!(file instanceof File)) {
    return c.json({ error: 'file field required' }, 400)
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return c.json({ error: 'unsupported file type' }, 415)
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'file too large (max 10 MB)' }, 413)
  }

  const data = Buffer.from(await file.arrayBuffer())
  const key = makeKey(data, file.type)
  const sha256 = key.split('.')[0]!

  if (!(await storage.exists(key))) {
    await storage.put(key, data, file.type)
  }

  const [inserted] = await db
    .insert(uploads)
    .values({ storageKey: key, mimeType: file.type, sizeBytes: file.size, sha256 })
    .onConflictDoNothing()
    .returning({ id: uploads.id })

  let uploadId: string
  if (inserted) {
    uploadId = inserted.id
  } else {
    const [existing] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.storageKey, key))
      .limit(1)
    uploadId = existing!.id
  }

  return c.json({ uploadId, url: storage.url(key), mimeType: file.type, sizeBytes: file.size }, 201)
})

adminRoutes.route('/b/:brandSlug', brandScoped)
