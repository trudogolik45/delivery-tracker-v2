import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock env before any import that pulls it in.
vi.mock('../env.js', () => ({
  env: {
    INTERNAL_TOKEN: 'b'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(32),
    MAPBOX_TOKEN: '',
    PUBLIC_BASE: 'http://admin.example.com',
    STORAGE_ROOT: '/tmp/uploads',
    NODE_ENV: 'test',
  },
  isProd: false,
}))

// ── DB mock ──────────────────────────────────────────────────────────────────
// We track which query was last made via a shared closure.
type MockRow = Record<string, unknown>
let dbQueryResult: MockRow[] = []

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(dbQueryResult)),
  },
}))

// ── Auth middleware mock ──────────────────────────────────────────────────────
// requireAuth and requireAdminBrand are replaced: requireAuth sets a user,
// requireAdminBrand either finds brand A or returns 404 (cross-tenant scenario).
const ADMIN_A_ID = 'user-a-uuid'
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

vi.mock('../auth/middleware.js', () => ({
  requireAuth: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('user', { id: ADMIN_A_ID, email: 'a@example.com' })
    await next()
  }),
}))

vi.mock('../middleware/tenant.js', () => ({
  requireAdminBrand: vi.fn(async (
    c: { req: { param: (k: string) => string }; set: (k: string, v: unknown) => void; json: (body: unknown, status?: number) => Response },
    next: () => Promise<void>,
  ) => {
    const slug = c.req.param('brandSlug')
    // Only grant access to brand-a (admin A's own brand)
    if (slug === BRAND_A.slug) {
      c.set('brand', BRAND_A)
      await next()
    } else {
      // Cross-tenant: behave exactly like requireAdminBrand does in production
      return c.json({ error: 'brand not found' }, 404)
    }
  }),
}))

// ── DNS mock ─────────────────────────────────────────────────────────────────
vi.mock('dns', () => ({
  promises: {
    resolve4: vi.fn().mockResolvedValue(['1.2.3.4']),
  },
}))

import { adminRoutes } from './admin.js'

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

describe('dns-status owner scoping (C2)', () => {
  beforeEach(() => {
    dbQueryResult = []
  })

  it(`admin A calling /admin/b/${BRAND_B.slug}/dns-status returns 404 (cross-tenant blocked)`, async () => {
    const app = makeApp()
    const res = await app.request(`/admin/b/${BRAND_B.slug}/dns-status`, {
      headers: { cookie: 'session=valid' },
    })
    expect(res.status).toBe(404)
  })

  it(`admin A calling /admin/b/${BRAND_A.slug}/dns-status returns 200 (own brand)`, async () => {
    const app = makeApp()
    const res = await app.request(`/admin/b/${BRAND_A.slug}/dns-status`, {
      headers: { cookie: 'session=valid' },
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { resolved: boolean; expected: string[]; actual: string[] }
    expect(Array.isArray(data.expected)).toBe(true)
    expect(Array.isArray(data.actual)).toBe(true)
  })
})
