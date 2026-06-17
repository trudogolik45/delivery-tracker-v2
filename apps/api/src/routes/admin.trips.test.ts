import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../env.js', () => ({
  env: {
    INTERNAL_TOKEN: 'b'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(32),
    MAPBOX_TOKEN: 'pk.test',
    PUBLIC_BASE: 'http://localhost:3000',
    STORAGE_ROOT: '/tmp/uploads',
    NODE_ENV: 'test',
  },
  isProd: false,
}))

vi.mock('../db/index.js', () => ({ db: {} }))

vi.mock('../uploads.js', () => ({
  resolvePhotoUrls: vi.fn().mockResolvedValue([]),
  resolvePhotoUrlMap: vi.fn().mockResolvedValue(new Map()),
}))

const BRAND_A = {
  id: 'brand-a-uuid',
  slug: 'brand-a',
  name: 'Brand A',
  shareDomain: 'a.example.com',
}

vi.mock('../auth/middleware.js', () => ({
  requireAuth: vi.fn(
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'user-a-uuid', email: 'a@example.com' })
      await next()
    },
  ),
}))

vi.mock('../middleware/tenant.js', () => ({
  requireAdminBrand: vi.fn(
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('brand', BRAND_A)
      await next()
    },
  ),
}))

vi.mock('../db/tenant.js', () => ({ tenantDb: vi.fn() }))

// generateTrip теперь возвращает GenerateResult { trip, minArrival, lateArrival };
// HosError приведён к новой 2-арг форме (без direction/maximumArrival) и в норме
// больше не ловится эндпоинтами (только внутренний assertion → 500).
vi.mock('@delivery/simulation/generate', () => ({
  generateTrip: vi.fn(),
  HosError: class HosError extends Error {
    readonly minimumArrival: number
    constructor(message: string, minimumArrival: number) {
      super(message)
      this.name = 'HosError'
      this.minimumArrival = minimumArrival
    }
  },
}))

import { env } from '../env.js'
import { tenantDb } from '../db/tenant.js'
import { generateTrip } from '@delivery/simulation/generate'
import { adminRoutes } from './admin.js'

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

function jsonPost(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Валидный uuid — нужен, чтобы TripCreateResponseSchema.parse (tripId: z.uuid()) прошёл.
const TRIP_ID = '11111111-1111-4111-8111-111111111111'

// Minimal valid GenerateTripInput: cargoId uuid, origin/destination LatLng,
// startedAt / desiredArrival as unix seconds (2h apart, within 14-day window)
const START_UNIX = 1_700_000_000
const ARRIVAL_UNIX = START_UNIX + 2 * 3600
const CARGO_UUID = '33333333-3333-4333-8333-333333333333'

const ORIGIN = { lat: 40.7128, lng: -74.006, label: 'NYC' }
const DESTINATION = { lat: 34.0522, lng: -118.2437, label: 'LA' }

const VALID_TRIP_INPUT = {
  cargoId: CARGO_UUID,
  origin: ORIGIN,
  destination: DESTINATION,
  startedAt: START_UNIX,
  desiredArrival: ARRIVAL_UNIX,
}

const VALID_PREVIEW_INPUT = {
  origin: ORIGIN,
  destination: DESTINATION,
  waypoints: [],
  startedAt: START_UNIX,
  desiredArrival: ARRIVAL_UNIX,
}

// Валидный Trip (TripSchema требует segments.min(1)).
const VALID_TRIP = {
  startedAt: START_UNIX,
  polyline: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
  totalDistance: 4_500_000,
  segments: [
    { type: 'driving', tStart: START_UNIX, tEnd: START_UNIX + 1000, distStart: 0, distEnd: 4_500_000 },
  ],
  pauses: [],
}

// Trip с хвостовым wait — ранний приезд, slack > 0.
const TRIP_WITH_WAIT = {
  ...VALID_TRIP,
  segments: [
    { type: 'driving', tStart: START_UNIX, tEnd: START_UNIX + 1000, distStart: 0, distEnd: 4_500_000 },
    {
      type: 'rest',
      tStart: START_UNIX + 1000,
      tEnd: ARRIVAL_UNIX,
      atDist: 4_500_000,
      reason: 'wait',
    },
  ],
}

function generateResult(overrides: Record<string, unknown> = {}) {
  return { trip: VALID_TRIP, minArrival: START_UNIX + 1000, lateArrival: false, ...overrides }
}

// TripListRow fixture — includes timeline so server can compute status
const LIST_ROW = {
  id: TRIP_ID,
  shareHash: 'abc123hash',
  cargoId: CARGO_UUID,
  cargoTitle: 'Test Cargo',
  origin: { lat: 40.7128, lng: -74.006 },
  destination: { lat: 34.0522, lng: -118.2437 },
  startsAt: new Date(START_UNIX * 1000),
  desiredArrival: new Date(ARRIVAL_UNIX * 1000),
  timeline: [], // empty = Pending
  totalDistanceMeters: 4_500_000,
}

// Minimal valid cargo row
const CARGO_ROW = {
  id: CARGO_UUID,
  brandId: BRAND_A.id,
  title: 'Test Cargo',
  fields: {},
  photoUploadIds: [],
  createdAt: new Date(),
}

function makeTenantDb(overrides: Record<string, unknown> = {}) {
  return {
    cargo: {
      listAll: vi.fn().mockResolvedValue([]),
      byId: vi.fn().mockResolvedValue(CARGO_ROW),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    trips: {
      listAll: vi.fn().mockResolvedValue([]),
      byId: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockResolvedValue({ id: TRIP_ID, shareHash: 'hash123' }),
      delete: vi.fn().mockResolvedValue({ id: TRIP_ID }),
      pauseAtomic: vi.fn().mockResolvedValue({ ok: true }),
      resumeAtomic: vi.fn().mockResolvedValue({ ok: true }),
    },
    uploads: {
      findOwnedIds: vi.fn().mockResolvedValue([]),
      insertOrGetByStorageKey: vi.fn(),
    },
    ...overrides,
  }
}

describe('POST /admin/b/:slug/trips/:id/pause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 { ok: true } when pauseAtomic succeeds', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(
      `/admin/b/brand-a/trips/${TRIP_ID}/pause`,
      jsonPost({ durationSeconds: 600 }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it('passes durationSeconds as third arg when it is a positive integer', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/pause`, jsonPost({ durationSeconds: 600 }))

    expect(pauseAtomic).toHaveBeenCalledWith(TRIP_ID, expect.any(Number), 600)
  })

  it('passes undefined for durationSeconds when value is negative', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/pause`, jsonPost({ durationSeconds: -5 }))

    expect(pauseAtomic).toHaveBeenCalledWith(TRIP_ID, expect.any(Number), undefined)
  })

  it('passes undefined for durationSeconds when value is a string', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/pause`, jsonPost({ durationSeconds: 'x' }))

    expect(pauseAtomic).toHaveBeenCalledWith(TRIP_ID, expect.any(Number), undefined)
  })

  it('returns 409 with error body when trip is already paused', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: false, reason: 'already_paused' })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/pause`, jsonPost({}))
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('trip is already paused')
  })

  it('returns 404 when trip not found (pause)', async () => {
    const pauseAtomic = vi.fn().mockResolvedValue({ ok: false, reason: 'not_found' })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, pauseAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/pause`, jsonPost({}))
    expect(res.status).toBe(404)
  })
})

describe('POST /admin/b/:slug/trips/:id/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 { ok: true } when resumeAtomic succeeds', async () => {
    const resumeAtomic = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, resumeAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/resume`, jsonPost({}))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it('returns 409 with error body when trip is not paused', async () => {
    const resumeAtomic = vi.fn().mockResolvedValue({ ok: false, reason: 'not_paused' })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, resumeAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/resume`, jsonPost({}))
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('trip is not paused')
  })

  it('returns 404 when trip not found (resume)', async () => {
    const resumeAtomic = vi.fn().mockResolvedValue({ ok: false, reason: 'not_found' })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, resumeAtomic } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}/resume`, jsonPost({}))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /admin/b/:slug/trips/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 204 when trip is deleted', async () => {
    const deleteFn = vi.fn().mockResolvedValue({ id: TRIP_ID })
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, delete: deleteFn } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('returns 404 when trip not found on delete', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, delete: deleteFn } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/trips/${TRIP_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /admin/b/:slug/trips (create)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when cargo not found', async () => {
    const byId = vi.fn().mockResolvedValue(undefined)
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ cargo: { ...makeTenantDb().cargo, byId } }) as never,
    )

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(404)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('cargo not found')
  })

  it('returns 503 when MAPBOX_TOKEN is not configured', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    const original = env.MAPBOX_TOKEN
    env.MAPBOX_TOKEN = ''
    try {
      const app = makeApp()
      const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
      expect(res.status).toBe(503)
    } finally {
      env.MAPBOX_TOKEN = original
    }
  })

  it('early/on-time → 201 { tripId, shareHash, lateArrival:false } with no minimumArrival', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    vi.mocked(generateTrip).mockResolvedValue(generateResult({ lateArrival: false }) as never)

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(201)
    const data = (await res.json()) as {
      tripId: string
      shareHash: string
      lateArrival: boolean
      minimumArrival?: number
    }
    expect(data.tripId).toBe(TRIP_ID)
    expect(typeof data.shareHash).toBe('string')
    expect(data.lateArrival).toBe(false)
    expect(data.minimumArrival).toBeUndefined()
  })

  it('late → 201 { tripId, shareHash, lateArrival:true, minimumArrival }', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    const minArrival = START_UNIX + 88_888
    vi.mocked(generateTrip).mockResolvedValue(
      generateResult({ lateArrival: true, minArrival }) as never,
    )

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(201)
    const data = (await res.json()) as {
      tripId: string
      lateArrival: boolean
      minimumArrival: number
    }
    expect(data.tripId).toBe(TRIP_ID)
    expect(data.lateArrival).toBe(true)
    expect(data.minimumArrival).toBe(minArrival)
  })
})

describe('POST /admin/b/:slug/trips/preview', () => {
  const PREVIEW = '/admin/b/brand-a/trips/preview'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 503 when MAPBOX_TOKEN is not configured', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    const original = env.MAPBOX_TOKEN
    env.MAPBOX_TOKEN = ''
    try {
      const app = makeApp()
      const res = await app.request(PREVIEW, jsonPost(VALID_PREVIEW_INPUT))
      expect(res.status).toBe(503)
    } finally {
      env.MAPBOX_TOKEN = original
    }
  })

  it('early/on-time → 200 { trip, lateArrival:false }; no minimumArrival; segments end with wait', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    vi.mocked(generateTrip).mockResolvedValue(
      generateResult({ trip: TRIP_WITH_WAIT, lateArrival: false }) as never,
    )

    const app = makeApp()
    const res = await app.request(PREVIEW, jsonPost(VALID_PREVIEW_INPUT))
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      trip: { segments: Array<{ reason?: string }> }
      lateArrival: boolean
      minimumArrival?: number
    }
    expect(data.lateArrival).toBe(false)
    expect(data.minimumArrival).toBeUndefined()
    const last = data.trip.segments[data.trip.segments.length - 1]!
    expect(last.reason).toBe('wait')
  })

  it('late → 200 { trip, lateArrival:true, minimumArrival } (NOT 422)', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    const minArrival = START_UNIX + 99_999
    vi.mocked(generateTrip).mockResolvedValue(
      generateResult({ trip: VALID_TRIP, lateArrival: true, minArrival }) as never,
    )

    const app = makeApp()
    const res = await app.request(PREVIEW, jsonPost(VALID_PREVIEW_INPUT))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { lateArrival: boolean; minimumArrival: number }
    expect(data.lateArrival).toBe(true)
    expect(data.minimumArrival).toBe(minArrival)
  })
})

describe('GET /admin/b/:slug/trips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('smoke: returns 200 with empty array when no trips', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([])
  })

  it('each row contains status and does NOT contain timeline', async () => {
    const listAll = vi.fn().mockResolvedValue([LIST_ROW])
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ trips: { ...makeTenantDb().trips, listAll } }) as never,
    )

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips')
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)

    const row = rows[0]!
    // status must be one of the four valid values
    const VALID_STATUSES = ['Pending', 'Driving', 'Resting', 'Arrived']
    expect(VALID_STATUSES).toContain(row['status'])
    // timeline must NOT appear in the response
    expect('timeline' in row).toBe(false)
  })
})
