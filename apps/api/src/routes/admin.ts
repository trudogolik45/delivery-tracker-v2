import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, and, or, sql, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { promises as dns } from 'dns'
import length from '@turf/length'
import { TripSchema } from '@delivery/schemas'
import {
  BrandSchema,
  BrandCreateSchema,
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
import { resolvePhotoUrls } from '../uploads.js'

type AdminEnv = AuthEnv & BrandEnv

export const adminRoutes = new Hono<AdminEnv>()

adminRoutes.use('*', requireAuth)

adminRoutes.get('/brands', async (c) => {
  const user = c.get('user')
  const rows = await db.select().from(brands).where(eq(brands.ownerId, user.id))
  return c.json(
    rows.map((b) =>
      BrandSchema.parse({ id: b.id, slug: b.slug, name: b.name, shareDomain: b.shareDomain }),
    ),
  )
})

adminRoutes.post('/brands', zValidator('json', BrandCreateSchema), async (c) => {
  const { slug, name, shareDomain } = c.req.valid('json')
  const conflict = await db
    .select({ id: brands.id })
    .from(brands)
    .where(or(eq(brands.slug, slug), eq(brands.shareDomain, shareDomain)))
    .limit(1)
  if (conflict.length > 0) {
    return c.json({ error: 'slug or share domain already in use' }, 409)
  }
  const user = c.get('user')
  const [row] = await db
    .insert(brands)
    .values({ slug, name, shareDomain, ownerId: user.id })
    .returning()
  return c.json(
    BrandSchema.parse({
      id: row!.id,
      slug: row!.slug,
      name: row!.name,
      shareDomain: row!.shareDomain,
    }),
    201,
  )
})

adminRoutes.delete('/brands/:slug', async (c) => {
  const user = c.get('user')
  const { slug } = c.req.param()
  const [deleted] = await db
    .delete(brands)
    .where(and(eq(brands.slug, slug), eq(brands.ownerId, user.id)))
    .returning({ id: brands.id })
  if (!deleted) return c.json({ error: 'not found' }, 404)
  return c.body(null, 204)
})


async function safeResolve4(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host)
  } catch {
    return []
  }
}

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

// DNS status is inside brandScoped so requireAdminBrand runs first,
// enforcing owner-scoped access. Previously on the root adminRoutes which
// allowed cross-tenant brand domain/IP leak (C2).
brandScoped.get('/dns-status', async (c) => {
  const brand = c.get('brand')
  const adminHost = new URL(env.PUBLIC_BASE).hostname
  const [expected, actual] = await Promise.all([
    safeResolve4(adminHost),
    safeResolve4(brand.shareDomain),
  ])
  const resolved = actual.length > 0 && expected.some((ip) => actual.includes(ip))
  return c.json({ resolved, expected, actual })
})

// ── Cargo CRUD ────────────────────────────────────────────────────────────────

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

  if (photoUploadIds.length > 0) {
    const found = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(inArray(uploads.id, photoUploadIds), eq(uploads.brandId, brand.id)))
    if (found.length !== photoUploadIds.length) {
      return c.json({ error: 'invalid photo upload id' }, 400)
    }
  }

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

  if (updates.photoUploadIds !== undefined && updates.photoUploadIds.length > 0) {
    const found = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(inArray(uploads.id, updates.photoUploadIds), eq(uploads.brandId, brand.id)))
    if (found.length !== updates.photoUploadIds.length) {
      return c.json({ error: 'invalid photo upload id' }, 400)
    }
  }

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
      pauses: trips.pauses,
      cargoTitle: cargo.title,
    })
    .from(trips)
    .leftJoin(cargo, eq(trips.cargoId, cargo.id))
    .where(and(eq(trips.id, tripId), eq(trips.brandId, brand.id)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)

  const pauses = Array.isArray(row.pauses) ? row.pauses : []

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
      pauses,
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
    pauses,
    trip: tripObj,
  })
})

brandScoped.post('/trips/:tripId/pause', async (c) => {
  const brand = c.get('brand')
  const { tripId } = c.req.param()
  const nowSeconds = Math.floor(Date.now() / 1000)

  const body = await c.req.json().catch(() => ({})) as { durationSeconds?: unknown }
  const durationSeconds = typeof body.durationSeconds === 'number' && body.durationSeconds > 0
    ? Math.floor(body.durationSeconds)
    : undefined
  const pauseObj = durationSeconds !== undefined
    ? sql`jsonb_build_object('pausedAt', ${nowSeconds}::bigint, 'resumedAt', ${nowSeconds + durationSeconds}::bigint)`
    : sql`jsonb_build_object('pausedAt', ${nowSeconds}::bigint)`

  // WHERE encodes the "not already paused" guard atomically — avoids a
  // separate SELECT + UPDATE that would allow double-pause under concurrent calls.
  const updated = await db
    .update(trips)
    .set({
      pauses: sql`${trips.pauses} || ${pauseObj}`,
    })
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.brandId, brand.id),
        sql`(jsonb_array_length(${trips.pauses}) = 0 OR (${trips.pauses}->-1) ? 'resumedAt')`,
      ),
    )
    .returning({ id: trips.id })

  if (updated.length === 0) {
    const [exists] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.brandId, brand.id)))
      .limit(1)
    if (!exists) return c.json({ error: 'not found' }, 404)
    return c.json({ error: 'trip is already paused' }, 409)
  }

  return c.json({ ok: true })
})

brandScoped.post('/trips/:tripId/resume', async (c) => {
  const brand = c.get('brand')
  const { tripId } = c.req.param()
  const nowSeconds = Math.floor(Date.now() / 1000)

  const updated = await db
    .update(trips)
    .set({
      pauses: sql`jsonb_set(${trips.pauses}, array[(jsonb_array_length(${trips.pauses}) - 1)::text, 'resumedAt'], to_jsonb(${nowSeconds}::bigint))`,
    })
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.brandId, brand.id),
        sql`jsonb_array_length(${trips.pauses}) > 0`,
        sql`NOT ((${trips.pauses}->-1) ? 'resumedAt')`,
      ),
    )
    .returning({ id: trips.id })

  if (updated.length === 0) {
    const [exists] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.brandId, brand.id)))
      .limit(1)
    if (!exists) return c.json({ error: 'not found' }, 404)
    return c.json({ error: 'trip is not paused' }, 409)
  }

  return c.json({ ok: true })
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

  const brand = c.get('brand')

  const [inserted] = await db
    .insert(uploads)
    .values({ brandId: brand.id, storageKey: key, mimeType: file.type, sizeBytes: file.size, sha256 })
    .onConflictDoNothing()
    .returning({ id: uploads.id })

  let uploadId: string
  if (inserted) {
    uploadId = inserted.id
  } else {
    // Fallback: the (brand_id, storage_key) pair already exists — retrieve the existing row.
    const [existing] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.storageKey, key), eq(uploads.brandId, brand.id)))
      .limit(1)
    uploadId = existing!.id
  }

  return c.json({ uploadId, url: storage.url(key), mimeType: file.type, sizeBytes: file.size }, 201)
})

adminRoutes.route('/b/:brandSlug', brandScoped)
