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

// Use proper v4 UUIDs (variant bits at position 3: 8, 9, a, or b)
const UPLOAD_A_UUID = '11111111-1111-4111-8111-111111111111'
const UPLOAD_B_UUID = '22222222-2222-4222-8222-222222222222'

// Queue of results — each call to the terminal method pops from front.
const resultQueue: Array<unknown> = []

function nextResult(): unknown {
  return resultQueue.shift() ?? []
}

vi.mock('../db/index.js', () => {
  // A builder that resolves as a Promise when awaited (terminal call)
  // and also supports chaining for method calls.
  function makeChain(resolveWith: () => unknown) {
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'insert', 'update', 'delete', 'from', 'where',
      'limit', 'values', 'set', 'leftJoin', 'onConflictDoNothing']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnThis()
    }
    // returning() and limit() and where() are terminal in different paths.
    // We make all of them also thenable so await works.
    const thenableMethods = ['returning', 'limit', 'where']
    for (const m of thenableMethods) {
      const fn = vi.fn().mockImplementation(function(this: unknown) {
        // Support .then() so this object is a thenable Promise
        const result = nextResult()
        const p = Promise.resolve(result)
        return Object.assign(p, chain)
      })
      chain[m] = fn
    }
    return chain
  }

  const chain = makeChain(nextResult)
  chain['select'] = vi.fn().mockReturnValue(chain)
  chain['insert'] = vi.fn().mockReturnValue(chain)
  chain['update'] = vi.fn().mockReturnValue(chain)
  chain['delete'] = vi.fn().mockReturnValue(chain)
  chain['from'] = vi.fn().mockReturnValue(chain)
  chain['set'] = vi.fn().mockReturnValue(chain)
  chain['leftJoin'] = vi.fn().mockReturnValue(chain)
  chain['onConflictDoNothing'] = vi.fn().mockReturnValue(chain)
  chain['values'] = vi.fn().mockReturnValue(chain)

  return { db: chain }
}
)

vi.mock('../uploads.js', () => ({
  resolvePhotoUrls: vi.fn().mockResolvedValue([]),
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

function jsonPost(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('cargo photoUploadIds brand ownership validation (C4)', () => {
  beforeEach(() => {
    resultQueue.length = 0
  })

  it('returns 201 when photoUploadIds belong to the same brand', async () => {
    // 1st terminal call: upload ownership check (select...where) → found 1 result
    resultQueue.push([{ id: UPLOAD_A_UUID }])
    // 2nd terminal call: cargo insert...returning → new cargo row
    resultQueue.push([{
      id: 'cargo-uuid',
      title: 'T',
      fields: {},
      photoUploadIds: [UPLOAD_A_UUID],
      createdAt: new Date(),
    }])

    const app = makeApp()
    const res = await app.request(
      '/admin/b/brand-a/cargo',
      jsonPost({ title: 'Test cargo', photoUploadIds: [UPLOAD_A_UUID] }),
    )
    expect(res.status).toBe(201)
  })

  it('returns 400 when photoUploadIds include an upload from a different brand', async () => {
    // upload ownership check returns empty — UUID not visible for brand-a
    resultQueue.push([])

    const app = makeApp()
    const res = await app.request(
      '/admin/b/brand-a/cargo',
      jsonPost({ title: 'Test cargo', photoUploadIds: [UPLOAD_B_UUID] }),
    )
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid photo upload id')
  })

  it('returns 400 when more than 20 photos are submitted', async () => {
    // Generate 21 valid v4 UUIDs
    const tooMany = Array.from({ length: 21 }, (_, i) => {
      const hex = i.toString(16).padStart(4, '0')
      return `${hex}0000-0000-4000-8000-000000000000`
    })
    const app = makeApp()
    const res = await app.request(
      '/admin/b/brand-a/cargo',
      jsonPost({ title: 'Test cargo', photoUploadIds: tooMany }),
    )
    // Zod validation fails before handler runs
    expect(res.status).toBe(400)
  })
})
