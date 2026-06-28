# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах.

Монорепо (pnpm workspaces): `apps/{api,web}` — Hono API и React/Vite SPA; `packages/{schemas,simulation,tsconfig}` — общие Zod-схемы, симуляция и базовый tsconfig.

## Источники контекста

- **Архитектура**: [docs/architecture/README.md](docs/architecture/README.md)
- **Прод-операции**: [docs/runbook.md](docs/runbook.md)
- **Решения**: [docs/adr/](docs/adr/)
- **API контракт**: [docs/api/openapi.yaml](docs/api/openapi.yaml)
- **Домен приложения**: `admin.bluestarautotransport.com`
- **VPS хостинг**: `ssh tct-vps`


## Локальный запуск

Команды/версии — в `package.json` и `pnpm-workspace.yaml`; полный гайд (smoke, скриншот) — [`.claude/skills/run-delivery-tracker/SKILL.md`](.claude/skills/run-delivery-tracker/SKILL.md).

**Что нужно для старта** (иначе api падает на старте — env валидируется в `apps/api/src/env.schema.ts`):

- **Postgres**: `docker compose up -d` (postgres:18, порт `5432`). Без БД api не стартует.
- **`apps/api/.env`** (gitignored) — обязательные секреты: `DATABASE_URL` (≥20 симв., напр. `postgresql://delivery:dev_password@localhost:5432/delivery_tracker`), `JWT_SECRET` (≥32), `INTERNAL_TOKEN` (≥32). Опционально: `MAPBOX_TOKEN` (без него `/trips/preview`, `/trips`, `/admin/geocode` → 503; рабочий лежит в `.env.production`), `PUBLIC_BASE` (обязателен только в prod, валидируется как не-localhost URL).
- **Порты захардкожены**: api `:3000` (нет `PORT` env), web `:5173`.

Дев-админ: `admin@example.com` / `password123` (`pnpm --filter @delivery/api seed-admin`). На SPA ходи по `localhost`, **не** `127.0.0.1` — CORS запинен на `localhost:5173`.

**Чистый клон/CI**: `apps/web` typecheck падает с TS2307, пока не сгенерён `routeTree.gen.ts` (gitignored, его делает Vite-плагин TanStack Router). Сначала `pnpm --filter @delivery/web exec vite build`, потом typecheck (в CI это шаг «Generate web route tree»).

## Деплой (CI/CD)

Push/merge в `main` → GitHub Actions `build.yml` собирает api+web и пушит в `ghcr.io/trudogolik45/delivery-tracker-v2/{api,web}:<sha>` (auth = `GITHUB_TOKEN`, без PAT) → `deploy.yml` по ssh запускает `bin/deploy <sha>` на VPS: pull → migration-gate (additive применяются авто, деструктив → ручное окно) → `docker rollout` api/web (zero-downtime, health-gated) → verify `GET /api/version` → rollback на `.last_good_tag`. `compose.prod.yml` pull-based (`image:`/`${API_TAG}`; caddy остаётся на `build`). Рантайм-секреты живут в `.env.production` **на VPS**, не в GitHub. Полный поток, ручной fallback и миграционные окна — в [docs/runbook.md](docs/runbook.md).

## Use Context7 for Loading Documentation

Используй `resolve-library-id` → `get-library-docs`, или сразу передавай известный ID ниже. По умолчанию запрашивай документацию для версий, закреплённых в проекте.

**Recommended library IDs** (стек проекта):

- `/websites/hono_dev` — Hono (API-роутер, middleware)
- `/drizzle-team/drizzle-orm-docs` — Drizzle ORM (схема, миграции, query API)
- `/websites/zod_dev` — Zod (top-level хелперы `z.uuid()`/`z.email()`/`z.url()`)
- `/reactjs/react.dev` — React
- `/websites/vite_dev` — Vite (web-сборка)
- `/websites/tanstack_router` — TanStack Router (роуты `apps/web/src/routes/*`)
- `/websites/tanstack_query` — TanStack Query (data-fetching)
- `/tailwindlabs/tailwindcss.com` — Tailwind CSS
- `/shadcn-ui/ui` — shadcn/ui (`base-nova`)
- `/websites/vitest_dev` — Vitest (тесты API и simulation)

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
