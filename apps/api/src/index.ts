import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { BrandPublicSchema } from '@delivery/schemas'
import { db } from './db/index.js'
import { brands } from './db/schema.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

app.get('/brands', async (c) => {
  const rows = await db.select().from(brands)
  const result = rows.map((b) =>
    BrandPublicSchema.parse({ id: b.id, slug: b.slug, name: b.name }),
  )
  return c.json(result)
})

const server = serve(app, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
