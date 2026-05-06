# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах. Полный дизайн — в [architecture.md](architecture.md).

## Стек

- Node ≥24, pnpm 10 (закреплён через `packageManager` в корневом `package.json`)
- Postgres 18 (через docker compose)
- API: Hono 4 + Drizzle ORM 0.45 + pg + Zod v4
- Web: Vite 8 + React 19 + TypeScript 6 + Tailwind v4 + shadcn/ui (`base-nova`) + TanStack Router + TanStack Query
- Infra: docker compose (dev), Caddy + docker compose (prod, скелет)

## Структура

```
.
├── apps/
│   ├── api/              # Hono сервер (@delivery/api), порт 3000
│   └── web/              # Vite SPA (@delivery/web), порт 5173
├── packages/
│   ├── schemas/          # Zod-схемы — единая истина для api↔web
│   ├── simulation/       # HOS-симулятор (заглушка)
│   └── tsconfig/         # общие base/node/react.json
├── infra/                # Caddyfile + compose.prod.yml
├── docker-compose.yml    # локальный Postgres
├── runbook.md            # пошаговое разворачивание с нуля (фазы 0–8)
└── architecture.md       # дизайн-документ (multi-tenancy, иерархия пакетов, БД)
```

## Команды

Из корня:

| Что | Команда |
|---|---|
| Запустить API (dev) | `pnpm dev:api` |
| Запустить web (dev) | `pnpm dev:web` |
| Билд всех пакетов | `pnpm build` (= `pnpm -r build`) |
| Lint | `pnpm lint` (= `pnpm -r lint`) |
| Typecheck всех | `pnpm typecheck` (= `pnpm -r typecheck`) |
| Запустить Postgres локально | `docker compose up -d` |
| Тесты | <!-- TODO: тестовый раннер пока не настроен --> |

В `apps/api` (либо из корня через `pnpm --filter @delivery/api <script>`):

| Что | Команда |
|---|---|
| Сгенерировать миграцию | `pnpm db:generate` |
| Применить миграции | `pnpm db:migrate` |
| Drizzle Studio | `pnpm db:studio` |
| Билд (тoolchain only) | `pnpm build` (`tsc`) |
| Старт скомпилированного | `pnpm start` (`node dist/index.js`) |

> **Не используй голый `pnpm <script>`** в pnpm 10 — он рекурсивно ищет скрипт во всех workspace-пакетах и падает, если где-то его нет. Только `pnpm run <script>` (текущая папка) или `pnpm --filter <pkg> <script>` (адресно).

Добавить shadcn-компонент: `pnpm dlx shadcn@latest add <name>` из `apps/web`.

## Переменные окружения

`apps/api/.env` (dev, локально, в `.gitignore`):

| Имя | Назначение |
|---|---|
| `DATABASE_URL` | Postgres connection string; читают `apps/api/src/db/index.ts` и `drizzle.config.ts` |
| `JWT_SECRET` | Подпись JWT для админ-сессий |
| `MAPBOX_TOKEN` | Серверные вызовы Mapbox Directions для HOS-симулятора |

`.env.production` (для `infra/compose.prod.yml`, в `.gitignore`):

| Имя | Назначение |
|---|---|
| `APP_DOMAIN` | Базовый домен share-страниц |
| `ADMIN_DOMAIN` | Фиксированный админ-домен |
| `POSTGRES_PASSWORD` | Пароль БД для прод-postgres |
| `DATABASE_URL` | Connection string прод-API (хост `postgres`, не `localhost`) |
| `JWT_SECRET` | Прод-секрет JWT |
| `MAPBOX_TOKEN` | Прод-токен Mapbox |

## Куда смотреть дальше

- **Запуск с нуля** → [.claude/skills/local-setup/SKILL.md](.claude/skills/local-setup/SKILL.md) или [runbook.md](runbook.md) фазы 0–8
- **Миграции БД** → [.claude/skills/migrations/SKILL.md](.claude/skills/migrations/SKILL.md)
- **Деплой / прод-инфра** → [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md) + [runbook.md](runbook.md) Phase 7 + [architecture.md](architecture.md) разделы «Caddyfile (production)» и «docker compose (production)»
- **Архитектурные решения** (multi-tenancy, иерархия пакетов, схема БД, storage) → [architecture.md](architecture.md)
- **Troubleshooting** известных грабель (postgres mount, `tsx not found`, `Ignored build scripts`, и т.д.) → [runbook.md](runbook.md) раздел «Troubleshooting»

## Конвенции

### Git: один RUNBOOK-фаза = один conventional-commit
Префиксы: `feat(api|web|db|infra):`, `chore(infra):`, `docs(runbook):`, `fix:`. Номер фазы — в теле, не в subject. Если правка кода влечёт правку runbook — обе вещи в одном коммите. Никогда `--amend`/force-push/`--no-verify` без явного запроса.

### Дрейф runbook → запрещён
Любое отклонение от [runbook.md](runbook.md) (CLI поменял флаг, версия зависимости стала другая, smoke-тест уточнён) синхронизируется обратно в runbook **в том же ходе**, что и код. Иначе будущие свежие установки сломаются.

### Smoke-тесты — headless-first
В этом репо каждый smoke имеет вариант через `curl` + `node` (или `psql`). Визуальные «открой в браузере» — опциональный ассерт сверху, не основной.

### Code style
- TypeScript strict — наследуется через `@delivery/tsconfig/base.json` (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Zod **v4** синтаксис: `z.uuid()`, `z.email()` (top-level), не `z.string().uuid()`.
- TS 6: **не** добавлять `baseUrl` (deprecated, удалится в TS 7) — `paths` работает без него с TS 5+.
- API — ESM (`"type": "module"`); относительные импорты — с `.js`-расширением (`./db/schema.js`).
- Drizzle pin: `drizzle-orm@^0.45`, `drizzle-kit@^0.31` — не апгрейдить на `1.0.0-beta.x` без причины.
- Общие схемы (включая массивные, `BrandsArraySchema = z.array(...)`) — в `@delivery/schemas`, не локально в роутах. Транзитивные deps в pnpm 10 недоступны через bare-import.

### Pnpm специфика
- `auto-install-peers=true` (см. `.npmrc`).
- Нативные postinstall'ы разрешаются явно через `pnpm.onlyBuiltDependencies` в корневом `package.json`. Сейчас allow-list: `esbuild` (с `tsx`/`@tailwindcss/vite`), `msw` (транзитивно через `shadcn`). Новый нативный пакет → допиши в этот список.

## Не трогать

- **`pnpm-lock.yaml`** — не редактировать руками; пересоздаётся через `pnpm install`.
- **`apps/web/src/routeTree.gen.ts`** — генерируется TanStack Router-плагином при первом `pnpm dev:web`; в `.gitignore`.
- **`apps/api/src/db/migrations/*.sql` + `meta/`** — applied миграции; не редактировать постфактум, только новая через `pnpm --filter @delivery/api db:generate`.
- **`.env`, `.env.local`, `.env.production`** — в `.gitignore`. Не комитить даже placeholder-значения.
- **`dist/`, `node_modules/`** — генерируемые.
- **`runbook.md`** и **`architecture.md`** — править только после согласования с пользователем; runbook ведётся синхронно с кодом, architecture — с долгосрочными решениями.


## Agent skills

### Issue tracker

Issues live in **bd (beads)** — local-only issue tracker. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles map to default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: один `CONTEXT.md` + `docs/adr/` в корне (создаются лениво по мере накопления решений). See `docs/agents/domain.md`.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
