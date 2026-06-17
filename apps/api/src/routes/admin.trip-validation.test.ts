import { describe, it, expect, vi } from 'vitest'
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

// generateTrip should never be reached for the 400 cases (validation fails in
// the zValidator hook before the handler runs); mocked so the import resolves
// and the positive-control preview returns a GenerateResult (trip + lateArrival).
vi.mock('@delivery/simulation/generate', () => ({
  generateTrip: vi.fn().mockResolvedValue({
    trip: {
      startedAt: 1700000000,
      polyline: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      totalDistance: 12345,
      segments: [
        { type: 'driving', tStart: 1700000000, tEnd: 1700001000, distStart: 0, distEnd: 12345 },
      ],
      pauses: [],
    },
    minArrival: 1700001000,
    lateArrival: false,
  }),
  HosError: class HosError extends Error {
    readonly minimumArrival: number
    constructor(message: string, minimumArrival: number) {
      super(message)
      this.name = 'HosError'
      this.minimumArrival = minimumArrival
    }
  },
}))

vi.mock('../db/tenant.js', () => ({
  tenantDb: vi.fn().mockImplementation(() => ({
    cargo: { byId: vi.fn().mockImplementation(async (id: string) => ({ id })) },
    trips: { insert: vi.fn().mockResolvedValue({ id: 'trip-uuid', shareHash: 'h' }) },
    uploads: {},
  })),
}))

vi.mock('../db/index.js', () => ({ db: {} }))

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
      c.set('brand', {
        id: 'brand-a-uuid',
        slug: 'brand-a',
        name: 'Brand A',
        shareDomain: 'a.example.com',
      })
      await next()
    },
  ),
}))

import { adminRoutes } from './admin.js'

const CARGO_UUID = '33333333-3333-4333-8333-333333333333'
const STARTED = 1_700_000_000
const FOURTEEN_DAYS = 14 * 24 * 3600
const ORIGIN = { lat: 40.7128, lng: -74.006, label: 'O' }
const DESTINATION = { lat: 34.0522, lng: -118.2437, label: 'D' }

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

function post(path: string, body: unknown) {
  return makeApp().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const PREVIEW = '/admin/b/brand-a/trips/preview'
const CREATE = '/admin/b/brand-a/trips'

describe('arrival-window validation returns a flat { error: string } 400', () => {
  it('preview: desiredArrival beyond the 14-day window → 400 with a string error', async () => {
    const res = await post(PREVIEW, {
      origin: ORIGIN,
      destination: DESTINATION,
      waypoints: [],
      startedAt: STARTED,
      desiredArrival: STARTED + FOURTEEN_DAYS + 1,
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: unknown; success?: unknown }
    // Contract the admin wizard consumes: a plain string, NOT a ZodError object.
    expect(typeof data.error).toBe('string')
    expect(data.error).toContain('desiredArrival')
    expect(data.success).toBeUndefined()
  })

  it('preview: desiredArrival at/before startedAt → 400 with a string error', async () => {
    const res = await post(PREVIEW, {
      origin: ORIGIN,
      destination: DESTINATION,
      waypoints: [],
      startedAt: STARTED,
      desiredArrival: STARTED,
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: unknown }
    expect(typeof data.error).toBe('string')
    expect(data.error as string).toContain('desiredArrival')
  })

  it('create trip: desiredArrival beyond the 14-day window → 400 with a string error', async () => {
    const res = await post(CREATE, {
      cargoId: CARGO_UUID,
      origin: ORIGIN,
      destination: DESTINATION,
      waypoints: [],
      startedAt: STARTED,
      desiredArrival: STARTED + FOURTEEN_DAYS + 1,
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: unknown }
    expect(typeof data.error).toBe('string')
    expect(data.error as string).toContain('desiredArrival')
  })

  it('positive control: a valid in-window preview still succeeds (hook does not break success path)', async () => {
    const res = await post(PREVIEW, {
      origin: ORIGIN,
      destination: DESTINATION,
      waypoints: [],
      startedAt: STARTED,
      desiredArrival: STARTED + 3600,
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { trip?: unknown }
    expect(data.trip).toBeDefined()
  })
})
