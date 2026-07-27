## Project
delivery-tracker — multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах. Домен админки: `tracking.cpbox.space`; VPS: `ssh tct-vps`.

## Stack
- TypeScript, Node ≥24, pnpm 11 (workspaces-монорепо)
- API: Hono + `@hono/node-server`; Web: React + Vite + TanStack Router/Query + Tailwind + shadcn/ui (`base-nova`)
- БД: Postgres 18 + Drizzle ORM (миграции `drizzle-kit`)
- Валидация: Zod (общие схемы в `packages/schemas`); карты: Mapbox + Turf
- Тесты: Vitest. Деплой: GitHub Actions → GHCR → `docker rollout` на VPS (Caddy + compose)
- Домен приложения `tracking.cpbox.space`, NS записи у Cloudflare, доступ по `GREGOR_CLOUDFLARE_API_TOKEN` ключу из `.env`

## Structure
- `apps/api/src/` — Hono API: `routes/` (admin, share, internal), `auth/` (JWT, rate-limit), `db/` (schema, миграции, `tenant.ts`), `middleware/`, `env.schema.ts`
- `apps/web/src/` — React SPA: `routes/` (TanStack, файловый роутинг), `components/`
- `packages/schemas` — общие Zod-схемы (контракт API↔web); `packages/simulation` — расчёт маршрута/таймлайна; `packages/tsconfig` — базовый tsconfig
- `docs/` — `architecture/`, `runbook.md`, `adr/`, `api/openapi.yaml`
- `*.test.ts` рядом с кодом (API/simulation)

## Commands
- Dev: `pnpm dev:api` (`:3000`) + `pnpm dev:web` (`:5173`); сначала `docker compose up -d` (Postgres `:5432`)
- Build: `pnpm build` (`pnpm -r build`)
- Test: `pnpm test`; одиночный пакет — `pnpm --filter @delivery/api test`
- Lint: `pnpm lint`; формат — `pnpm format`
- Миграции: `pnpm db:migrate`; сид дев-админа — `pnpm --filter @delivery/api seed-admin` (`admin@example.com` / `password123`)

## Verification
После каждого изменения, в порядке:
1. `pnpm typecheck` — чинить ошибки типов. **На чистом клоне/CI** `apps/web` падает с TS2307, пока не сгенерён `routeTree.gen.ts` (gitignored, его делает Vite-плагин TanStack Router): сначала `pnpm --filter @delivery/web exec vite build`, потом typecheck.
2. `pnpm test` — чинить упавшие тесты (включая `admin.arch.test.ts` — см. Don't)
3. `pnpm lint` — чинить lint

## Conventions
- **Старт API строго валидирует env** (`apps/api/src/env.schema.ts`): обязательны `DATABASE_URL` (≥20), `JWT_SECRET` (≥32), `INTERNAL_TOKEN` (≥32). Без Postgres и `apps/api/.env` (gitignored) api не стартует. `MAPBOX_TOKEN` опционален (без него `/trips/preview`, `/trips`, `/admin/geocode` → 503); `PUBLIC_BASE` обязателен только в prod.
- Порты захардкожены: api `:3000` (нет `PORT`), web `:5173`. На SPA ходи по `localhost`, **не** `127.0.0.1` — CORS запинен на `localhost:5173`.
- Tenant-доступ к данным — только через `tenantDb(brand)` (`apps/api/src/db/tenant.ts`); `brands` — таблица резолва тенанта, к ней `.from(brands)` напрямую разрешён.
- Все БД-таблицы tenant-данных несут `brandId`; контракт API↔web живёт в `packages/schemas` (Zod) — меняешь форму ответа там, не в роуте.
- Деплой: push/merge в `main` → CI собирает образы в `ghcr.io/trudogolik45/delivery-tracker-v2/{api,web}:<sha>` → `bin/deploy` на VPS (migration-gate, zero-downtime rollout, verify `/version`, rollback). Рантайм-секреты — в `.env.production` **на VPS**, не в GitHub. Поток — `docs/runbook.md`.
- Задачи трекаются через **bd (beads)**, НЕ TodoWrite/markdown; знания — `bd remember`. `bd prime` — контекст, `bd ready` — работа. Не коммить/пушить без явной просьбы.

## Don't (несущие инварианты — тронешь, всё сломается)
- **Не делай `db.select().from(cargo|trips|uploads)` в `src/routes`, `src/middleware`, `src/auth`** — только через `tenantDb(brand)`. Это единственная защита от утечки данных между тенантами (каждый метод вшивает `eq(table.brandId, brand.id)`). Инвариант охраняет `admin.arch.test.ts`.
- **Не меняй схему резолва бренда без проверки изоляции**: admin резолвит по `:brandSlug` + `ownerId` юзера (`middleware/tenant.ts`); share — по `Host` → `lower(shareDomain)` (`routes/share.ts`, индекс из миграции 0011). Оба обязаны идти через `tenantDb`.
- **Не возвращай различимые ответы для «не найдено»**: неизвестный host, чужой бренд и несуществующий hash отдают идентичный `{ error: 'trip not found' }` 404; `/internal/*` → 404 (не 401). Различимость = утечка существования.
- **Не убирай query-fallback `?token=` у `INTERNAL_TOKEN`** (`routes/internal.ts`): Caddy `on_demand_tls.ask` шлёт голый GET без заголовков. Сравнение через `timingSafeEqual`. И **не логируй `/internal/*`** (`index.ts`) — токен в URL не должен попасть в stdout.
- **Не удаляй outbound `ShareResponseSchema.parse` в `share.ts`** — это единственный runtime-guard формы хранимого jsonb (`routeGeometry`/`timeline`/`segments`); на INSERT ничего не валидируется.
- **Не выноси guard pause/resume в JS** — «не-уже-на-паузе» зашит в SQL WHERE (`tenantDb.trips.pauseAtomic/resumeAtomic`); в коде он не атомарен и допустит двойную паузу при гонке.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

Задачи трекаются через **bd (beads)** — НЕ TodoWrite/markdown TODO. Знания — `bd remember`, НЕ MEMORY.md.

```bash
bd prime              # полный контекст workflow + протокол закрытия сессии (читай это)
bd ready              # доступная работа
bd show/update <id> --claim / close <id>
```

Не коммить/пушить и не делай Dolt-sync без явной просьбы. Подробности — `bd prime`.
<!-- END BEADS INTEGRATION -->
