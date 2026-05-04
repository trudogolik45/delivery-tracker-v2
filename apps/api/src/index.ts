import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './auth/routes.js'
import { adminRoutes } from './routes/admin.js'
import { shareRoutes } from './routes/share.js'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }),
)

app.get('/health', (c) => c.json({ ok: true }))

app.route('/auth', authRoutes)
app.route('/admin', adminRoutes)
app.route('/share', shareRoutes)

const server = serve(app, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
