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

import { tenantDb } from '../db/tenant.js'
import { adminRoutes } from './admin.js'

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

function jsonPut(body: unknown) {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

const CARGO_ID = 'cargo-uuid-0001'
const UPLOAD_UUID = '44444444-4444-4444-8444-444444444444'

const CARGO_ROW = {
  id: CARGO_ID,
  brandId: BRAND_A.id,
  title: 'My Cargo',
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
      update: vi.fn().mockResolvedValue(CARGO_ROW),
      delete: vi.fn().mockResolvedValue({ id: CARGO_ID }),
    },
    trips: {
      listAll: vi.fn().mockResolvedValue([]),
      byId: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      pauseAtomic: vi.fn().mockResolvedValue({ ok: true }),
      resumeAtomic: vi.fn().mockResolvedValue({ ok: true }),
    },
    uploads: {
      findOwnedIds: vi.fn().mockResolvedValue([UPLOAD_UUID]),
      insertOrGetByStorageKey: vi.fn(),
    },
    ...overrides,
  }
}

describe('PUT /admin/b/:slug/cargo/:cargoId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when cargo byId returns undefined', async () => {
    const byId = vi.fn().mockResolvedValue(undefined)
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ cargo: { ...makeTenantDb().cargo, byId } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/cargo/${CARGO_ID}`, jsonPut({ title: 'New' }))
    expect(res.status).toBe(404)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('not found')
  })

  it('returns 400 with error body when findOwnedIds is shorter than photoUploadIds', async () => {
    // findOwnedIds returns only 0 results — photo uuid not owned by brand
    const findOwnedIds = vi.fn().mockResolvedValue([])
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({
        cargo: { ...makeTenantDb().cargo },
        uploads: { ...makeTenantDb().uploads, findOwnedIds },
      }) as never,
    )

    const app = makeApp()
    const res = await app.request(
      `/admin/b/brand-a/cargo/${CARGO_ID}`,
      jsonPut({ photoUploadIds: [UPLOAD_UUID] }),
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('invalid photo upload id')
  })

  it('returns 200 with photoUrls on happy path', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)

    const app = makeApp()
    const res = await app.request(
      `/admin/b/brand-a/cargo/${CARGO_ID}`,
      jsonPut({ title: 'Updated' }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { id: string; photoUrls: unknown }
    expect(data.id).toBe(CARGO_ID)
    expect(Array.isArray(data.photoUrls)).toBe(true)
  })
})

describe('DELETE /admin/b/:slug/cargo/:cargoId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 204 when cargo is deleted', async () => {
    vi.mocked(tenantDb).mockReturnValue(makeTenantDb() as never)

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/cargo/${CARGO_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('returns 404 when cargo not found on delete', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    vi.mocked(tenantDb).mockReturnValue(
      makeTenantDb({ cargo: { ...makeTenantDb().cargo, delete: deleteFn } }) as never,
    )

    const app = makeApp()
    const res = await app.request(`/admin/b/brand-a/cargo/${CARGO_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('not found')
  })
})
