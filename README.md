# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах.

## Стек

API: Hono 4 + Drizzle ORM 0.45 + Postgres 18 + Zod v4 (Node ≥24, ESM).
Web: React 19 + Vite 8 + TanStack Router + TanStack Query + Tailwind v4 + shadcn/ui.
Монорепо на pnpm 10, shared-пакеты: `@delivery/schemas` (Zod-контракт), `@delivery/simulation`.

## Quick start

```bash
pnpm install
docker compose up -d

# Настрой окружение API
cp -f apps/api/.env.example apps/api/.env
# Открой apps/api/.env и заполни JWT_SECRET, INTERNAL_TOKEN (каждый ≥32 символов).
# Полный список переменных — apps/api/.env.example

pnpm --filter @delivery/api db:migrate

# Запуск
pnpm dev:api   # http://localhost:3000
pnpm dev:web   # http://localhost:5173
```

## Проверка

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

## Документация

| Раздел | Путь |
|---|---|
| Архитектура системы | [docs/architecture/README.md](docs/architecture/README.md) |
| Прод-операции (deploy, backup, rollback) | [docs/runbook.md](docs/runbook.md) |
| Архитектурные решения (ADR) | [docs/adr/](docs/adr/) |
| API-контракт (OpenAPI) | [docs/api/openapi.yaml](docs/api/openapi.yaml) |
| Инструкции для агентов (Claude Code) | [CLAUDE.md](CLAUDE.md) |
| Локальный запуск, smoke-тест, gotchas | [.claude/skills/run-delivery-tracker/SKILL.md](.claude/skills/run-delivery-tracker/SKILL.md) |
