---
name: run-delivery-tracker
description: Build, run, smoke-test, and screenshot the delivery-tracker app (Hono API + React/Vite SPA) locally. Use to start the API or web dev server, drive the API end-to-end, take screenshots of the login or live tracking page, seed demo data, or run the test suites.
---

# Run delivery-tracker

Multi-tenant delivery tracker: a **Hono API** (`apps/api`, Node 24 + Drizzle +
Postgres) and a **React 19 / Vite SPA** (`apps/web`, TanStack Router + MapLibre).
Two driveable surfaces:

- **API** — drive it with curl via `.claude/skills/run-delivery-tracker/smoke.sh`
  (18 assertions: auth, brand/cargo CRUD, the Caddy domain hook, and the public
  `/share` render incl. cross-tenant isolation). This is the primary harness —
  most changes here are backend.
- **Web** — screenshot it with headless Chrome via
  `.claude/skills/run-delivery-tracker/shoot.sh`.

All paths below are relative to the repo root. Verified on macOS (Darwin),
Node v24.15.0, pnpm 10.33.2, Docker 29.4.0, with `/Applications/Google Chrome.app`.

## Prerequisites

Already present on this machine; install only what's missing:

- Node ≥ 24, pnpm 10 (`corepack enable` if absent)
- Docker (for the Postgres 18 container — no host Postgres needed)
- Google Chrome (for web screenshots) at `/Applications/Google Chrome.app`

## Build / setup (run once)

```bash
pnpm install
docker compose up -d                       # Postgres 18 on localhost:5432
cp apps/api/.env.example apps/api/.env
# wait for Postgres, then migrate + seed an admin
docker exec delivery-tracker-postgres-1 pg_isready -U delivery -d delivery_tracker
pnpm --filter @delivery/api db:migrate
pnpm --filter @delivery/api seed-admin --email admin@example.com --password password123
```

## Run the API (agent path)

Launch (long-running — background it with the Bash tool's `run_in_background`,
or append `&`):

```bash
cd apps/api && pnpm exec tsx src/index.ts   # -> "API listening on http://localhost:3000"
```

Confirm and drive end-to-end:

```bash
curl -fsS http://localhost:3000/health      # -> {"ok":true}
bash .claude/skills/run-delivery-tracker/smoke.sh
```

`smoke.sh` logs in, exercises brand/cargo CRUD + the internal domain hook, inserts
a trip straight into Postgres (real trip generation needs a Mapbox token), then
asserts the public `/share` render and that the same hash 404s on any other host.
Exit 0 = all 18 checks passed. Overridable env: `API_BASE`, `INTERNAL_TOKEN`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PG_CONTAINER`.

## Run the web app (agent path)

Launch the dev server (long-running; the TanStack route tree is generated on
startup):

```bash
cd apps/web && pnpm exec vite --host 127.0.0.1 --port 5173
```

Screenshot the login page (always use the `localhost` hostname — see Gotchas):

```bash
.claude/skills/run-delivery-tracker/shoot.sh http://localhost:5173/login /tmp/dt-shots/login.png
```

See the **live tracking map** (`/s/:hash`). It needs a brand bound to host
`localhost` + a trip; seed that, then shoot:

```bash
bash .claude/skills/run-delivery-tracker/seed-demo.sh   # -> http://localhost:5173/s/livedemo00000001
.claude/skills/run-delivery-tracker/shoot.sh http://localhost:5173/s/livedemo00000001 /tmp/dt-shots/map.png
```

A good `map.png` is ~1 MB (OSM tiles + route line + truck marker); a ~20 KB file
is the WebGL error page. **Open the PNG and look** — `shoot.sh` only checks the
file is non-empty.

## Test (direct invocation)

```bash
pnpm --filter @delivery/simulation test    # 64 — pure HOS / interpolation logic, no DB
pnpm --filter @delivery/schemas test       # 11 — Zod contracts
pnpm --filter @delivery/api test           # 102 — route handlers; mocks env+db, no DB needed
```

API tests mock `env`/`db`, so they pass without Postgres running. Most backend
PRs are covered here — run the relevant filter, not the whole tree.

## Run (human path)

`pnpm dev:api` and `pnpm dev:web` start watchers; the SPA opens at
http://localhost:5173. Useless for an agent — no programmatic handle. Use the
driver scripts above instead.

## Gotchas

- **`db:migrate` hides errors behind a spinner.** It prints `applying
  migrations...` and appears to hang or dies with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`.
  The real cause is almost always the DB URL. Verify with
  `docker exec delivery-tracker-postgres-1 psql -U delivery -d delivery_tracker -c '\dt'`.
- **Web CORS is pinned to `http://localhost:5173` in dev.** Screenshot/visit via
  `localhost`, never `127.0.0.1` — a `127.0.0.1` origin makes every API fetch fail
  and the SPA shows "Something went wrong! / Failed to fetch". (You may still bind
  Vite with `--host 127.0.0.1`; just navigate via `localhost`.)
- **MapLibre needs WebGL; headless Chrome has no GPU.** Plain `--headless`
  renders the `/s` page as a WebGL error ("...requestedAttributes..."). `shoot.sh`
  forces software GL via `--enable-unsafe-swiftshader --use-angle=swiftshader`.
- **The dev share page needs a brand whose `shareDomain` == the browser host
  (`localhost`).** The brand API rejects bare `localhost` (the schema requires a
  dotted FQDN), so `seed-demo.sh` inserts it directly via SQL. Without seeded data
  `/s/<hash>` just renders "Trip not found".
- **pnpm 10: bare `pnpm <script>` does not work.** Always `pnpm run <script>` or
  `pnpm --filter <pkg> <script>`.
- **Trip generation needs `MAPBOX_TOKEN`.** With it empty (the default), both
  `/trips/preview` and `/trips` return 503. `smoke.sh` asserts the 503 and seeds
  the share trip via SQL to cover the render path offline.

## Troubleshooting

- **API exits at startup with "Invalid environment configuration".** `JWT_SECRET`
  or `INTERNAL_TOKEN` is < 32 chars, or missing. Re-copy `apps/api/.env.example`
  (its placeholders are correct and long enough).
- **`db:migrate` hangs / `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`.** Almost always a DB
  connection problem — check `DATABASE_URL` in `apps/api/.env` and that Postgres is
  ready (`pg_isready`); verify the schema applied with `\dt` (see Gotchas).
- **Browser shows "Failed to fetch".** Wrong origin — use `localhost:5173`.
- **`/s` screenshot is a WebGL error page (~20 KB).** Use `shoot.sh` (it adds the
  SwiftShader flags); don't call Chrome directly.
- **`/s` shows "Trip not found".** Run `seed-demo.sh`.
- **Port already in use (3000 / 5432 / 5173).** A previous API/Postgres/Vite is
  still up; reuse it or stop it first.

## Teardown

```bash
docker compose down          # stop Postgres (add -v to also drop the data volume)
# stop the backgrounded API / Vite processes you launched
```
