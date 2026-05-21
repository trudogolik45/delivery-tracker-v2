import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../env.js', () => ({
  env: {
    INTERNAL_TOKEN: 'b'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(32),
    MAPBOX_TOKEN: 'mapbox-test-token',
    PUBLIC_BASE: 'http://localhost:3000',
    STORAGE_ROOT: '/tmp/uploads',
    NODE_ENV: 'test',
  },
  isProd: false,
}))

const CARGO_UUID = '33333333-3333-4333-8333-333333333333'

// vi.mock factories are hoisted to the top of the file before any const
// declarations, so all values used inside must be literal expressions.
// FAKE_TOTAL_DISTANCE = 12345 is repeated literally below and asserted in the test.

vi.mock('@delivery/simulation/generate', () => ({
  generateTrip: vi.fn().mockResolvedValue({
    startedAt: 1700000000,
    polyline: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    totalDistance: 12345,
    segments: [
      {
        tStart: 1700000000,
        tEnd: 1700001000,
        distStart: 0,
        distEnd: 12345,
        kind: 'driving',
      },
    ],
    pauses: [],
  }),
  HosError: class HosError extends Error {
    minimumArrival = 0
  },
}))

// Captured trips.insert payload — asserted in the test.
const tripsInsertMock = vi.fn().mockResolvedValue({ id: 'trip-uuid', shareHash: 'h' })

vi.mock('../db/tenant.js', () => ({
  tenantDb: vi.fn().mockImplementation(() => ({
    cargo: {
      // Ownership check passes for any cargoId.
      byId: vi.fn().mockImplementation(async (id: string) => ({ id })),
    },
    trips: {
      insert: tripsInsertMock,
    },
    uploads: {},
  })),
}))

// db is referenced by admin.ts top-level routes; provide a stub so the import
// does not pull in a real connection during this test.
vi.mock('../db/index.js', () => ({
  db: {},
}))

const BRAND_A = {
  id: 'brand-a-uuid',
  slug: 'brand-a',
  name: 'Brand A',
  shareDomain: 'a.example.com',
}

vi.mock('../auth/middleware.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('user', { id: 'user-a-uuid', email: 'a@example.com' })
    await next()
  }),
}))

vi.mock('../middleware/tenant.js', () => ({
  requireAdminBrand: vi.fn(async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('brand', BRAND_A)
    await next()
  }),
}))

import { adminRoutes } from './admin.js'

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

describe('POST /admin/b/:brandSlug/trips persists totalDistanceMeters', () => {
  beforeEach(() => {
    tripsInsertMock.mockClear()
    tripsInsertMock.mockResolvedValue({ id: 'trip-uuid', shareHash: 'h' })
  })

  it('forwards Math.round(generateTrip.totalDistance) into tenantDb(brand).trips.insert', async () => {
    const app = makeApp()
    const res = await app.request('/admin/b/brand-a/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cargoId: CARGO_UUID,
        origin: { lng: 0, lat: 0, label: 'Origin' },
        destination: { lng: 1, lat: 1, label: 'Destination' },
        waypoints: [],
        startedAt: 1700000000,
        desiredArrival: 1700100000,
      }),
    })

    expect(res.status).toBe(201)

    expect(tripsInsertMock).toHaveBeenCalledTimes(1)
    const payload = tripsInsertMock.mock.calls[0]![0] as { totalDistanceMeters: number }
    expect(payload.totalDistanceMeters).toBe(12345)
  })
})
