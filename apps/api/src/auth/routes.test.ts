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

vi.mock('./passwords.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: vi.fn(),
}))

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))

// jwt.js is NOT mocked — we test real signSession integration

import { authRoutes } from './routes.js'
import { _resetForTests } from './rate-limiter.js'
import { db } from '../db/index.js'
import { verifyPassword } from './passwords.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any

const TEST_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  passwordHash: '$argon2id$x',
}

function makeApp() {
  const app = new Hono()
  app.route('/auth', authRoutes)
  return app
}

describe('auth routes happy path', () => {
  beforeEach(() => {
    _resetForTests()
    vi.clearAllMocks()
    // Restore chainable mocks after clearAllMocks
    mockDb.select.mockReturnThis()
    mockDb.from.mockReturnThis()
    mockDb.where.mockReturnThis()
  })

  it('happy path login: 200, correct cookie attributes, correct body', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true)
    mockDb.limit.mockResolvedValue([TEST_USER])

    const app = makeApp()
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'ValidPass123' }),
    })

    expect(res.status).toBe(200)

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/auth=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Path=\//i)
    expect(setCookie).toMatch(/Max-Age=604800/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).not.toMatch(/Secure/i)

    const body = await res.json()
    expect(body).toEqual({ user: { id: TEST_USER.id, email: TEST_USER.email } })
  })

  it('wrong password: 401, no set-cookie', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false)
    mockDb.limit.mockResolvedValue([TEST_USER])

    const app = makeApp()
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'WrongPass123' }),
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('logout: 204, set-cookie clears auth', async () => {
    const app = makeApp()
    const res = await app.request('/auth/logout', {
      method: 'POST',
    })

    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie') ?? ''
    // deleteCookie sets Max-Age=0 or clears the value
    expect(setCookie).toMatch(/auth=;|Max-Age=0/i)
  })

  it('GET /me without cookie: 401', async () => {
    const app = makeApp()
    const res = await app.request('/auth/me', {
      method: 'GET',
    })

    expect(res.status).toBe(401)
  })

  it('GET /me with valid cookie: 200 and user body', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true)
    // First call (login): return full user row
    // Second call (requireAuth middleware): return { id, email }
    mockDb.limit
      .mockResolvedValueOnce([TEST_USER])
      .mockResolvedValueOnce([{ id: TEST_USER.id, email: TEST_USER.email }])

    const app = makeApp()

    // Login to get the cookie
    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'ValidPass123' }),
    })
    expect(loginRes.status).toBe(200)

    const setCookieHeader = loginRes.headers.get('set-cookie') ?? ''
    // Extract just "auth=<token>" part for the Cookie request header
    const cookieMatch = setCookieHeader.match(/auth=[^;]+/)
    expect(cookieMatch).not.toBeNull()
    const cookieValue = cookieMatch![0]

    // Use the real token in the /me request
    const meRes = await app.request('/auth/me', {
      method: 'GET',
      headers: { cookie: cookieValue },
    })

    expect(meRes.status).toBe(200)
    const meBody = await meRes.json()
    expect(meBody).toEqual({ user: { id: TEST_USER.id, email: TEST_USER.email } })
  })
})
