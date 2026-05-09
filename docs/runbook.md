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
- **В репо, не применено на проде** (этот PR): `0007_new_ben_parker`, `0008_careless_sunspot`, `0009_familiar_azazel`, `0010_smart_vertigo`, `0011_brown_solo`.
- Отдельный stacked PR (`app/tenant-aware-share-and-helpers`) добавит `0012_powerful_gertrude_yorkes` поверх — это **другое релиз-окно** (см. ниже).

### Релиз-окна

Применение разделено на два окна. Их нельзя смешивать в один проход `db:migrate`, потому что у них разные требования к доступности API.

| Окно | Pending миграции | Требует ли API down | Источник кода |
|---|---|---|---|
| **A** | `0007 → 0011` | **Да** (из-за 0007) | этот PR (`db/schema-hardening-0008-0011`) |
| **B** | `0012` | Нет (additive) | PR `app/tenant-aware-share-and-helpers` + новый app-код |

#### Правило: когда нужна остановка API

> **API DOWN тогда и только тогда, когда в pending set присутствует `0007`.**
> `0007` содержит `DELETE FROM uploads WHERE brand_id IS NULL` и `ALTER COLUMN brand_id SET NOT NULL` на `uploads`. Live-INSERT в `uploads` во время apply упадёт на constraint violation.
>
> `0008–0012` сами по себе additive — не требуют остановки. Но если оператор запускает `db:migrate` с `0007` ещё в pending, то ВЕСЬ проход (включая 0008–0011, идущие в одной серии вызовов drizzle) проходит при остановленном API.
>
> Перед каждым релизом: посмотри `SELECT max(id) FROM drizzle.__drizzle_migrations` и сверь с `apps/api/src/db/migrations/`. Если в diff есть `0007` — окно A. Иначе — окно B (или пустое).

---

### Окно A: apply 0007 → 0011 (maintenance window, API down)

**Hard blockers — pre-flight, read-only.** Любая ненулевая строка в любом из запросов = СТОП, миграция упадёт в середине apply.

```bash
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker <<'SQL'
-- Подтвердить migration head = 0006 (id=7). Если ≥ 8 — часть уже применена, скорректировать план.
SELECT max(id) AS prod_migration_id FROM drizzle.__drizzle_migrations;        -- expect 7

-- BLOCKER 1 (0007): orphan uploads, которые миграция удалит. Если > 0 — подтвердить с владельцем данных.
SELECT count(*) AS orphan_uploads_will_be_deleted
  FROM uploads u
 WHERE NOT EXISTS (SELECT 1 FROM cargo c WHERE u.id = ANY(c.photo_upload_ids)); -- expect 0

-- BLOCKER 2 (0010): cargo.fields должны быть object, не NULL, ≤ 16KB.
SELECT count(*) AS cargo_fields_violations
  FROM cargo
 WHERE fields IS NULL
    OR jsonb_typeof(fields) <> 'object'
    OR octet_length(fields::text) > 16384;                                     -- expect 0

-- BLOCKER 3 (0011): дубликаты по lower(share_domain) в brands.
SELECT lower(share_domain), count(*) FROM brands
 WHERE share_domain IS NOT NULL GROUP BY 1 HAVING count(*) > 1;                -- expect 0 rows

-- Информационно: текущие counts, чтобы сверить после apply.
SELECT
  (SELECT count(*) FROM brands)  AS brands,
  (SELECT count(*) FROM cargo)   AS cargo,
  (SELECT count(*) FROM trips)   AS trips,
  (SELECT count(*) FROM uploads) AS uploads;
SQL
```

**Apply.**

```bash
# 1. Backup ДО apply (обязателен — 0007 необратима через DDL)
mkdir -p ~/delivery-prod-backups
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  pg_dump -U delivery -d delivery_tracker --format=custom \
  > ~/delivery-prod-backups/$(date +%Y%m%d-%H%M)-pre-tenant-hardening.dump
ls -lh ~/delivery-prod-backups/   # подтвердить что dump создан и не пустой

# 2. Остановить API (обязательно — в pending есть 0007)
docker --context delivery-prod stop delivery-tracker-v2-api-1

# 3. Применить миграции (через одноразовый запуск контейнера или start/exec/stop)
docker --context delivery-prod start delivery-tracker-v2-api-1
docker --context delivery-prod exec delivery-tracker-v2-api-1 \
  pnpm --filter @delivery/api db:migrate
# Ожидаемо: applied 0007, 0008, 0009, 0010, 0011

# 4. Поднять API (новый образ из этого PR — он проставляет brand_id при upload,
#    см. ручки upload в apps/api/src/routes/admin.ts)
docker --context delivery-prod restart delivery-tracker-v2-api-1
```

**Post-apply verification.**

```bash
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker <<'SQL'
-- Migration head после apply
SELECT max(id) AS applied_head FROM drizzle.__drizzle_migrations;             -- expect 12

-- Все требуемые индексы (валидные)
SELECT i.relname AS indexname, ix.indisvalid
  FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
                   JOIN pg_class t ON t.oid = ix.indrelid
 WHERE t.relname IN ('brands','cargo','trips','uploads')
   AND i.relname IN ('brands_owner_id_idx','brands_share_domain_lower_idx',
                     'cargo_brand_id_idx','trips_brand_id_idx',
                     'uploads_brand_id_idx');                                  -- 5 строк, все indisvalid=true

-- uploads tenant-scoped (0007)
SELECT count(*) AS uploads_without_brand_id FROM uploads WHERE brand_id IS NULL; -- 0
SELECT conname FROM pg_constraint
 WHERE conrelid='uploads'::regclass
   AND conname IN ('uploads_brand_storage_key_unique','uploads_storage_key_unique');
-- ожидаем: только uploads_brand_storage_key_unique (старый single-column unique удалён)

-- 0009: колонка добавлена
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name='trips' AND column_name='total_distance_meters';            -- 1 строка, YES

-- 0010: CHECK активна и не нарушена
SELECT conname FROM pg_constraint
 WHERE conrelid='cargo'::regclass AND conname='cargo_fields_object_and_bounded'; -- 1 строка
SELECT count(*) AS check_violations FROM cargo
 WHERE NOT (fields IS NOT NULL
        AND jsonb_typeof(fields)='object'
        AND octet_length(fields::text) <= 16384);                              -- 0

-- 0011: expression unique index валидный
SELECT i.relname, ix.indisvalid, ix.indisunique
  FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid
                   JOIN pg_class t ON t.oid=ix.indrelid
 WHERE t.relname='brands' AND i.relname='brands_share_domain_lower_idx';      -- 1 строка, true/true
SQL

# Smoke API после рестарта
curl -s https://<ADMIN_DOMAIN>/api/health           # → {"ok":true}
```

---

### Окно B: apply 0012 (additive, без остановки API)

Уезжает в **отдельном релизе** вместе с app-кодовым tenant-aware Host→brand→trip share resolver (PR `app/tenant-aware-share-and-helpers`). Не применять, пока тот PR не смержен и образ с новым `share.ts` не задеплоен.

`0012` добавляет compound `UNIQUE(brand_id, share_hash)` на `trips`. Constraint сосуществует с глобальным `trips_share_hash_unique` — оба валидны, не конфликтуют. Глобальный остаётся до 0013 (destructive cleanup, отложен ещё на одно релиз-окно).

Полный pre-flight / apply / post-apply будут в runbook'е PR `app/tenant-aware-share-and-helpers`. Краткая суть: `ACCESS EXCLUSIVE` на `trips` коротко, hard-blocker — отсутствие дубликатов `(brand_id, share_hash)` в `trips`, post-apply — `max(id)=13` и наличие `trips_brand_share_hash_unique`.

---

### Rollback

| Миграция | Обратима через DDL | Стратегия |
|---|---|---|
| 0007 | **Нет** (DELETE orphans + SET NOT NULL коммитятся в одной транзакции) | `pg_restore` из dump'а шага 1 окна A |
| 0008 | Да | `DROP INDEX IF EXISTS brands_owner_id_idx, cargo_brand_id_idx, trips_brand_id_idx;` |
| 0009 | Да (потеря записанных значений) | `ALTER TABLE trips DROP COLUMN total_distance_meters;` |
| 0010 | Да | `ALTER TABLE cargo DROP CONSTRAINT cargo_fields_object_and_bounded;` |
| 0011 | Да | `DROP INDEX IF EXISTS brands_share_domain_lower_idx;` |

**Граница безопасного abort'а.** До коммита транзакции `0007` (включая её внутренний DELETE) — abort бесплатен. После — restore из dump'а единственный надёжный путь назад. `0008–0011` откатываются точечным DDL в любой момент.

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
