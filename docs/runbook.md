# Delivery Tracker — Runbook

## Local dev setup

**Требования:** Node 24, pnpm 10, Docker.

```bash
# Проверить версии
node --version          # v24.x
pnpm --version          # 10.x
docker compose version
```

Если pnpm не установлен:
```bash
corepack enable && corepack prepare pnpm@latest --activate
```

**Установка:**

```bash
git clone <repo>
cd delivery-tracker-v2
pnpm install
```

**Переменные окружения** — создай `apps/api/.env`:

```
DATABASE_URL=postgres://delivery:delivery@localhost:5432/delivery_tracker
JWT_SECRET=dev-secret-change-in-prod
MAPBOX_TOKEN=your-mapbox-token
```

**Запуск:**

```bash
docker compose up -d                           # Postgres
pnpm --filter @delivery/api db:migrate         # Применить миграции
```

Два терминала:
```bash
pnpm dev:api    # порт 3000
pnpm dev:web    # порт 5173
```

---

## Smoke test

```bash
# API health
curl -s http://localhost:3000/health
# → {"ok":true}

# TypeScript
pnpm typecheck

# Postgres connection
curl -s http://localhost:3000/brands
# → [] (пустой массив, не ошибка)

# CORS round-trip
node --input-type=module -e "
const r = await fetch('http://localhost:3000/brands', { headers: { Origin: 'http://localhost:5173' } });
console.log('status=' + r.status, 'cors=' + r.headers.get('access-control-allow-origin'));
"
# → status=200 cors=http://localhost:5173
```

---

## Production deploy

Деплой через docker context на удалённый сервер. Текущая процедура — в beads-памяти (`bd memories deploy`).

Переменные `.env.production`:

| Переменная | Описание |
|---|---|
| `ADMIN_DOMAIN` | Домен админки (A-record → IP VPS) |
| `APP_DOMAIN` | Базовый домен share-страниц |
| `POSTGRES_PASSWORD` | Пароль postgres |
| `DATABASE_URL` | `postgresql://delivery:<pass>@postgres:5432/delivery_tracker` |
| `JWT_SECRET` | 32+ байта hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MAPBOX_TOKEN` | Серверный токен Mapbox |

Health check после деплоя:
```bash
curl https://<ADMIN_DOMAIN>/api/health   # → {"ok":true}
```

---

## Troubleshooting

**`No projects matched the filters`**
pnpm не видит пакет как часть workspace. Проверь `pnpm-workspace.yaml` и запусти `pnpm install` из корня.

**`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "X" not found`**
В pnpm 10 голый `pnpm <script>` ищет скрипт во всех workspace-пакетах. Используй `pnpm run <script>` (текущая папка) или `pnpm --filter <pkg> <script>`.

**`zsh: no matches found: @delivery/...@workspace:*`**
zsh раскрывает `*` как glob. Заверни в кавычки: `pnpm add "@delivery/foo@workspace:*"`.

**`pnpm install` ругается на peer deps**
В корневом `.npmrc` должен быть `auto-install-peers=true`. Или: `pnpm install --force`.

**`Ignored build scripts: <pkg>`**
pnpm 10 блокирует postinstall-скрипты. Допиши пакет в `pnpm.onlyBuiltDependencies` в корневом `package.json`, потом `pnpm install` (или `pnpm rebuild <pkg>` если уже стоит).

**`pnpm dev:api` падает с `sh: tsx: command not found`**
Восстанови зависимости:
```bash
pnpm --filter @delivery/api add hono @hono/node-server
pnpm --filter @delivery/api add -D tsx typescript @types/node
```

**`Missing script: dev` в корне**
Скриптов `dev` нет — только `dev:api` и `dev:web`. Используй их явно.

**TypeScript не находит `@delivery/schemas`**
`pnpm install` из корня пересоздаст симлинки. Перезапусти TS-server в IDE.

**Drizzle migrate падает на `connection refused`**
Проверь `docker compose ps` — Postgres up? Проверь `DATABASE_URL` в `.env`.

**Postgres в restart-петле: `Error: in 18+, these Docker images are configured to store data in...`**
Volume смонтирован в `/var/lib/postgresql/data` — для postgres:18+ нужно `/var/lib/postgresql` (без `/data`). Исправь в `docker-compose.yml`, потом:
```bash
docker compose down -v && docker compose up -d
```
Если в volume есть данные — сначала `pg_dump`.

**TanStack Router: `routeTree.gen.ts` не генерится**
В `vite.config.ts` плагин `tanstackRouter()` должен быть **до** `react()`. Перезапусти dev-сервер.

**shadcn add падает**
Проверь `components.json` и `paths: { "@/*": ["./src/*"] }` в `tsconfig.app.json`.

**Tailwind-классы не применяются**
В `index.css` должно быть `@import "tailwindcss";` и ничего из синтаксиса v3. Плагин `@tailwindcss/vite` подключён в `vite.config.ts`?
