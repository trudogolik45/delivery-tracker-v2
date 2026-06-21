import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env, isProd } from './env.js'
import { authRoutes } from './auth/routes.js'
import { adminRoutes } from './routes/admin.js'
import { internalRoutes } from './routes/internal.js'
import { shareRoutes } from './routes/share.js'

const app = new Hono()

// Структурный лог запросов: одна JSON-строка на запрос (method/path/status/ms),
// удобно парсить и фильтровать. /internal/* несёт INTERNAL_TOKEN в query
// (Caddy on_demand_tls ask не умеет заголовки) — не логируем, чтобы секрет не
// попадал в stdout.
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/internal')) return next()
  const start = Date.now()
  await next()
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'info',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    }),
  )
})

// В проде админ-SPA живёт на PUBLIC_BASE (https://<ADMIN_DOMAIN>); в dev —
// Vite на 5173. Share-страницы ходят в /api same-origin через Caddy и под
// CORS не попадают.
const corsOrigin = isProd ? new URL(env.PUBLIC_BASE).origin : 'http://localhost:5173'

app.use(
  '*',
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
)

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'error',
      method: c.req.method,
      path: c.req.path,
      msg: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  )
  return c.json({ error: 'internal' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

// Образ проставляет GIT_SHA через Dockerfile ARG; используется деплоем для
// проверки, что в проде поднялась именно ожидаемая ревизия (см. bin/deploy).
app.get('/version', (c) => c.json({ sha: process.env.GIT_SHA ?? 'dev' }))

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
