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

vi.mock('@delivery/simulation/generate', () => ({
  generateTrip: vi.fn(),
  HosError: class HosError extends Error {
    readonly minimumArrival: number
    readonly direction: string
    readonly maximumArrival?: number
    constructor(
      message: string,
      minimumArrival: number,
      direction = 'too_fast',
      maximumArrival?: number,
    ) {
      super(message)
      this.name = 'HosError'
      this.minimumArrival = minimumArrival
      this.direction = direction
      this.maximumArrival = maximumArrival
    }
  },
}))

import { tenantDb } from '../db/tenant.js'
import { generateTrip, HosError } from '@delivery/simulation/generate'
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

const TRIP_ID = 'trip-uuid-0001'

// Minimal valid GenerateTripInput: cargoId uuid, origin/destination LatLng,
// startedAt / desiredArrival as unix seconds (2h apart, within 14-day window)
const START_UNIX = 1_700_000_000
const ARRIVAL_UNIX = START_UNIX + 2 * 3600
const CARGO_UUID = '33333333-3333-4333-8333-333333333333'

const VALID_TRIP_INPUT = {
  cargoId: CARGO_UUID,
  origin: { lat: 40.7128, lng: -74.006, label: 'NYC' },
  destination: { lat: 34.0522, lng: -118.2437, label: 'LA' },
  startedAt: START_UNIX,
  desiredArrival: ARRIVAL_UNIX,
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

describe('POST /admin/b/:slug/trips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when cargo not found', async () => {
    const byId = vi.fn().mockResolvedValue(undefined)
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ cargo: { ...makeTenantDb().cargo, byId } }) as never,
    )
    vi.mocked(generateTrip).mockResolvedValue({
      polyline: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      segments: [],
      totalDistance: 1000,
    } as never)

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(404)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('cargo not found')
  })

  it('returns 422 when generateTrip throws HosError', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    vi.mocked(generateTrip).mockRejectedValue(new HosError('arrival too tight', 1_700_010_000))

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(422)
    const data = (await res.json()) as { error: string; minimumArrival: number }
    expect(data.error).toBe('arrival too tight')
    expect(typeof data.minimumArrival).toBe('number')
  })

  it('returns 201 { tripId, shareHash } on happy path', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)
    vi.mocked(generateTrip).mockResolvedValue({
      polyline: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      segments: [],
      totalDistance: 4_500_000,
    } as never)

    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', jsonPost(VALID_TRIP_INPUT))
    expect(res.status).toBe(201)
    const data = (await res.json()) as { tripId: string; shareHash: string }
    expect(data.tripId).toBe(TRIP_ID)
    expect(typeof data.shareHash).toBe('string')
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
