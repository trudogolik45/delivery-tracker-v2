# delivery-tracker — проект

Multi-tenant трекинг доставок: pickup'ы → водители → share-страницы на брендовых доменах. Полный дизайн: [docs/architecture/README.md](../../docs/architecture/README.md). Прод-операции: [docs/runbook.md](../../docs/runbook.md). Решения: [docs/adr/](../../docs/adr/).

## Стек

- **Runtime**: Node ≥24, pnpm 10 (закреплён через `packageManager` в корневом `package.json`)
- **API** (`apps/api`): Hono 4 + Drizzle ORM 0.45 + pg + Zod v4, ESM, TS 5.9 (`tsx watch`), Vitest 4
- **Web** (`apps/web`): Vite 8 + React 19 + TS ~6.0 + Tailwind v4 + shadcn/ui (`base-nova`) + TanStack Router + TanStack Query
- **Shared**: `packages/schemas` (Zod-контракт API), `packages/simulation` (subpath `./generate` Node-only, `./interpolate` browser-safe), `packages/tsconfig`
- **Postgres 18** через docker compose. `apps/api/src/db/schema.ts` — Drizzle-схема, миграции в `apps/api/src/db/migrations/`
- **Infra**: docker compose (dev), Caddy 2.11 + on-demand TLS (`infra/compose.prod.yml`, `infra/Caddyfile`)

## Структура

```
apps/api/src/{auth,db,middleware,routes,scripts,storage}/   # Hono сервер
apps/web/src/{components,lib,routes}/                       # React SPA
packages/{schemas,simulation,tsconfig}/                     # workspace deps
infra/                                                      # Caddyfile, compose.prod.yml
docs/{architecture,runbook,adr,api}/                        # источники истины
specs/                                                      # планы /spec
```

## Команды

| Задача | Команда | Где |
|---|---|---|
| Dev API / Web | `pnpm dev:api` / `pnpm dev:web` | корень |
| Build / Lint / Typecheck | `pnpm build` / `pnpm lint` / `pnpm typecheck` | корень (recursive `-r`) |
| Тесты API | `pnpm --filter @delivery/api test` | корень |
| Тесты simulation | `pnpm --filter @delivery/simulation test` | корень |
| Postgres dev | `docker compose up -d` | корень |
| DB миграции | `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | `apps/api` |
| Деплой прод | `pnpm deploy` | корень (через `docker --context delivery-prod`) |
| Прод миграции | `pnpm db:migrate:prod` | корень |
| Прод логи | `pnpm logs` | корень |
| shadcn add | `pnpm dlx shadcn@latest add <name>` | `apps/web` |

> pnpm 10: используй `pnpm run <script>` или `pnpm --filter <pkg> <script>`, не голый `pnpm <script>`.

## Переменные окружения

| Переменная | dev (`apps/api/.env`) | prod (`.env.production`) |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | то же, хост `postgres` (не `localhost`) |
| `JWT_SECRET` | подпись JWT (≥32 символа) | подпись JWT |
| `INTERNAL_TOKEN` | токен `/api/internal/*` (≥32) | токен `/api/internal/*` |
| `MAPBOX_TOKEN` | Mapbox Directions (HOS) | Mapbox Directions |
| `PUBLIC_BASE` | базовый URL админки | базовый URL админки |
| `STORAGE_ROOT` | путь uploads | путь uploads (volume `cargo_uploads`) |
| `NODE_ENV` | `development` / `test` | `production` |
| `APP_DOMAIN` | — | домен share-страниц |
| `ADMIN_DOMAIN` | — | домен админки |
| `POSTGRES_PASSWORD` | — | пароль прод-postgres |

> Тесты — `EnvSchema` из `apps/api/src/env.schema.ts`. Никогда не импортируй `env.ts` в тестах: он вызывает `process.exit` при провале валидации.

## Архитектурные инварианты

- **DAG зависимостей**: `schemas` → `simulation` → `apps/{api,web}`. Запрещены циклы и импорт `apps/*` из `packages/*`.
- **`@delivery/schemas` ≠ Drizzle-схема.** Контракт API живёт в `packages/schemas/src` (Zod). Таблицы — в `apps/api/src/db/schema.ts`. Не схлопывать.
- **Multi-tenant boundary**: админ-эндпоинты под `/admin/b/:slug/*` обязаны идти через `requireAdminBrand` (см. `apps/api/src/middleware/tenant.ts`) — иначе утечка между брендами. Share-страница резолвит `Host` → `brands.shareDomain` → `trips.shareHash`.
- **Storage**: в БД хранится `storageKey`, не URL. Публичный URL собирает `storage.url(key)` (host-relative `/uploads/<2-char-prefix>/<key>`). Caddy раздаёт файлы напрямую с volume.
- **Simulation split**: `@delivery/simulation/generate` — Node (Mapbox, FS), `@delivery/simulation/interpolate` — браузер. ESLint `no-restricted-imports` в `apps/web` блокирует случайный импорт `generate` в браузер.

## Тесты

- Vitest 4, `*.test.ts` рядом с исходником (`include: ['src/**/*.test.ts']` в `apps/api/vitest.config.ts`)
- API-тесты используют helper `_resetForTests()` для модулей с in-memory state (см. `apps/api/src/auth/rate-limiter.ts:97`)
- Smoke-тесты обязательно `curl`/`node`/`psql`-вариант; браузер — опционально поверх

## Деплой

Локальная машина → `docker --context delivery-prod` (SSH к прод-серверу, см. `package.json` scripts). Цикл: `pnpm lint && typecheck && test` → `pnpm deploy` → `pnpm db:migrate:prod` (если есть новые миграции) → `pnpm logs`. Backup: `pg_dump` + `restic` snapshot uploads volume → Hetzner Storage Box.
