# delivery-tracker — что не трогать

Изменения в этих файлах ломают сборку, генерацию или контракт. Если правка нужна — поднимай вопрос у пользователя до правки.

## Генерируемые / managed-файлы

| Путь | Кто владеет | Что вместо ручной правки |
|---|---|---|
| `pnpm-lock.yaml` | pnpm CLI | `pnpm install` (или `pnpm add <pkg>`) |
| `apps/web/src/routeTree.gen.ts` | TanStack Router plugin | Изменить роуты в `apps/web/src/routes/*.tsx`, plugin перегенерирует |
| `apps/api/src/db/migrations/*.sql` и `*.json` | drizzle-kit | `pnpm --filter @delivery/api db:generate` после правки `apps/api/src/db/schema.ts`. Постфактумные правки SQL = drift |

## Секреты / окружение

| Путь | Почему | Что делать |
|---|---|---|
| `.env`, `.env.production`, `.env.local`, `apps/*/.env*` | Содержат secret'ы | НЕ комитить, НЕ читать ради «посмотреть»; спросить какие ключи нужны и проверить через CI/runbook |

## Источники истины (правка только после согласования)

| Путь | Почему | Контракт |
|---|---|---|
| `docs/runbook.md` | Прод-процедуры (deploy, backup, rollback) | Любое отклонение синхронизировать в одном коммите с кодом |
| `docs/architecture/README.md` | Каноничный дизайн системы (~20KB) | Менять только при реальном архитектурном сдвиге, обсудив с пользователем |
| `docs/adr/*` | Архитектурные решения, immutable history | Новые ADR добавлять, существующие не переписывать |

## Артефакты сборки

| Путь | Чем создаётся |
|---|---|
| `dist/`, `apps/*/dist/`, `packages/*/dist/` | `tsc` / Vite |
| `node_modules/` | pnpm |
| `apps/web/.tanstack/` | TanStack Router cache |
| `apps/api/uploads/` | Локальный storage (dev) — НЕ комитить содержимое |
| `.codegraph/` | CodeGraph index |
