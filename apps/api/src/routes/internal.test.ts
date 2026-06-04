import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Use a literal string — vi.mock factory is hoisted to top of file before
// const declarations, so variables defined in this module are not yet initialised.
const FIXED_TOKEN = 'test-internal-token-32chars!!!!!'

vi.mock('../env.js', () => ({
  env: {
    INTERNAL_TOKEN: 'test-internal-token-32chars!!!!!',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(32),
    MAPBOX_TOKEN: '',
    PUBLIC_BASE: 'http://localhost:3000',
    STORAGE_ROOT: '/tmp/uploads',
    NODE_ENV: 'test',
  },
  isProd: false,
}))

// domainResult controls what the db query returns for the current test.
let domainResult: Array<{ id: string }> = []

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(domainResult)),
  },
}))

import { internalRoutes } from './internal.js'

function makeApp() {
  const app = new Hono()
  app.route('/internal', internalRoutes)
  return app
}

describe('internalRoutes token middleware', () => {
  beforeEach(() => {
    domainResult = []
  })

  it('returns 404 when no token is provided', async () => {
    const app = makeApp()
    const res = await app.request('/internal/validate-domain?domain=example.com')
    expect(res.status).toBe(404)
  })

  it('returns 404 when wrong token is provided via header', async () => {
    const app = makeApp()
    const res = await app.request('/internal/validate-domain?domain=example.com', {
      headers: { 'x-internal-token': 'wrong-token' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when wrong token is provided via query param', async () => {
    const app = makeApp()
    const res = await app.request(`/internal/validate-domain?domain=example.com&token=wrongtoken`)
    expect(res.status).toBe(404)
  })

  it('returns 404 with correct token but unknown domain', async () => {
    domainResult = []
    const app = makeApp()
    const res = await app.request(
      `/internal/validate-domain?domain=unknown.example.com&token=${FIXED_TOKEN}`,
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 with correct token and registered domain', async () => {
    domainResult = [{ id: 'some-uuid' }]
    const app = makeApp()
    const res = await app.request(
      `/internal/validate-domain?domain=registered.example.com&token=${FIXED_TOKEN}`,
    )
    expect(res.status).toBe(200)
  })

  it('returns 200 with correct token via x-internal-token header', async () => {
    domainResult = [{ id: 'some-uuid' }]
    const app = makeApp()
    const res = await app.request(`/internal/validate-domain?domain=registered.example.com`, {
      headers: { 'x-internal-token': FIXED_TOKEN },
    })
    expect(res.status).toBe(200)
  })
})
