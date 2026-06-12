import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted runs before vi.mock factories — safe to reference in factory closures.
const storageMock = vi.hoisted(() => ({
  url: vi.fn((k: string) => '/uploads/xx/' + k),
}))

vi.mock('./storage/index.js', () => ({
  storage: storageMock,
}))

// Queue of results — each terminal DB call pops from the front.
const dbResultQueue: Array<unknown> = []

// Chainable DB mock: .select().from().where() → Promise
const dbChain = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  const selectMock = vi.fn().mockReturnValue(chain)
  const fromMock = vi.fn().mockReturnValue(chain)
  const whereMock = vi.fn().mockImplementation(() => {
    const result = (dbResultQueue.shift() ?? []) as unknown
    return Promise.resolve(result)
  })
  chain['select'] = selectMock
  chain['from'] = fromMock
  chain['where'] = whereMock
  return chain
})

vi.mock('./db/index.js', () => ({
  db: dbChain,
}))

import { resolvePhotoUrlMap, resolvePhotoUrls } from './uploads.js'

describe('resolvePhotoUrlMap', () => {
  beforeEach(() => {
    dbResultQueue.length = 0
    vi.clearAllMocks()
    storageMock.url.mockImplementation((k: string) => '/uploads/xx/' + k)
    // Re-bind chain methods after clearAllMocks resets them.
    ;(dbChain['select'] as ReturnType<typeof vi.fn>).mockReturnValue(dbChain)
    ;(dbChain['from'] as ReturnType<typeof vi.fn>).mockReturnValue(dbChain)
    ;(dbChain['where'] as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const result = (dbResultQueue.shift() ?? []) as unknown
      return Promise.resolve(result)
    })
  })

  it('returns a Map with URLs for two ids, one DB query', async () => {
    const ID_A = '11111111-1111-4111-8111-111111111111'
    const ID_B = '22222222-2222-4222-8222-222222222222'
    dbResultQueue.push([
      { id: ID_A, storageKey: 'abc.jpg' },
      { id: ID_B, storageKey: 'def.png' },
    ])

    const map = await resolvePhotoUrlMap('brand-x', [ID_A, ID_B])

    expect(map.size).toBe(2)
    expect(map.get(ID_A)).toBe('/uploads/xx/abc.jpg')
    expect(map.get(ID_B)).toBe('/uploads/xx/def.png')
    // Exactly one DB query was issued.
    expect(dbChain['select']).toHaveBeenCalledTimes(1)
  })

  it('cross-tenant regression: id absent from DB result is not in the map', async () => {
    const ID_OWN = '11111111-1111-4111-8111-111111111111'
    const ID_FOREIGN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    // DB returns only the owned id (brand filter excluded the foreign one).
    dbResultQueue.push([{ id: ID_OWN, storageKey: 'mine.jpg' }])

    const map = await resolvePhotoUrlMap('brand-x', [ID_OWN, ID_FOREIGN])

    expect(map.has(ID_OWN)).toBe(true)
    expect(map.has(ID_FOREIGN)).toBe(false)
    expect(map.size).toBe(1)
  })

  it('returns an empty Map and does not query DB when input is empty', async () => {
    const map = await resolvePhotoUrlMap('brand-x', [])

    expect(map.size).toBe(0)
    expect(dbChain['select']).not.toHaveBeenCalled()
  })

  it('deduplicates input ids before querying DB', async () => {
    const ID_A = '11111111-1111-4111-8111-111111111111'
    // Duplicate of the same id — should only send one unique id to DB.
    dbResultQueue.push([{ id: ID_A, storageKey: 'abc.jpg' }])

    const map = await resolvePhotoUrlMap('brand-x', [ID_A, ID_A, ID_A])

    expect(map.size).toBe(1)
    // DB was queried exactly once.
    expect(dbChain['select']).toHaveBeenCalledTimes(1)
  })
})

describe('resolvePhotoUrls', () => {
  beforeEach(() => {
    dbResultQueue.length = 0
    vi.clearAllMocks()
    storageMock.url.mockImplementation((k: string) => '/uploads/xx/' + k)
    ;(dbChain['select'] as ReturnType<typeof vi.fn>).mockReturnValue(dbChain)
    ;(dbChain['from'] as ReturnType<typeof vi.fn>).mockReturnValue(dbChain)
    ;(dbChain['where'] as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const result = (dbResultQueue.shift() ?? []) as unknown
      return Promise.resolve(result)
    })
  })

  it('preserves the order of input photoUploadIds in the returned array', async () => {
    const ID_A = '11111111-1111-4111-8111-111111111111'
    const ID_B = '22222222-2222-4222-8222-222222222222'
    // DB returns them in reverse order to ensure order comes from input, not DB.
    dbResultQueue.push([
      { id: ID_B, storageKey: 'def.png' },
      { id: ID_A, storageKey: 'abc.jpg' },
    ])

    const urls = await resolvePhotoUrls('brand-x', [ID_A, ID_B])

    expect(urls).toEqual(['/uploads/xx/abc.jpg', '/uploads/xx/def.png'])
  })

  it('returns empty array without querying DB when input is empty', async () => {
    const urls = await resolvePhotoUrls('brand-x', [])

    expect(urls).toEqual([])
    expect(dbChain['select']).not.toHaveBeenCalled()
  })
})
