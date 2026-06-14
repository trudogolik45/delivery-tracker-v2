# delivery-tracker — agent rules

> Только то, что tooling **не** ловит сам. Версии/настройки/команды смотри в `package.json`, `tsconfig`, `env.schema.ts`, `vitest.config.ts`.

## Git
- ⛔ Никогда `--amend`, force-push, `--no-verify` без явного запроса.
- ⛔ `pnpm-lock.yaml` — только через `pnpm install` / `pnpm add`, руками не править.
- Conventional commits: `feat(api|web|db|infra):` / `chore` / `docs(runbook):` / `fix:`. Фаза — в теле, не в subject.
- Отклонение от `docs/runbook.md` → код + runbook в **одном** коммите.

## ⛔ Не трогать (правка только после согласования)
- **Генерируемые**: `apps/web/src/routeTree.gen.ts` (правь роуты в `routes/*.tsx`), `apps/api/src/db/migrations/*` (правь `schema.ts` → `db:generate`; постфактумный SQL = drift).
- **Источники истины**: `docs/runbook.md`, `docs/architecture/README.md`, `docs/adr/*` (ADR immutable — добавлять новые, старые не переписывать).
- `apps/api/uploads/` — содержимое не комитить.

## Код
- **Zod v4**: top-level `z.uuid()` / `z.email()` / `z.url()` — НЕ `z.string().uuid()` (старый синтаксис ещё работает → typecheck смолчит).
- **API ESM-импорты с `.js`**: `import { db } from './db/index.js'`. Type-only — точное расширение: `import type { Brand } from '...'`.
- **Web (TS 6)**: НЕ добавлять `baseUrl` — `paths` работает без него.
- **Общие схемы — только в `@delivery/schemas`**, не локально в роутах (дублирование = рассинхрон контракта).
- **Drizzle**: ветка `1.0.0-beta.x` — НЕ для прода до `1.0.0` final.

## Безопасность (security regression, если забыть)
- Каждый защищённый под-роутер Hono начинает с `.use('*', requireAuth)`. Эндпоинт без middleware = дыра.
- Админ-эндпоинты `/admin/b/:slug/*` — обязательно через `requireAdminBrand`, иначе утечка между брендами.

## Архитектурные инварианты
- **DAG**: `schemas → simulation → apps/{api,web}`. Циклы и импорт `apps/*` из `packages/*` запрещены.
- **`@delivery/schemas` ≠ Drizzle-схема**: Zod-контракт в `packages/schemas/src`, таблицы в `apps/api/src/db/schema.ts`. Не схлопывать.
- **Storage**: в БД хранится `storageKey`, не URL. Публичный URL собирает `storage.url(key)`.
- **Simulation split**: `./generate` — Node-only, `./interpolate` — браузер.

## pnpm
- pnpm 11: запуск только `pnpm run <script>` или `pnpm --filter <pkg> <script>`. Голый `pnpm <script>` не работает.
- Новый нативный пакет → допиши в `allowBuilds` (карта `имя: true`) в `pnpm-workspace.yaml`, иначе post-install молча пропустится. Старый ключ `pnpm.onlyBuiltDependencies` в `package.json` pnpm 11 уже не читает.
- Общие версии зависимостей — в `catalog:` (`pnpm-workspace.yaml`); в пакетах ставь `"catalog:"`, номер версии руками не дублируй.

## Тесты
- ⛔ Никогда не импортируй `env.ts` в тестах — он вызывает `process.exit` на провале валидации. Используй `EnvSchema` из `env.schema.ts`.
- Модули с in-memory state сбрасывай через `_resetForTests()`.
- Smoke-тесты — обязательно `curl`/`node`/`psql`-форма; браузер опционально поверх.

## Деплой
Цикл: `pnpm lint && typecheck && test` → `pnpm deploy` → `pnpm db:migrate:prod` (если есть новые миграции) → `pnpm logs`.

## Shell (агент висит на y/n из-за алиасов)
- Форсирующие флаги всегда: `cp -f`, `mv -f`, `rm -f`, `cp -rf`, `rm -rf`.
- `ssh`/`scp` → `-o BatchMode=yes`; `apt-get` → `-y`; `brew` → `HOMEBREW_NO_AUTO_UPDATE=1`.