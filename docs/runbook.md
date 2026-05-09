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

## Database migrations on production

Применяются через `pnpm db:migrate` внутри API-контейнера. Drizzle применяет файлы строго в алфавитном порядке, по одной транзакции на файл, и помечает успешные apply'ы в `drizzle.__drizzle_migrations`.

### Перед каждым релизом — проверь migration head

```bash
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker \
  -c "SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;"
```

`id N` соответствует файлу `000{N-1}_*.sql` (drizzle нумерует с 0). Сверь с `apps/api/src/db/migrations/` в коммите, который собираешься деплоить.

### Текущее состояние (2026-05-09)

- **Prod head**: `0006_clever_cannonball` (id=7 в `__drizzle_migrations`).
- **В репо лежит** (не применено на проде): `0007_new_ben_parker`.
- При следующем `pnpm db:migrate` оператор увидит applied: `0007 → 0008 → ...` за один проход.

### Schema-only release: 0007 + 0008–0011

Эти 5 миграций — **только additive** (нет destructive cleanup). Безопасны без app-кодовых изменений: новые индексы / колонки / CHECK не ломают старые запросы.

```bash
# 1. Pre-flight (read-only) — обязательно ДО apply
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker <<'SQL'
-- Подтвердить migration head = 0006
SELECT max(id) AS prod_migration_id FROM drizzle.__drizzle_migrations;  -- expect 7

-- Подтвердить чистый стейт под 0010 (cargo.fields CHECK)
SELECT count(*) AS oversized FROM cargo WHERE octet_length(fields::text) > 16384;     -- 0
SELECT count(*) AS not_object
  FROM cargo WHERE fields IS NULL OR jsonb_typeof(fields) <> 'object';                 -- 0

-- Подтвердить чистый стейт под 0011 (brands_share_domain_lower_idx)
SELECT lower(share_domain), count(*) FROM brands
 WHERE share_domain IS NOT NULL GROUP BY 1 HAVING count(*) > 1;                        -- 0 rows
SQL

# 2. Backup ДО применения миграций
mkdir -p ~/delivery-prod-backups
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  pg_dump -U delivery -d delivery_tracker --format=custom \
  > ~/delivery-prod-backups/$(date +%Y%m%d-%H%M)-pre-tenant-hardening.dump

# 3. Apply миграций (внутри API-контейнера, обычным db:migrate)
docker --context delivery-prod exec delivery-tracker-v2-api-1 \
  pnpm --filter @delivery/api db:migrate
# Ожидаемо: applied 0007, 0008, 0009, 0010, 0011

# 4. Post-apply verification
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker <<'SQL'
-- Все требуемые индексы
SELECT tablename, indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename IN ('brands','cargo','trips','uploads')
 ORDER BY 1,2;
-- ожидаем (помимо PK): brands_owner_id_idx, brands_share_domain_lower_idx,
-- cargo_brand_id_idx, trips_brand_id_idx, uploads_brand_id_idx,
-- uploads_brand_storage_key_unique

-- uploads tenant-scoped (0007)
SELECT count(*) FROM uploads WHERE brand_id IS NULL;  -- 0

-- cargo CHECK активна (0010)
SELECT conname FROM pg_constraint
 WHERE conrelid='cargo'::regclass AND conname='cargo_fields_object_and_bounded';
-- 1 строка

-- Migration head = 0011
SELECT max(id) FROM drizzle.__drizzle_migrations;  -- expect 12
SQL
```

### Что НЕ ходит в schema PR

- **0012 (compound `(brand_id, share_hash)` UNIQUE)** и **0013 (drop global share_hash unique + drop `trips_share_hash_idx`)** — оба destructive относительно DB-инвариантов. Должны идти ПОСЛЕ деплоя app-кода с tenant-aware Host→brand→trip resolver. Подробнее — `docs/adr/` (когда заведётся).

### Rollback

Все 5 миграций (0007–0011) — additive. Rollback выполняется через restore из бэкапа `pg_dump` (см. шаг 2). Альтернатива — точечный rollback DDL (см. комментарии в каждом `.sql`).

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
