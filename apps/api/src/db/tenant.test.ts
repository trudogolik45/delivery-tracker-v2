import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Chain mock ──────────────────────────────────────────────────────────────
// Pattern lifted from admin.cargo-photos.test.ts: every db method returns
// the chain itself; thenable methods (where / limit / returning) also resolve
// as a Promise so `await` works at any link in the chain. We additionally
// record every call so tests can assert the predicates passed to `.where`.

type ChainCall = { method: string; args: unknown[] }
const chainCalls: ChainCall[] = []
const resultQueue: unknown[] = []

function nextResult(): unknown {
  return resultQueue.shift() ?? []
}

vi.mock('./index.js', () => {
  const chain: Record<string, unknown> = {}

  const passthrough = [
    'select',
    'insert',
    'update',
    'delete',
    'from',
    'set',
    'leftJoin',
    'onConflictDoNothing',
    'values',
  ]
  for (const m of passthrough) {
    chain[m] = vi.fn().mockImplementation((...args: unknown[]) => {
      chainCalls.push({ method: m, args })
      return chain
    })
  }

  const thenable = ['returning', 'limit', 'where']
  for (const m of thenable) {
    chain[m] = vi.fn().mockImplementation((...args: unknown[]) => {
      chainCalls.push({ method: m, args })
      const result = nextResult()
      const p = Promise.resolve(result)
      return Object.assign(p, chain)
    })
  }

  return { db: chain }
})

// Import AFTER the mock is registered.
import { tenantDb } from './tenant.js'

const BRAND = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'acme',
  name: 'ACME',
  shareDomain: 'acme.example.com',
}

// Helper: walk a `where` argument (a drizzle SQL object) collecting every
// string we see, so tests can substring-check for column names like
// 'brand_id' / 'share_hash'. Drizzle Column ↔ Table back-references make
// the structure cyclic, so we use a WeakSet to break cycles and a depth
// cap as a defensive guard.
function collectStrings(node: unknown): string[] {
  const out: string[] = []
  const seen = new WeakSet<object>()
  function visit(v: unknown, depth: number) {
    if (depth > 32) return
    if (v === null || v === undefined) return
    if (typeof v === 'string') {
      out.push(v)
      return
    }
    if (typeof v !== 'object') return
    if (seen.has(v as object)) return
    seen.add(v as object)
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    for (const val of Object.values(v as Record<string, unknown>)) {
      visit(val, depth + 1)
    }
  }
  visit(node, 0)
  return out
}

function whereStrings(call: ChainCall): string[] {
  return collectStrings(call.args)
}

describe('tenantDb — brand_id is embedded in every predicate', () => {
  beforeEach(() => {
    chainCalls.length = 0
    resultQueue.length = 0
  })

  it('cargo.listAll() calls .where with eq on brand_id', async () => {
    resultQueue.push([])
    await tenantDb(BRAND).cargo.listAll()

    const wheres = chainCalls.filter((c) => c.method === 'where')
    expect(wheres.length).toBe(1)
    expect(whereStrings(wheres[0]!)).toContain('brand_id')
  })

  it('cargo.byId(id) calls .where embedding both id and brand_id', async () => {
    // .where consumes one result, .limit consumes the next.
    resultQueue.push([])
    resultQueue.push([])
    await tenantDb(BRAND).cargo.byId('cargo-uuid')

    const wheres = chainCalls.filter((c) => c.method === 'where')
    expect(wheres.length).toBe(1)
    const strings = whereStrings(wheres[0]!)
    expect(strings).toContain('brand_id')
    expect(strings).toContain('id')
  })

  it('trips.byShareHash(hash) calls .where with brand_id and share_hash', async () => {
    resultQueue.push([])
    resultQueue.push([])
    await tenantDb(BRAND).trips.byShareHash('abc123')

    const wheres = chainCalls.filter((c) => c.method === 'where')
    expect(wheres.length).toBe(1)
    const strings = whereStrings(wheres[0]!)
    expect(strings).toContain('brand_id')
    expect(strings).toContain('share_hash')
  })

  it('uploads.findOwnedIds(ids) calls inArray on uploads.id and eq on brand_id', async () => {
    resultQueue.push([])
    await tenantDb(BRAND).uploads.findOwnedIds([
      '00000000-0000-4000-8000-0000000000aa',
      '00000000-0000-4000-8000-0000000000bb',
    ])

    const wheres = chainCalls.filter((c) => c.method === 'where')
    expect(wheres.length).toBe(1)
    const strings = whereStrings(wheres[0]!)
    expect(strings).toContain('brand_id')
    // inArray on uploads.id leaves the column name 'id' in the chunks.
    expect(strings).toContain('id')
  })

  it('uploads.findOwnedIds([]) short-circuits with no DB call', async () => {
    const result = await tenantDb(BRAND).uploads.findOwnedIds([])
    expect(result).toEqual([])
    expect(chainCalls.length).toBe(0)
  })
})
