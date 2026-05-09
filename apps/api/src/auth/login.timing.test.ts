import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock env before auth routes are imported
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

// Track verifyPassword calls
let verifyPasswordCallCount = 0

vi.mock('./passwords.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: vi.fn().mockImplementation(async (_hash: string, _pw: string) => {
    verifyPasswordCallCount++
    return false
  }),
}))

// db returns no user
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('./jwt.js', () => ({
  signSession: vi.fn().mockResolvedValue('token'),
  SESSION_COOKIE_NAME: 'session',
  SESSION_TTL_SECONDS: 3600,
}))

import { authRoutes } from './routes.js'
import { _resetForTests } from './rate-limiter.js'

function makeApp() {
  const app = new Hono()
  app.route('/auth', authRoutes)
  return app
}

describe('constant-time missing-user path', () => {
  beforeEach(() => {
    verifyPasswordCallCount = 0
    _resetForTests()
  })

  it('calls verifyPassword even when user is not found in DB', async () => {
    const app = makeApp()
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'SomePass123' }),
    })
    // Credentials are invalid, should be 401
    expect(res.status).toBe(401)
    // verifyPassword must have been called once (dummy hash comparison)
    expect(verifyPasswordCallCount).toBe(1)
  })
})
