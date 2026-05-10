# delivery-tracker — конвенции

## Git

- **Conventional commits**: `feat(api|web|db|infra):` / `chore(infra):` / `docs(runbook):` / `fix:`. Фаза работы — в теле, не в subject.
- **Код + runbook в одном коммите** при любом отклонении от `docs/runbook.md`.
- ⛔ Никогда `--amend`, force-push или `--no-verify` без явного запроса пользователя.
- Любой shell-тест — `curl`/`node`/`psql`-формой (а не только UI-проверкой).

## Code style

- **TypeScript strict** через `@delivery/tsconfig/base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`. `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`.
- **Zod v4 синтаксис**: top-level хелперы `z.uuid()`, `z.email()`, `z.url()` — НЕ `z.string().uuid()`/`z.string().email()`.
- **TS 6 (web)**: не добавлять `baseUrl` — `paths` работает без него.
- **API ESM-импорты с расширением `.js`**: `import { db } from './db/index.js'` (не `./db/index` и не `./db/index.ts`). `verbatimModuleSyntax` требует точное расширение для type-only импортов: `import type { Brand } from '...'`.
- **Drizzle pin**: `drizzle-orm@^0.45`, `drizzle-kit@^0.31`. Ветка `1.0.0-beta.x` — НЕ для прода до выхода `1.0.0` final.
- **Общие схемы — в `@delivery/schemas`**, не локально в роутах. Дублирование = рассинхронизация контракта.
- **Hono роуты**: каждый защищённый под-роутер начинает с `.use('*', requireAuth)`, бренд-скоупная часть добавляет `requireAdminBrand` (см. `apps/api/src/routes/admin.ts:107-108`). Эндпоинт без middleware = security regression.

## pnpm

- `auto-install-peers=true` (`.npmrc`).
- `pnpm.onlyBuiltDependencies` allow-list: `esbuild`, `msw`. **Новый нативный пакет → допиши в `package.json`**, иначе post-install молча пропустится.
- ⛔ `pnpm-lock.yaml` редактируется ТОЛЬКО через `pnpm install`. Не править руками.
- Команды запуска — `pnpm run <script>` или `pnpm --filter <pkg> <script>`. Голый `pnpm <script>` в pnpm 10 не работает для произвольных скриптов.
