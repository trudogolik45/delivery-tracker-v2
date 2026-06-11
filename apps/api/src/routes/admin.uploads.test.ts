import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// vi.hoisted runs before vi.mock factories — safe to reference in factory closures.
const storageMock = vi.hoisted(() => ({
  exists: vi.fn().mockResolvedValue(false),
  put: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue('/uploads/ab/abcdef.png'),
  delete: vi.fn().mockResolvedValue(undefined),
}))

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

vi.mock('../auth/middleware.js', () => ({
  requireAuth: vi.fn(
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('user', { id: 'user-a-uuid', email: 'a@example.com' })
      await next()
    },
  ),
}))

const BRAND_A = {
  id: 'brand-a-uuid',
  slug: 'brand-a',
  name: 'Brand A',
  shareDomain: 'a.example.com',
}

vi.mock('../middleware/tenant.js', () => ({
  requireAdminBrand: vi.fn(
    async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('brand', BRAND_A)
      await next()
    },
  ),
}))

vi.mock('../storage/index.js', async () => {
  // Use real makeKey and sniffImageMime so magic-byte logic is exercised.
  const real = await vi.importActual<typeof import('../storage/local.js')>('../storage/local.js')
  return {
    storage: storageMock,
    makeKey: real.makeKey,
    sniffImageMime: real.sniffImageMime,
  }
})

vi.mock('../db/tenant.js', () => ({
  tenantDb: vi.fn().mockReturnValue({
    uploads: {
      insertOrGetByStorageKey: vi.fn().mockResolvedValue({ id: 'upload-uuid-001' }),
      findByIds: vi.fn().mockResolvedValue([]),
    },
    cargo: {
      insert: vi.fn(),
      listWithPhotos: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      update: vi.fn(),
    },
    trips: {
      insert: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      findByShareHash: vi.fn(),
    },
    brands: {
      update: vi.fn(),
    },
  }),
}))

import { adminRoutes } from './admin.js'

function makeApp() {
  const app = new Hono()
  app.route('/admin', adminRoutes)
  return app
}

// Minimal valid PNG header (8-byte signature)
function makePngBuffer(): Buffer {
  return Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')
}

// Minimal valid JPEG header
function makeJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
}

// HTML content masquerading as an image
function makeHtmlBuffer(): Buffer {
  return Buffer.from('<!DOCTYPE html><html><body>xss</body></html>', 'utf-8')
}

function makeFormData(fileBytes: Buffer, mimeType: string, fieldName = 'file'): FormData {
  const fd = new FormData()
  // Wrap in Uint8Array to satisfy strict BlobPart typing (Buffer has ArrayBufferLike, not ArrayBuffer).
  fd.append(fieldName, new File([new Uint8Array(fileBytes)], 'test-file', { type: mimeType }))
  return fd
}

describe('POST /admin/b/:brandSlug/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageMock.exists.mockResolvedValue(false)
    storageMock.put.mockResolvedValue(undefined)
    storageMock.url.mockReturnValue('/uploads/ab/abcdef.png')
  })

  it('returns 201 for valid PNG bytes with image/png content-type', async () => {
    const app = makeApp()
    const fd = makeFormData(makePngBuffer(), 'image/png')
    const res = await app.request('/admin/b/brand-a/uploads', {
      method: 'POST',
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { uploadId: string; url: string }
    expect(body.uploadId).toBe('upload-uuid-001')
  })

  it('returns 415 for HTML bytes declared as image/jpeg (magic-byte mismatch)', async () => {
    const app = makeApp()
    const fd = makeFormData(makeHtmlBuffer(), 'image/jpeg')
    const res = await app.request('/admin/b/brand-a/uploads', {
      method: 'POST',
      body: fd,
    })
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('file content does not match declared type')
  })

  it('returns 400 when no file field is provided', async () => {
    const app = makeApp()
    const fd = new FormData()
    fd.append('other', 'value')
    const res = await app.request('/admin/b/brand-a/uploads', {
      method: 'POST',
      body: fd,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('file field required')
  })

  it('returns 415 for unsupported declared MIME type', async () => {
    const app = makeApp()
    // JPEG bytes but declared as unsupported type
    const fd = makeFormData(makeJpegBuffer(), 'application/pdf')
    const res = await app.request('/admin/b/brand-a/uploads', {
      method: 'POST',
      body: fd,
    })
    expect(res.status).toBe(415)
  })
})
