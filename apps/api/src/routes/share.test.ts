import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../env.js', () => ({
  env: {
    INTERNAL_TOKEN: 'b'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(32),
    MAPBOX_TOKEN: '',
    PUBLIC_BASE: 'http://localhost:3000',
    STORAGE_ROOT: '/tmp/uploads',
    NODE_ENV: 'test',
  },
  isProd: false,
}))

// ── Test fixtures ────────────────────────────────────────────────────────────
const BRAND_A = {
  id: 'brand-a-uuid',
  slug: 'brand-a',
  name: 'Brand A',
  shareDomain: 'a.example.com',
}
const BRAND_B = {
  id: 'brand-b-uuid',
  slug: 'brand-b',
  name: 'Brand B',
  shareDomain: 'b.example.com',
}

type TripJoinedShape = {
  id: string
  brandId: string
  cargoId: string
  shareHash: string
  origin: unknown
  destination: unknown
  waypoints: unknown
  startsAt: Date
  desiredArrival: Date
  pauses: unknown
  routeGeometry: unknown
  timeline: unknown
  totalDistanceMeters: number | null
  createdAt: Date
  cargoTitle: string | null
  cargoFields: unknown
  cargoPhotoUploadIds: string[]
}

const POLYLINE = {
  type: 'LineString' as const,
  coordinates: [
    [0, 0],
    [1, 1],
  ] as Array<[number, number]>,
}
const SEGMENT = {
  type: 'driving' as const,
  tStart: 0,
  tEnd: 3600,
  distStart: 0,
  distEnd: 1000,
}

function makeRow(over: Partial<TripJoinedShape> = {}): TripJoinedShape {
  return {
    id: 'trip-uuid',
    brandId: BRAND_A.id,
    cargoId: '11111111-1111-4111-8111-111111111111',
    shareHash: 'hash-aaa',
    origin: { lat: 0, lng: 0 },
    destination: { lat: 1, lng: 1 },
    waypoints: [],
    startsAt: new Date('2025-01-01T00:00:00Z'),
    desiredArrival: new Date('2025-01-01T01:00:00Z'),
    pauses: [],
    routeGeometry: POLYLINE,
    timeline: [SEGMENT],
    totalDistanceMeters: 12345,
    createdAt: new Date('2024-12-31T00:00:00Z'),
    cargoTitle: 'Test Cargo',
    cargoFields: {},
    cargoPhotoUploadIds: [],
    ...over,
  }
}

// ── Hoisted mock state — referenced by both vi.mock factories and tests ──────
const hoisted = vi.hoisted(() => {
  const state: {
    brandLookupResult: unknown[]
    tripLookupResult: TripJoinedShape | undefined
  } = {
    brandLookupResult: [],
    tripLookupResult: undefined,
  }
  return { state }
})

vi.mock('../db/index.js', () => {
  // Single chainable object — every chain method returns it. The terminal
  // `.limit()` resolves to whatever the test seeded into brandLookupResult.
  const dbChain: Record<string, unknown> = {}
  dbChain['select'] = vi.fn(() => dbChain)
  dbChain['from'] = vi.fn(() => dbChain)
  dbChain['where'] = vi.fn(() => dbChain)
  dbChain['limit'] = vi.fn(() => Promise.resolve(hoisted.state.brandLookupResult))
  return { db: dbChain }
})

vi.mock('../db/tenant.js', () => ({
  tenantDb: vi.fn(() => ({
    trips: {
      byShareHash: vi.fn(async () => hoisted.state.tripLookupResult),
    },
  })),
}))

vi.mock('../uploads.js', () => ({
  resolvePhotoUrls: vi.fn().mockResolvedValue([]),
}))

import { shareRoutes } from './share.js'
import { tenantDb } from '../db/tenant.js'

function makeApp() {
  const app = new Hono()
  app.route('/share', shareRoutes)
  return app
}

describe('share.ts host->brand resolution + tenant scoping (H1)', () => {
  beforeEach(() => {
    hoisted.state.brandLookupResult = []
    hoisted.state.tripLookupResult = undefined
    vi.mocked(tenantDb).mockClear()
  })

  it('cross-tenant: brand A hash on brand B host -> 404, no redirectTo, no brand info leaked', async () => {
    // Brand B's host resolves to brand B; tenant-scoped lookup for the hash
    // belonging to brand A returns undefined (cross-brand isolation).
    hoisted.state.brandLookupResult = [BRAND_B]
    hoisted.state.tripLookupResult = undefined

    const app = makeApp()
    const res = await app.request('/share/hash-from-brand-a', {
      headers: { host: BRAND_B.shareDomain },
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'trip not found' })
    expect(body['redirectTo']).toBeUndefined()
    // Defensive: no brand identifiers anywhere in the response body.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(BRAND_A.shareDomain)
    expect(serialized).not.toContain(BRAND_B.shareDomain)
    expect(serialized).not.toContain(BRAND_A.slug)
    expect(serialized).not.toContain(BRAND_B.slug)
    expect(serialized).not.toContain(BRAND_A.name)
    expect(serialized).not.toContain(BRAND_B.name)
  })

  it('unknown host (no brand match) -> 404 trip not found', async () => {
    hoisted.state.brandLookupResult = []

    const app = makeApp()
    const res = await app.request('/share/some-hash', {
      headers: { host: 'unknown.example.com' },
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'trip not found' })
  })

  it('correct host + populated row -> 200, totalDistance = stored totalDistanceMeters (12345)', async () => {
    hoisted.state.brandLookupResult = [BRAND_A]
    hoisted.state.tripLookupResult = makeRow({ totalDistanceMeters: 12345 })

    const app = makeApp()
    const res = await app.request('/share/hash-aaa', {
      headers: { host: BRAND_A.shareDomain },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { trip: { totalDistance: number } }
    expect(body.trip.totalDistance).toBe(12345)
  })

  it('legacy row: totalDistanceMeters=null -> totalDistance computed via turf fallback (finite > 0)', async () => {
    hoisted.state.brandLookupResult = [BRAND_A]
    hoisted.state.tripLookupResult = makeRow({ totalDistanceMeters: null })

    const app = makeApp()
    const res = await app.request('/share/hash-aaa', {
      headers: { host: BRAND_A.shareDomain },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { trip: { totalDistance: number } }
    expect(Number.isFinite(body.trip.totalDistance)).toBe(true)
    expect(body.trip.totalDistance).toBeGreaterThan(0)
  })

  it('trip not yet generated (routeGeometry=null) -> 409 trip not generated', async () => {
    hoisted.state.brandLookupResult = [BRAND_A]
    hoisted.state.tripLookupResult = makeRow({ routeGeometry: null })

    const app = makeApp()
    const res = await app.request('/share/hash-aaa', {
      headers: { host: BRAND_A.shareDomain },
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'trip not generated' })
  })

  it('case-folded host: GET /:hash with mixed-case Host resolves to the lowercase-keyed brand and returns 200', async () => {
    const FOO_BRAND = {
      id: 'brand-foo-uuid',
      slug: 'foo',
      name: 'Foo',
      shareDomain: 'foo.example.com',
    }
    // The brand row is keyed lowercase ('foo.example.com'). The mock returns
    // it regardless of the where clause — what we're pinning is that the
    // route accepts a mixed-case Host header without throwing, completes the
    // brand lookup, and reaches tenantDb with the resolved brand.
    hoisted.state.brandLookupResult = [FOO_BRAND]
    hoisted.state.tripLookupResult = makeRow({ brandId: FOO_BRAND.id })

    const app = makeApp()
    const res = await app.request('/share/hash-aaa', {
      headers: { host: 'Foo.Example.COM' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { trip: { totalDistance: number } }
    expect(body.trip.totalDistance).toBe(12345)
    expect(vi.mocked(tenantDb)).toHaveBeenCalledWith(FOO_BRAND)
  })
})
