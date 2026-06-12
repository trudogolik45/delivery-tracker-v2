import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, ApiError, apiJson, apiRequest } from './api.js'

describe('API_BASE_URL', () => {
  it('defaults to http://localhost:3000', () => {
    expect(API_BASE_URL).toBe('http://localhost:3000')
  })
})

describe('apiJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON on a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ a: 1 }),
    } as Response)

    const result = await apiJson('/test')
    expect(result).toEqual({ a: 1 })
  })

  it('throws ApiError with correct status and message on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'nope',
    } as unknown as Response)

    await expect(apiJson('/missing')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 404 && e.message === 'nope',
    )
  })

  it('applies parser to the response data', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: '42' }),
    } as Response)

    const result = await apiJson('/test', {}, (data) => {
      const d = data as { value: string }
      return parseInt(d.value, 10)
    })
    expect(result).toBe(42)
  })
})

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets Content-Type only when body is provided', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await apiRequest('/no-body')
    const [, noBodyInit] = vi.mocked(fetch).mock.calls[0]!
    expect((noBodyInit as RequestInit).headers).not.toHaveProperty('Content-Type')

    await apiRequest('/with-body', { method: 'POST', body: { x: 1 } })
    const [, withBodyInit] = vi.mocked(fetch).mock.calls[1]!
    expect(
      (withBodyInit as RequestInit & { headers: Record<string, string> }).headers,
    ).toHaveProperty('Content-Type', 'application/json')
  })

  it('serializes body as JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await apiRequest('/with-body', { method: 'POST', body: { key: 'val' } })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect((init as RequestInit).body).toBe(JSON.stringify({ key: 'val' }))
  })

  it('URL starts with http://localhost:3000', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await apiRequest('/path')
    const [url] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toMatch(/^http:\/\/localhost:3000/)
  })

  it('includes credentials: include', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await apiRequest('/path')
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect((init as RequestInit).credentials).toBe('include')
  })
})
