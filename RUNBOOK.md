# Delivery Tracker — Scaffolding Runbook

Пошаговое разворачивание проекта с нуля. Каждая фаза заканчивается smoke-тестом — если он не прошёл, не двигайся дальше.

Все команды грунтуются на официальных доках:
- pnpm workspaces — https://pnpm.io/workspaces
- Hono Node.js — https://hono.dev/docs/getting-started/nodejs
- Drizzle + PostgreSQL — https://orm.drizzle.team/docs/get-started/postgresql-new
- Vite + React — https://vite.dev/guide/
- Tailwind CSS v4 — https://tailwindcss.com/docs/installation/using-vite
- shadcn/ui (Vite) — https://ui.shadcn.com/docs/installation/vite
- TanStack Router — https://tanstack.com/router/latest/docs/installation/with-vite
- TanStack Query — https://tanstack.com/query/latest

---

## Phase 0 — Prerequisites

```bash
node --version         # хотим v24.x
corepack --version     # должен быть установлен (входит в Node 24)
docker --version
docker compose version
```

Если Node не 24 — поставь через [nvm](https://github.com/nvm-sh/nvm) или [fnm](https://github.com/Schniz/fnm):

```bash
fnm install 24 && fnm use 24
```

pnpm ставим через `corepack` (рекомендованный путь начиная с Node 16+):

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version          # должно быть 10+
```

---

## Phase 1 — Bootstrap monorepo

```bash
mkdir delivery-tracker && cd delivery-tracker
git init
pnpm init
```

Замени корневой `package.json` на минимальный:

```json
{
  "name": "delivery-tracker",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev:api": "pnpm --filter @delivery/api dev",
    "dev:web": "pnpm --filter @delivery/web dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "esbuild"
    ]
  }
}
```

Поле `pnpm.onlyBuiltDependencies` — это явный allow-list для нативных postinstall-скриптов (pnpm 10 по умолчанию их блокирует ради безопасности). `esbuild` нужен сразу — он приедет транзитивно с `tsx` в `apps/api` и без allow-list даст предупреждение `Ignored build scripts: esbuild@x.y.z`. Список будет пополняться по мере появления новых нативных пакетов (Tailwind v4 через `@tailwindcss/oxide`, `better-sqlite3`, и т.д.) — добавляй сюда по факту.

Закрепи pnpm под Corepack — командой, которая сама пропишет версию + integrity-хеш:

```bash
corepack use pnpm@latest
```

Проверь, что в `package.json` появилась строка вида `"packageManager": "pnpm@10.x.y+sha512..."`. Дальше эту версию обновляешь только сознательно через `corepack use pnpm@<новая>` — она же будет использоваться у всех, кто клонирует репо.

Создай `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Создай `.gitignore`:

```
node_modules
dist
.env
.env.local
.DS_Store
*.log
.turbo
```

Создай `.npmrc` с двумя важными настройками:

```
strict-peer-dependencies=false
auto-install-peers=true
```

`auto-install-peers` особенно важен — без него peer-зависимости React/Tailwind/Drizzle придётся вручную добавлять.

**Smoke test**: `pnpm install` отрабатывает без ошибок.

---

## Phase 2 — `packages/tsconfig`

Базовые tsconfig'и, от которых extend'ятся все приложения. Делаем первым, чтобы дальше не копипастить.

```bash
mkdir -p packages/tsconfig
cd packages/tsconfig
```

Создай `packages/tsconfig/package.json`:

```json
{
  "name": "@delivery/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": ["base.json", "node.json", "react.json"]
}
```

`packages/tsconfig/base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`packages/tsconfig/node.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  }
}
```

`packages/tsconfig/react.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "useDefineForClassFields": true
  }
}
```

`cd ../..` обратно в корень.

---

## Phase 3 — `packages/schemas`

Самый маленький пакет — Zod-схемы. Делаем рано, потому что от него зависят все остальные.

```bash
mkdir -p packages/schemas/src
cd packages/schemas
pnpm init
pnpm add zod
pnpm add -D typescript "@delivery/tsconfig@workspace:*"
```

`packages/schemas/package.json` — **полностью замени содержимое** файла на блок ниже. `pnpm init` генерит дефолтный шаблон с `"main": "index.js"`, `test`-скриптом и автоматически добавляет лишнее поле `packageManager` в каждый новый `package.json`. Всё это нам не нужно — берём чистый минимум:

```json
{
  "name": "@delivery/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@delivery/tsconfig": "workspace:*",
    "typescript": "^5.6.0"
  }
}
```

`packages/schemas/tsconfig.json`:

```json
{
  "extends": "@delivery/tsconfig/base.json",
  "include": ["src/**/*"]
}
```

`packages/schemas/src/index.ts` — пока заглушка, чтобы пакет собирался:

```ts
import { z } from 'zod'

export const PingSchema = z.object({
  ok: z.literal(true),
  ts: z.number(),
})

export type Ping = z.infer<typeof PingSchema>
```

**Smoke test**:

После любого ручного редактирования внутреннего `package.json` (особенно когда меняешь `name`) обязательно прогони `pnpm install` из **корня репозитория** — это пересоберёт workspace-симлинки и зарегистрирует пакет под новым именем:

```bash
cd ../..
pnpm install
pnpm --filter @delivery/schemas run typecheck
```

Команда должна отработать без вывода (это успех для `tsc --noEmit`). Используй именно `pnpm run <script>` для своих скриптов — голый `pnpm <script>` в pnpm 10 пытается выполнить скрипт во всех пакетах monorepo и падает, если где-то его нет.

`cd ../..` обратно.

---

## Phase 4 — `packages/simulation`

Структура такая же, как у `schemas`, но с двумя экспортами вместо одного — это важная часть архитектуры (см. ARCHITECTURE.md, иерархия пакетов).

```bash
mkdir -p packages/simulation/src
cd packages/simulation
pnpm init
pnpm add "@delivery/schemas@workspace:*" @turf/along @turf/length
pnpm add -D typescript "@delivery/tsconfig@workspace:*" @types/geojson
```

`packages/simulation/package.json` — снова **полностью замени** содержимое:

```json
{
  "name": "@delivery/simulation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./generate": "./src/generate.ts",
    "./interpolate": "./src/interpolate.ts",
    "./types": "./src/types.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@delivery/schemas": "workspace:*",
    "@turf/along": "^7.0.0",
    "@turf/length": "^7.0.0"
  },
  "devDependencies": {
    "@delivery/tsconfig": "workspace:*",
    "@types/geojson": "^7946.0.14",
    "typescript": "^5.6.0"
  }
}
```

Заметь: **корневого `.` экспорта нет**. Это намеренно — фронт не должен случайно импортировать generate-код через `@delivery/simulation`.

`packages/simulation/tsconfig.json`:

```json
{
  "extends": "@delivery/tsconfig/base.json",
  "include": ["src/**/*"]
}
```

Заглушки в `packages/simulation/src/`:

`types.ts`:

```ts
export type Position = { lat: number; lng: number }
export type Segment =
  | { type: 'driving'; tStart: number; tEnd: number; distStart: number; distEnd: number }
  | { type: 'rest'; tStart: number; tEnd: number; atDist: number }
```

`generate.ts`:

```ts
// Node-only. Вызывает Mapbox Directions, строит таймлайн.
export function generateTimeline(): unknown {
  throw new Error('not implemented')
}
```

`interpolate.ts`:

```ts
// Browser-safe. Чистая функция: position(trip, t).
import type { Position } from './types.js'

export function interpolatePosition(): Position {
  throw new Error('not implemented')
}
```

`geo.ts` создавать пока не нужно — добавишь, когда понадобится.

**Smoke test**: `pnpm run typecheck` из `packages/simulation`. Если падает — проверь, что `@delivery/schemas` уже собран (или просто запусти `pnpm install` из корня после добавления зависимости).

`cd ../..` обратно.

---

## Phase 5 — `apps/api` (Hono + Drizzle + Postgres)

> Перед началом фазы убедись, что ты в **корне репозитория**: `pwd` должно показать путь к `delivery-tracker`, а `ls` — содержать `pnpm-workspace.yaml`.

### 5.1 Bootstrap Hono

Используем официальный template (см. https://hono.dev/docs/getting-started/nodejs):

```bash
mkdir -p apps && cd apps
pnpm create hono@latest api --template nodejs --pm pnpm --install
cd api
```

> Заметь: для `pnpm create` аргументы передаются напрямую, без `--` (это особенность pnpm vs npm).

Шаблон создаёт `src/index.ts`, `tsconfig.json`, `package.json` со скриптами и зависимостями. Сразу после `--install` в `apps/api/package.json` уже должны быть установлены `hono`, `@hono/node-server` (в `dependencies`) и `tsx`, `@types/node`, `typescript` (в `devDependencies`) — **не удаляй их**. Версии в свежих установках могут отличаться от приведённых ниже.

Свежий `src/index.ts` от шаблона выглядит так (заметь: текст ответа `Hello Hono!`, его поправим ниже под наш smoke-тест):

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
```

Поменяй текст ответа на `'Hello Node.js!'` — это сделает smoke-тест ниже однозначным.

Теперь `apps/api/package.json`. **Не заменяй файл целиком** — иначе вылетят зависимости, которые поставил шаблон, и `pnpm dev` упадёт с `tsx: command not found`. Точечно поправь только три вещи:

1. `name` → `@delivery/api`
2. Убедись, что `"type": "module"` присутствует.
3. Добавь в `scripts` поле `typecheck` и три `db:*`-скрипта (понадобятся в фазе 5.3):

```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio"
}
```

После правок итоговый файл должен выглядеть примерно так (версии у тебя могут быть свежее):

```json
{
  "name": "@delivery/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "hono": "^4.12.0",
    "@hono/node-server": "^2.0.0"
  },
  "devDependencies": {
    "@delivery/tsconfig": "workspace:*",
    "@types/node": "^25.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.0"
  }
}
```

> Если ты случайно затёр `dependencies` и `devDependencies` (типичная ошибка — копирование шаблона целиком), восстанови их одной командой:
> ```bash
> pnpm --filter @delivery/api add hono @hono/node-server
> pnpm --filter @delivery/api add -D tsx typescript @types/node
> ```

Перепривяжи tsconfig к нашему общему:

`apps/api/tsconfig.json`:

```json
{
  "extends": "@delivery/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

Установи `@delivery/tsconfig` как dev-зависимость:

```bash
pnpm add -D "@delivery/tsconfig@workspace:*"
```

**Smoke test**:

```bash
pnpm dev:api          # из корня репозитория (pnpm dev в корне нет — есть dev:api / dev:web)
# в другом терминале:
curl http://localhost:3000
# → Hello Node.js!
```

### 5.2 Локальный Postgres через Docker

В корне репозитория создай `docker-compose.yml` (только для dev, не путать с `infra/compose.prod.yml`):

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: delivery_tracker
      POSTGRES_USER: delivery
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql

volumes:
  postgres_data:
```

> Важно: монтируем именно в `/var/lib/postgresql`, **не** в `/var/lib/postgresql/data`. Начиная с `postgres:18` (см. [docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259)) образ хранит данные в подпапке `<major>/docker/` (например, `/var/lib/postgresql/18/docker/`) — это нужно, чтобы `pg_upgrade --link` мог работать через границу маунта при будущих апгрейдах major-версии. Если оставить старый путь `/var/lib/postgresql/data`, контейнер уйдёт в restart-петлю с ошибкой `Error: in 18+, these Docker images are configured to store database data in a format which is compatible with "pg_ctlcluster"`.

Запусти:

```bash
docker compose up -d
docker compose ps   # postgres должен быть Up
```

**Smoke test** — убедись, что Postgres готов принимать подключения:

```bash
docker compose exec postgres pg_isready -U delivery -d delivery_tracker
# → /var/run/postgresql:5432 - accepting connections

docker compose exec postgres psql -U delivery -d delivery_tracker -c "SELECT version();"
# → PostgreSQL 18.x on ...
```

### 5.3 Drizzle + Zod-валидация (см. https://orm.drizzle.team/docs/get-started/postgresql-new)

В `apps/api` (сразу пинуем Drizzle на стабильный канал `0.45.x` / `0.31.x` — у пакета параллельно публикуются `1.0.0-beta.x`, и без явного пина pnpm может однажды втянуть бету):

```bash
pnpm add 'drizzle-orm@^0.45.0' pg dotenv @hono/zod-validator "@delivery/schemas@workspace:*"
pnpm add -D 'drizzle-kit@^0.31.0' @types/pg
```

> Если получаешь от zsh `no matches found: drizzle-orm@^0.45.0` — заверни аргумент в одинарные кавычки, как в примере выше; `^` zsh пытается раскрыть как glob.

Создай `apps/api/.env`:

```
DATABASE_URL=postgresql://delivery:dev_password@localhost:5432/delivery_tracker
JWT_SECRET=dev-secret-change-in-prod
MAPBOX_TOKEN=
```

Добавь `.env` в `.gitignore` (если ещё нет в корневом).

Создай `apps/api/drizzle.config.ts`:

```ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
})
```

Файл лежит в корне `apps/api/`, а не в `src/`, поэтому LSP по дефолту не видит его как часть TS-проекта и подсвечивает `process` как unresolved. Поправь `apps/api/tsconfig.json` — добавь файл в `include` и убери `rootDir` (с двумя верхнеуровневыми входами он не имеет смысла; `outDir` достаточно для контроля сборки):

```json
{
  "extends": "@delivery/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*", "drizzle.config.ts"]
}
```

> Сам `drizzle-kit` использует свой загрузчик и работает независимо от нашего `tsconfig` — без этой правки миграции всё равно сгенерятся. Правка нужна только для зелёного LSP/`tsc --noEmit`.

Создай минимальную схему `apps/api/src/db/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  shareDomain: text('share_domain').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

Создай клиент `apps/api/src/db/index.ts`:

```ts
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle({ client: pool, schema })
```

Сгенерируй и применяй миграцию (из `apps/api`):

```bash
pnpm db:generate    # создаст src/db/migrations/0000_<random>.sql
pnpm db:migrate     # применит к локальному Postgres
```

**Smoke test** — проверь напрямую через psql, что таблица создалась:

```bash
docker compose exec postgres psql -U delivery -d delivery_tracker -c "\dt"
# → видна таблица "brands"

docker compose exec postgres psql -U delivery -d delivery_tracker -c "\d brands"
# → структура: id (uuid pk), slug/share_domain (text unique not null), name, created_at
```

Опционально — браузерный UI: `pnpm db:studio` (откроется `https://local.drizzle.studio`, увидишь ту же таблицу `brands`).

### 5.4 Подключи `@delivery/schemas` к роуту

Замени содержимое `packages/schemas/src/index.ts` на Zod-схему для бренда (заглушка `PingSchema` нам больше не нужна):

```ts
import { z } from 'zod'

export const BrandPublicSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
})
export type BrandPublic = z.infer<typeof BrandPublicSchema>
```

> Заметь: `z.uuid()` — это Zod **v4**-синтаксис (top-level валидаторы). У нас в `packages/schemas` стоит `zod@^4.0.0` (см. фазу 3). В Zod v3 этот же валидатор пишется как `z.string().uuid()` — если по какой-то причине ты остался на v3, используй v3-форму. Документация по миграции: https://zod.dev/v4.

В `apps/api/src/index.ts` сделай реальный роут (заметь — главный `/` эндпоинт из фазы 5.1 уходит, теперь основная функциональность через `/health` и `/brands`):

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { BrandPublicSchema } from '@delivery/schemas'
import { db } from './db/index.js'
import { brands } from './db/schema.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

app.get('/brands', async (c) => {
  const rows = await db.select().from(brands)
  const result = rows.map((b) =>
    BrandPublicSchema.parse({ id: b.id, slug: b.slug, name: b.name }),
  )
  return c.json(result)
})

const server = serve(app, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
```

> Заметь, в `BrandPublicSchema.parse(...)` мы сознательно **не передаём** `share_domain` — он нужен только для tenant-резолвинга по `Host`-заголовку (см. фазу 6/middleware tenant), и наружу публиковать его незачем. Схема выступает фильтром «БД → внешний API».

**Smoke test** (постгрес должен быть `Up` — если нет, `docker compose up -d`):

```bash
pnpm dev:api
# в другом терминале
curl http://localhost:3000/health    # → {"ok":true}
curl http://localhost:3000/brands    # → []
```

Опционально — проверь, что Zod-валидация реально пропускает данные из БД (`share_domain` останется внутри, в JSON не уйдёт):

```bash
docker compose exec postgres psql -U delivery -d delivery_tracker \
  -c "INSERT INTO brands (slug, share_domain, name) VALUES ('acme', 'acme.example.com', 'ACME Logistics');"

curl -s http://localhost:3000/brands | python3 -m json.tool
# → [{ "id": "<uuid>", "slug": "acme", "name": "ACME Logistics" }]   ← share_domain отфильтрован

# подчисти за собой:
docker compose exec postgres psql -U delivery -d delivery_tracker -c "DELETE FROM brands;"
```

`cd ../..` обратно в корень.

---

## Phase 6 — `apps/web` (Vite + React + Tailwind 4 + shadcn + TanStack Router/Query)

> Снова — убедись, что ты в **корне репозитория** перед стартом фазы.

### 6.1 Bootstrap Vite + React + TS

Из `apps/`:

```bash
cd apps
pnpm create vite@latest web --template react-ts
```

Скаффолд **не** ставит зависимости — он ожидает, что мы сделаем install сами. Не запускай `pnpm install` внутри `apps/web/` — у нас monorepo, install делаем из корня (так workspace-симлинки и lockfile останутся корректными).

Поправь `apps/web/package.json` точечно — только три вещи (всё остальное от шаблона оставляем как есть):

1. `name: "web"` → `name: "@delivery/web"` (без этого pnpm не подцепит пакет в workspace).
2. Добавь скрипт `typecheck`, чтобы web попадал в общий `pnpm -r typecheck`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "typecheck": "tsc -b --noEmit"
}
```

Теперь tsconfig'и. Шаблон create-vite кладёт `tsconfig.json` (тонкий, только `references`) и `tsconfig.app.json` (компилер-опции для приложения). Нам нужно добавить path-алиас `@/*` → `./src/*` в **оба** файла — это требование shadcn/ui (см. https://ui.shadcn.com/docs/installation/vite), без него `import { Button } from '@/components/ui/button'` потом не зарезолвится.

В `apps/web/tsconfig.json` добавь блок `compilerOptions` рядом с существующим `references`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

В `apps/web/tsconfig.app.json` точечно добавь `paths` внутрь существующего `compilerOptions` — **не заменяй файл целиком**, остальные опции шаблона (`target`, `lib`, `jsx`, `verbatimModuleSyntax`, и т.д.) нужны Vite/React:

```json
"paths": {
  "@/*": ["./src/*"]
}
```

> Заметь: у современных шаблонов create-vite приезжает TypeScript 6+, а в TS 6 опция `baseUrl` помечена как deprecated и сломается в TS 7. Документация shadcn/ui всё ещё показывает `baseUrl: "."` рядом с `paths`, но он больше не нужен — с TS 5+ `paths` резолвятся относительно tsconfig автоматически. **Не добавляй `baseUrl`** — `pnpm typecheck` упадёт с `error TS5101: Option 'baseUrl' is deprecated`.

Теперь установи зависимости из **корня** репозитория, чтобы workspace подцепил `@delivery/web`:

```bash
cd ../..
pnpm install
pnpm list -r --depth -1   # должно появиться 6 проектов вместо 5
```

**Smoke test**:

```bash
pnpm dev:web
# открой http://localhost:5173 — должен быть стандартный Vite welcome (логи Vite + React)
# либо: curl -sf http://localhost:5173 | grep '<div id="root">'
```

Дополнительно проверь, что typecheck зелёный для всех 5 пакетов с TS-кодом (`tsconfig`-пакет пропускается, у него нет скрипта):

```bash
pnpm -r typecheck
```

### 6.2 Tailwind CSS v4 (см. https://tailwindcss.com/docs/installation/using-vite)

Из корня репозитория:

```bash
pnpm --filter @delivery/web add tailwindcss @tailwindcss/vite
```

> RUNBOOK раньше предлагал ещё `pnpm add -D @types/node` — это лишний шаг: шаблон `create-vite` ставит `@types/node` автоматически.
>
> Native-пакет Tailwind 4 (`@tailwindcss/oxide-<platform>`) приезжает как prebuilt-binary через `optionalDependencies`, postinstall-сборка не запускается, в `pnpm.onlyBuiltDependencies` его добавлять не нужно.

Замени `apps/web/vite.config.ts`:

```ts
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

Замени всё содержимое `apps/web/src/index.css` на одну строку:

```css
@import "tailwindcss";
```

Это всё. Никаких `@tailwind base/components/utilities`, никакого `tailwind.config.js` — это специфика v4.

**Smoke test** — два варианта.

Визуальный: в `App.tsx` поставь `<div className="text-3xl font-bold underline">Hello</div>` и убедись в браузере, что стили применились.

Автоматический (без правки `App.tsx`) — проверь, что Vite-плагин Tailwind компилирует `index.css`:

```bash
pnpm dev:web &           # запусти в фоне
sleep 3 && curl -s http://localhost:5173/src/index.css | grep -E 'tailwindcss v4|@layer (theme|base|utilities)' | head
# должно вернуть строки с заголовком и слоями v4
```

Дополнительно — проверь JIT, временно вставив `<div className="text-3xl font-bold underline">x</div>` в любой компонент, и `curl` снова. В CSS должны появиться правила `.text-3xl`, `.font-bold`, `.underline` плюс CSS-переменные `--text-3xl`, `--font-weight-bold` в `@layer theme`. После проверки — откати правку, не оставляй смоук-маркер в коде.

### 6.3 shadcn/ui (см. https://ui.shadcn.com/docs/installation/vite)

Из `apps/web/`:

```bash
pnpm dlx shadcn@latest init -d
```

Флаг `-d` (defaults) пропускает интерактивные вопросы. Современный shadcn 4.x на Tailwind v4 проекте создаст:

- `components.json` (style: `base-nova` — это новый дефолт вместо `new-york`, baseColor: `neutral`)
- `src/lib/utils.ts` (хелпер `cn` поверх `clsx + tailwind-merge`)
- `src/components/ui/button.tsx` — **уже создаётся при init** для Tailwind v4 проектов; отдельный `pnpm dlx shadcn@latest add button` запускать не нужно
- Обновлённый `src/index.css` — добавляются `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `@import "@fontsource-variable/geist"`, `@theme inline { ... }`, `:root/.dark` с oklch-токенами, `@layer base`

В `apps/web/package.json` подъедут зависимости: `@base-ui/react` (база компонентов; shadcn 4.x использует Base UI вместо Radix), `class-variance-authority`, `clsx`, `lucide-react@^1`, `tailwind-merge`, `tw-animate-css`, `@fontsource-variable/geist`, и сам `shadcn` CLI.

**Перенеси `shadcn` из `dependencies` в `devDependencies`** — это CLI, в production-бандле ему не место:

```bash
pnpm --filter @delivery/web remove shadcn
pnpm --filter @delivery/web add -D shadcn
```

**Добавь `msw` в `pnpm.onlyBuiltDependencies`** в корневом `package.json` — его транзитивно тянет `shadcn` (для оффлайн-моков registry), и без allow-list `pnpm install` будет жаловаться `Ignored build scripts: msw`:

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "esbuild",
    "msw"
  ]
}
```

Замени `apps/web/src/App.tsx` минимальным примером — все шаблонные импорты (`reactLogo`, `viteLogo`, `App.css`) больше не нужны:

```tsx
import { Button } from '@/components/ui/button'

function App() {
  return (
    <div className="p-8">
      <Button>Click me</Button>
    </div>
  )
}

export default App
```

**Smoke test** — два варианта.

Визуальный: `pnpm dev:web`, открой `http://localhost:5173`, кнопка должна отрендериться в shadcn-стиле (закруглённые углы, primary background, hover-эффект).

Headless — проверь, что Vite корректно резолвит alias и shadcn-токены попали в CSS:

```bash
pnpm dev:web &
sleep 3

# button.tsx через alias @/lib/utils → /src/lib/utils.ts
curl -sf http://localhost:5173/src/components/ui/button.tsx | grep -E '@base-ui_react|class-variance-authority|/src/lib/utils'

# shadcn-классы и CSS-токены в скомпилированном CSS
curl -s http://localhost:5173/src/index.css \
  | grep -oE '(\.bg-primary[^,;{ ]*|\.text-primary-foreground|--primary:|--primary-foreground:)' \
  | sort -u
# должно вывести 4 строки: --primary:, --primary-foreground:, .bg-primary, .text-primary-foreground
```

### 6.4 TanStack Router + file-based routing (см. https://tanstack.com/router/latest/docs/installation/with-vite)

```bash
pnpm add @tanstack/react-router @tanstack/react-router-devtools
pnpm add -D @tanstack/router-plugin
```

Обнови `vite.config.ts` — **порядок плагинов важен**, router-plugin должен быть **до** React:

```ts
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

Создай файловую структуру роутов:

```
apps/web/src/
├── routes/
│   ├── __root.tsx
│   ├── index.tsx            # /
│   ├── admin/
│   │   ├── route.tsx        # /admin (layout)
│   │   └── index.tsx        # /admin
│   └── s.$hash.tsx          # /s/:hash
└── main.tsx
```

`src/routes/__root.tsx` (см. quickstart в доке):

```tsx
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

export const Route = createRootRoute({
  component: () => (
    <>
      <nav className="p-4 flex gap-4 border-b">
        <Link to="/" className="[&.active]:font-bold">Home</Link>
        <Link to="/admin" className="[&.active]:font-bold">Admin</Link>
      </nav>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})
```

`src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => <div className="p-4">Home</div>,
})
```

`src/routes/admin/route.tsx`:

```tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/admin')({
  component: () => (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Admin</h1>
      <Outlet />
    </div>
  ),
})
```

`src/routes/admin/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({
  component: () => <div>Dashboard placeholder</div>,
})
```

`src/routes/s.$hash.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/s/$hash')({
  component: () => {
    const { hash } = Route.useParams()
    return <div className="p-4">Tracking: {hash}</div>
  },
})
```

Замени `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
```

`src/App.tsx` теперь не используется — можешь удалить.

Добавь в корневой `.gitignore` сгенерированный файл (TanStack рекомендует не комитить):

```
**/routeTree.gen.ts
```

И в `.vscode/settings.json` (по рекомендации доки — чтобы IDE не открывала его как обычный файл):

```json
{
  "files.readonlyInclude": { "**/routeTree.gen.ts": true },
  "files.watcherExclude": { "**/routeTree.gen.ts": true },
  "search.exclude": { "**/routeTree.gen.ts": true }
}
```

**Smoke test**: `pnpm dev`, перейди по `/`, `/admin`, `/s/abc123`. Все три должны рендериться, навигация — работать. Файл `routeTree.gen.ts` появился сам.

### 6.5 TanStack Query

```bash
pnpm add @tanstack/react-query
pnpm add -D @tanstack/react-query-devtools
```

Обнови `src/main.tsx` — оборачиваем `RouterProvider` в `QueryClientProvider`:

```tsx
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { routeTree } from './routeTree.gen'
import './index.css'

const queryClient = new QueryClient()
const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
```

Тебе ещё нужно обновить `__root.tsx`, чтобы он принял типизированный context:

```tsx
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, ... } from '@tanstack/react-router'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (/* ... */),
})
```

### 6.6 Подключи `@delivery/schemas`

```bash
pnpm add "@delivery/schemas@workspace:*"
```

Тестовый запрос на API через Query — добавь в `src/routes/admin/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrandPublicSchema } from '@delivery/schemas'
import { z } from 'zod'

const BrandsArraySchema = z.array(BrandPublicSchema)

export const Route = createFileRoute('/admin/')({
  component: AdminIndex,
})

function AdminIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3000/brands')
      return BrandsArraySchema.parse(await r.json())
    },
  })

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {String(error)}</div>
  return (
    <ul>
      {data?.map((b) => <li key={b.id}>{b.name}</li>)}
    </ul>
  )
}
```

Понадобится CORS на бэке — добавь в `apps/api/src/index.ts`:

```ts
import { cors } from 'hono/cors'
// ...
app.use('*', cors({ origin: 'http://localhost:5173' }))
```

**Smoke test**: запусти оба (`pnpm dev:api` и `pnpm dev:web` в двух терминалах), открой `/admin`. Должна рисоваться пустая `<ul>` (брендов в БД ещё нет), без ошибок в консоли. Это подтверждает, что end-to-end типизация через `@delivery/schemas` работает.

`cd ../..` обратно в корень.

---

## Phase 7 — Infra-скелет

Не разворачиваем сейчас, но кладём заготовки, чтобы потом не структурировать с нуля.

```bash
mkdir -p infra
```

`infra/Caddyfile` — копируй из `ARCHITECTURE.md` (раздел Caddyfile production).

`infra/compose.prod.yml` — тоже из `ARCHITECTURE.md`.

`.env.production` (НЕ комитим — добавь в `.gitignore`):

```
APP_DOMAIN=tracker.example.com
ADMIN_DOMAIN=admin.example.com
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgres://delivery:change-me@postgres:5432/delivery_tracker
JWT_SECRET=change-me-long-random-secret
MAPBOX_TOKEN=your-mapbox-token
```

`Dockerfile` для `apps/api` и `apps/web` оставляем на потом — для локальной разработки они не нужны, добавишь перед первым деплоем.

---

## Phase 8 — Финальная проверка

Из корня:

```bash
pnpm install              # должен пройти чисто
pnpm typecheck            # все пакеты должны пройти
pnpm dev:api &            # терминал 1
pnpm dev:web &            # терминал 2
docker compose ps         # postgres up
```

Открой:
- http://localhost:3000/health → `{"ok":true}`
- http://localhost:3000/brands → `[]`
- http://localhost:5173 → Home рендерится
- http://localhost:5173/admin → пустой `<ul>`, никаких ошибок в консоли

Если все четыре — работает, scaffold готов.

---

## Дальше

Закоммитти baseline:

```bash
git add .
git commit -m "chore: initial scaffold (api + web + schemas + simulation)"
```

Дальше можно начинать прикладную работу:
1. **DB-схема** — расширить `apps/api/src/db/schema.ts` остальными таблицами из ARCHITECTURE.md (cargo, trips, uploads), сгенерить миграцию.
2. **Tenant middleware** — резолвер бренда по `Host`-заголовку в `apps/api/src/middleware/tenant.ts`.
3. **Storage абстракция** — `apps/api/src/storage/{types,local}.ts`.
4. **HOS-симулятор** — реализация `packages/simulation/src/generate.ts` поверх Mapbox Directions.
5. **Админка** — формы создания поездки в `src/routes/admin/`.
6. **Share-страница** — карта на MapLibre + интерполятор в `src/routes/s.$hash.tsx`.

Каждый пункт — отдельная сессия. Не пытайся делать всё за раз.

---

## Troubleshooting

**`No projects matched the filters`**
pnpm не видит пакет как часть workspace. Две причины: (1) в корне нет `pnpm-workspace.yaml` или в нём опечатка в путях, (2) ты переименовал пакет в `package.json`, но не запустил `pnpm install` из корня — workspace-симлинки нужно пересобрать. Решение: `cd` в корень репозитория, `pnpm install`, потом `pnpm list -r --depth -1` чтобы убедиться, что пакет виден.

**`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "X" not found`**
В pnpm 10 голый `pnpm <script>` ищет скрипт во **всех** workspace-пакетах сразу и падает, если где-то его нет. Используй `pnpm run <script>` (выполняет в текущей папке) или `pnpm --filter <pkg> <script>` (адресно).

**`zsh: no matches found: @delivery/...@workspace:*`**
zsh пытается раскрыть `*` как glob-паттерн до того, как аргумент попадёт в pnpm. Заверни весь аргумент в кавычки: `pnpm add "@delivery/foo@workspace:*"`. Bash так не делает, но в zsh (по умолчанию в macOS) это обязательно для любых аргументов с `*`, `?`, `[`, `~`.

**`pnpm install` ругается на peer deps**
В корневом `.npmrc` должен быть `auto-install-peers=true`. Если уже стоит — сделай `pnpm install --force`.

**`Ignored build scripts: <pkg>` при `pnpm add` / `pnpm install`**
pnpm 10 по умолчанию блокирует postinstall-скрипты любых пакетов. Для нативных бинарей (`esbuild`, `@tailwindcss/oxide`, `better-sqlite3`, и т.д.) их нужно явно разрешить — допиши пакет в `pnpm.onlyBuiltDependencies` в **корневом** `package.json` и запусти `pnpm install` (а если пакет уже стоит — `pnpm rebuild <pkg>`).

**`pnpm dev:api` падает с `sh: tsx: command not found`**
Ты затёр `dependencies`/`devDependencies` в `apps/api/package.json` при правке. Шаблон `create-hono` ставит `hono`, `@hono/node-server`, `tsx`, `typescript`, `@types/node` — их нужно сохранить. Восстанови:
```bash
pnpm --filter @delivery/api add hono @hono/node-server
pnpm --filter @delivery/api add -D tsx typescript @types/node
```

**`pnpm dev` в корне репозитория: `Missing script: dev`**
В корневом `package.json` намеренно нет скрипта `dev` — есть `dev:api` и `dev:web` отдельно. Используй их (`pnpm dev:api`) или запускай dev из конкретного приложения (`pnpm --filter @delivery/api dev`).

**TypeScript не находит `@delivery/schemas`**
Из корня `pnpm install`. pnpm создаст симлинк автоматически. Перезапусти TS-server в IDE.

**Drizzle migrate падает на `connection refused`**
Проверь `docker compose ps` — Postgres up? Проверь `.env` — порт 5432 совпадает с маппингом в compose?

**Postgres-контейнер в restart-петле, в логах `Error: in 18+, these Docker images are configured to store database data in...`**
Volume смонтирован в `/var/lib/postgresql/data` — старая конвенция, не работает с `postgres:18+`. Поправь `docker-compose.yml`: маунт должен быть в `/var/lib/postgresql` (без `/data`). Если volume уже создан по старому пути и пуст — удали его и пересоздай:
```bash
docker compose down -v
docker compose up -d
```
Если в volume уже есть данные — их нужно сначала забекапить через `pg_dump`, потому что старый layout с 18+ несовместим.

**TanStack Router: `routeTree.gen.ts` не генерится**
Проверь порядок плагинов в `vite.config.ts` — `tanstackRouter()` **до** `react()`. Перезапусти dev-сервер.

**shadcn add падает**
Проверь `components.json` — был создан корректно? `tsconfig.app.json` содержит `paths: { "@/*": ["./src/*"] }`?

**Tailwind-классы не применяются**
В `index.css` должно быть ровно `@import "tailwindcss";` и **ничего** из старого синтаксиса v3 (`@tailwind base` и т.д.). Vite-плагин `@tailwindcss/vite` подключён в `vite.config.ts`?
