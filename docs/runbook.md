# Delivery Tracker — Runbook

## Local dev setup

**Требования:** Node 24, pnpm 11, Docker.

```bash
# Проверить версии
node --version          # v24.x
pnpm --version          # 11.x
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

Полный список переменных — `apps/api/.env.example`.

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

# Postgres connection + auth-стек (401 = API жив и дошёл до auth-проверки)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/brands
# → 401

# CORS round-trip
node --input-type=module -e "
const r = await fetch('http://localhost:3000/health', { headers: { Origin: 'http://localhost:5173' } });
console.log('status=' + r.status, 'cors=' + r.headers.get('access-control-allow-origin'));
"
# → status=200 cors=http://localhost:5173
```

---

## Production deploy

> **Это единственный источник правды по деплою.** Никаких отсылок к памяти/другим докам — всё ниже.

### Автоматический деплой (основной путь, CI/CD)

Push/merge в `main` → GitHub Actions `build.yml` собирает образы api+web и пушит в `ghcr.io/trudogolik45/delivery-tracker-v2/{api,web}:<sha>` (auth = встроенный `GITHUB_TOKEN`, без PAT). По успешной сборке `deploy.yml` по ssh шипает `infra/` + `bin/deploy` на VPS и запускает `bin/deploy <sha>`:

1. pull образов `<sha>`;
2. **migration-gate**: additive-миграции применяются автоматически (`drizzle-kit migrate` в one-off контейнере нового образа, до смены кода); деструктивные (`DROP`/`ALTER COLUMN`/`DELETE`/`SET NOT NULL`) → **abort** с требованием ручного окна (см. «Database migrations»);
3. `docker rollout` api, затем web — health-gated (новый контейнер поднимается рядом, ждём healthcheck, держим старый ещё 5с для переразрешения DNS Caddy, потом убираем) → **без простоя**;
4. проверка `GET /api/version == <sha>`;
5. при фейле — rollback на последний рабочий тег (`.last_good_tag`).

Рантайм-секреты живут в `/root/delivery-tracker-v2/.env.production` **на VPS** и не попадают в GitHub. ghcr-pull на VPS — эфемерным `GITHUB_TOKEN` по ssh (постоянного PAT нет). Требуемые repo-secrets: `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`. На VPS установлен cli-плагин `docker rollout` (`~/.docker/cli-plugins/`).

Ручной запуск: `gh workflow run deploy.yml -f sha=<full-sha>` (образ должен быть уже собран `build.yml`), либо на VPS `cd /root/delivery-tracker-v2 && bin/deploy <sha>`. Проверка гейта без изменений: `bin/deploy <sha> --check`.

### Проверка фичи против прода (read-only, без создания данных)

`POST /api/admin/b/<brandSlug>/trips/preview` считает timeline по реальному Mapbox-маршруту и **не создаёт** поездку (dry-run) — годится для smoke-проверки фичи на боевом после деплоя. Прод-креды админа лежат в `.env.production` (`LOGIN`/`PASS`), боевой бренд — `cgfarmequip`. Пример (подтверждает 5-часовой `service_stop` на каждой промежуточной точке):

```bash
DOMAIN=$(grep '^ADMIN_DOMAIN=' .env.production | cut -d= -f2- | tr -d '"')
curl -fsS -c /tmp/cj -X POST "https://$DOMAIN/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"<LOGIN>","password":"<PASS>"}'
curl -fsS -b /tmp/cj -X POST "https://$DOMAIN/api/admin/b/cgfarmequip/trips/preview" \
  -H 'Content-Type: application/json' \
  -d '{"origin":{"lat":34.05,"lng":-118.24},"destination":{"lat":32.78,"lng":-96.80},
       "waypoints":[{"lat":33.45,"lng":-112.07},{"lat":35.08,"lng":-106.65}],
       "startedAt":1750000000,"desiredArrival":1750864000}'
# в ответе trip.segments: rest reason=service_stop, tEnd-tStart=18000 на atDist промежуточных точек
```

### Ручной деплой (fallback, build-on-server)

Если CI/CD недоступен — деплой с локальной машины на VPS через Docker Context `delivery-prod` (`ssh://root@193.23.201.57`). Образы собираются из текущего рабочего дерева; пересоздаются **только** контейнеры `api` и `web` — `postgres` и `caddy` не трогаются.

Имя compose-проекта `delivery-tracker-v2` зашито в `infra/compose.prod.yml` (поле `name:`), поэтому флаг `-p` нигде указывать не нужно. `--project-directory .` обязателен — build context = корень репо.

### Команды (определены в `package.json`)

| Команда | Действие |
|---|---|
| `pnpm deploy:prod` | rebuild api+web → `up -d --no-deps --force-recreate api web` |
| `pnpm db:migrate:prod` | `drizzle-kit migrate` внутри api-контейнера (только при наличии pending-миграций) |
| `pnpm logs:prod` | `logs -f` по прод-стеку |

### Процедура

```bash
# 1. Если в diff против прода есть НОВЫЕ миграции — сверь migration head
#    (см. «Database migrations on production»). Деструктивные миграции = отдельное окно.
# 2. Деплой кода
pnpm deploy:prod
# 3. Миграции — ТОЛЬКО если есть pending
pnpm db:migrate:prod
# 4. Health-check
curl -fsS https://$ADMIN_DOMAIN/api/health      # → {"ok":true}
# 5. Логи (опц.)
docker --context delivery-prod logs --tail 30 delivery-tracker-v2-api-1
```

### Rollback

`git checkout <prev-sha>` → повтори `pnpm deploy:prod` (ребилд из старого дерева — минуты, не секунды). Откат миграций — таблица в конце раздела «Database migrations on production».

### Грабли (проверено в бою)

- **`name:` в compose обязателен.** Без него имя проекта = basename папки репо → compose поднимет пустой дубликат стека мимо живого.
- **pnpm 11 + `pnpm deploy`.** `deploy` — встроенная команда pnpm, но с v11 одноимённый скрипт её затеняет. Поэтому прод-скрипт назван `deploy:prod`, а в `apps/api/Dockerfile` для встроенной команды используется `pnpm pm deploy` (иначе сборка падает на `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`).
- **`pnpm deploy:prod` в non-TTY** (CI, фоновый шелл) падает с `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (pre-run deps-check pnpm 11). Запусти с `CI=true pnpm deploy:prod` или вызови docker-команду из скрипта напрямую.
- **`--no-deps`** при ручном `up` обязателен — иначе compose может пересоздать `postgres`.
- **docker exec через ssh-context** не принимает `-T` (это compose-флаг); для stdin используй `-i`.

### Переменные `.env.production`

| Переменная | Описание |
|---|---|
| `ADMIN_DOMAIN` | Домен админки (A-record → IP VPS) |
| `APP_DOMAIN` | Базовый домен share-страниц |
| `POSTGRES_PASSWORD` | Пароль postgres |
| `DATABASE_URL` | `postgresql://delivery:<pass>@postgres:5432/delivery_tracker` |
| `JWT_SECRET` | 32+ байта hex: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MAPBOX_TOKEN` | Серверный токен Mapbox |

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

### Текущее состояние (2026-06-18)

- **Prod head**: `0011_brown_solo` (id=12 в `__drizzle_migrations`, применено 2026-05-09).
- **Pending в репо**: `0012_powerful_gertrude_yorkes` — additive `UNIQUE(brand_id, share_hash)` на `trips`. Безопасна, без остановки API; рантайму не нужна (код не зависит от физического констрейнта), поэтому применяется обычным `pnpm db:migrate:prod` в любом окне.
- `0013` (destructive — снимает глобальный `trips_share_hash_unique`) ещё **не в репо**; отложена до того как новый share-resolver проживёт в проде один полный релиз.

> Проверить факт: `docker --context delivery-prod exec delivery-tracker-v2-postgres-1 psql -U delivery -d delivery_tracker -c "SELECT max(id) FROM drizzle.__drizzle_migrations;"` (`id N` ↔ файл `000{N-1}_*.sql`).

### Релиз-окна

Применение разделено на два окна. Их нельзя смешивать в один проход `db:migrate`, потому что у них разные требования к доступности API.

| Окно | Pending миграции | Требует ли API down | Статус |
|---|---|---|---|
| **A** | `0007 → 0011` | **Да** (из-за 0007) | ✅ применено 2026-05-09 (процедура ниже — историческая) |
| **B** | `0012` | Нет (additive) | ⏳ pending — применяется обычным `pnpm db:migrate:prod` |

#### Правило: когда нужна остановка API

> **API DOWN тогда и только тогда, когда в pending set присутствует `0007`.**
> `0007` содержит `DELETE FROM uploads WHERE brand_id IS NULL` и `ALTER COLUMN brand_id SET NOT NULL` на `uploads`. Live-INSERT в `uploads` во время apply упадёт на constraint violation.
>
> `0008–0012` сами по себе additive — не требуют остановки. Но если оператор запускает `db:migrate` с `0007` ещё в pending, то ВЕСЬ проход (включая 0008–0011, идущие в одной серии вызовов drizzle) проходит при остановленном API.
>
> Перед каждым релизом: посмотри `SELECT max(id) FROM drizzle.__drizzle_migrations` и сверь с `apps/api/src/db/migrations/`. Если в diff есть `0007` — окно A. Иначе — окно B (или пустое).

---

### Окно A: apply 0007 → 0011 (maintenance window, API down) — ✅ ВЫПОЛНЕНО 2026-05-09

> Историческая запись применённого релиза. Не запускать повторно (head уже = 0011). Оставлено как шаблон для будущих destructive-окон.

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

### Окно B: apply 0012 (additive, без остановки API) — ⏳ pending

App-код share-resolver'а (`apps/api/src/routes/share.ts`) уже в проде. Осталось применить саму миграцию — безопасно в любой момент, отдельного релиз-окна не требует.

`0012` добавляет compound `UNIQUE(brand_id, share_hash)` на `trips`. Constraint сосуществует с глобальным `trips_share_hash_unique` — оба валидны, не конфликтуют. Глобальный остаётся до 0013 (destructive cleanup, отложен ещё на одно релиз-окно).

**Pre-flight.** Hard-blocker — отсутствие дубликатов `(brand_id, share_hash)` в `trips`: иначе создание констрейнта упадёт.

```bash
# Apply (внутри API-контейнера). ВАЖНО: зови drizzle-kit НАПРЯМУЮ, не через
# `pnpm --filter ... db:migrate` — в деплой-образе (pnpm pm deploy-бандл) pnpm
# запускает pre-run deps-check -> `pnpm install` -> падает на
# ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC '@eslint/js' (нет workspace/catalog).
docker --context delivery-prod exec delivery-tracker-v2-api-1 \
  node_modules/.bin/drizzle-kit migrate
# Ожидаемо: applied 0012  (✅ применено 2026-06-21, prod head = 13)

# Verify
docker --context delivery-prod exec delivery-tracker-v2-postgres-1 \
  psql -U delivery -d delivery_tracker <<'SQL'
-- Migration head после apply
SELECT max(id) FROM drizzle.__drizzle_migrations;  -- expect 13

-- Compound UNIQUE на месте
SELECT conname FROM pg_constraint
 WHERE conrelid='trips'::regclass AND conname='trips_brand_share_hash_unique';
-- 1 строка
SQL
```

Additive: нет table rewrite, нет row-scan backfill'а; `ACCESS EXCLUSIVE` удерживается коротко на время валидации констрейнта (миллисекунды на проде).

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
В pnpm 11 голый `pnpm <script>` ищет скрипт во всех workspace-пакетах. Используй `pnpm run <script>` (текущая папка) или `pnpm --filter <pkg> <script>`.

**`zsh: no matches found: @delivery/...@workspace:*`**
zsh раскрывает `*` как glob. Заверни в кавычки: `pnpm add "@delivery/foo@workspace:*"`.

**`pnpm install` ругается на peer deps**
В корневом `.npmrc` должен быть `auto-install-peers=true`. Или: `pnpm install --force`.

**`Ignored build scripts: <pkg>`**
pnpm 11 блокирует postinstall-скрипты по умолчанию. Допиши пакет в `allowBuilds` (карта `имя: true`) в `pnpm-workspace.yaml`, потом `pnpm install` (или `pnpm rebuild <pkg>` если уже стоит). Старый ключ `pnpm.onlyBuiltDependencies` из `package.json` в v11 не работает.

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
