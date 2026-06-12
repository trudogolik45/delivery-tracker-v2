import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

/**
 * Unit-test for the logger-redaction wrapper introduced in index.ts.
 *
 * We do NOT import index.ts itself (it calls serve() and process.exit on env
 * validation failure). Instead we replicate the same wrapper pattern on a
 * small test Hono app so we can assert against it in isolation.
 */

function makeAppWithRedaction(printFn: (str: string, ...rest: string[]) => void) {
  const app = new Hono()
  const honoLogger = logger(printFn)

  app.use('*', (c, next) => {
    if (c.req.path.startsWith('/internal')) return next()
    return honoLogger(c, next)
  })

  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/internal/validate-domain', (c) => c.json({ ok: true }))

  return app
}

describe('logger redaction for /internal/* paths', () => {
  it('logs requests to /health (happy path)', async () => {
    const lines: string[] = []
    const app = makeAppWithRedaction((str) => lines.push(str))

    const res = await app.request('/health')
    expect(res.status).toBe(200)
    // hono logger emits at least one line per request
    expect(lines.length).toBeGreaterThan(0)
  })

  it('does NOT log requests to /internal/validate-domain?token=secret (regression)', async () => {
    const lines: string[] = []
    const app = makeAppWithRedaction((str) => lines.push(str))

    const res = await app.request('/internal/validate-domain?token=AAA')
    expect(res.status).toBe(200)
    // PrintFunc must never have been called — token stays out of stdout
    expect(lines).toHaveLength(0)
  })
})
