import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authRoutes } from './auth/routes.js'
import { adminRoutes } from './routes/admin.js'
import { internalRoutes } from './routes/internal.js'
import { shareRoutes } from './routes/share.js'

const app = new Hono()

const honoLogger = logger()

// /internal/* несёт INTERNAL_TOKEN в query (Caddy on_demand_tls ask не умеет
// заголовки) — эти запросы не логируем, чтобы секрет не попадал в stdout.
app.use('*', (c, next) => {
  if (c.req.path.startsWith('/internal')) return next()
  return honoLogger(c, next)
})

app.use(
  '*',
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }),
)

app.onError((err, c) => {
  console.error('[api error]', err)
  return c.json({ error: 'internal' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

// Dev-only static serving; in prod Caddy handles /uploads/* from a read-only volume
app.use('/uploads/*', serveStatic({ root: './' }))

app.route('/auth', authRoutes)
app.route('/admin', adminRoutes)
app.route('/internal', internalRoutes)
app.route('/share', shareRoutes)

const server = serve(app, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
