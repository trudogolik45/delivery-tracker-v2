# Production deployment — brand ownership isolation

Одноразовая процедура: ввод `brands.owner_id` на проде, где уже есть один Dispatch
Manager и его бренды. Нельзя:

- destructive миграции (NOT NULL без default против непустой таблицы);
- `UPDATE` без `WHERE owner_id IS NULL`;
- любые `DROP` / `DELETE`;
- автоматический all-to-all grant.

После деплоя действует middleware `requireAdminBrand`, фильтрующий по
`brands.owner_id = c.get('user').id`, и `GET /admin/brands`,
возвращающий только бренды текущего DM.

## Что мы выкатываем

| Артефакт | Где |
|---|---|
| Миграция 0005 (nullable + FK) | `apps/api/src/db/migrations/0005_salty_gwen_stacy.sql` |
| Миграция 0006 (`SET NOT NULL`) | `apps/api/src/db/migrations/0006_clever_cannonball.sql` |
| Backfill-скрипт | `apps/api/src/scripts/assign-brand-owner.ts` |
| Изоляция в API | `apps/api/src/middleware/tenant.ts`, `apps/api/src/routes/admin.ts` |
| Релизная ревизия | git ref / docker image tag, фиксируется на старте |

⚠️ Ключевой нюанс: `pnpm db:migrate` применит 0005 **и** 0006 за один проход и
0006 упадёт (`column "owner_id" contains null values`). Поэтому в этой
процедуре миграции применяются **вручную через `psql`**, а drizzle-журнал
синхронизируется отдельным `INSERT`.

## Inputs (заполнить до старта)

```text
RELEASE_REF      = <git sha или image tag>
PROD_DM_USER_ID  = <uuid единственного существующего DM>   # узнаём в Phase 0
PG_USER          = delivery
PG_DB            = delivery_tracker
COMPOSE_FILE     = infra/compose.prod.yml
BACKUP_PATH      = /var/backups/delivery/<YYYYMMDD-HHMM>-pre-owner-id.sql.gz
```

Все команды ниже выполняются на prod-хосте, с правом запускать `docker compose`.
`docker compose -f $COMPOSE_FILE exec ...` далее сокращён как `dc exec ...`.

---

## Phase 0 — read-only preflight

Цель: убедиться, что состояние БД ровно такое, как мы ожидаем. Никаких записей.

```bash
# 0.1  applied миграции drizzle (должны быть 0000..0004)
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT id, hash, to_timestamp(created_at/1000) AS at
   FROM drizzle.__drizzle_migrations ORDER BY id;"
```

Ожидание: 5 строк, последняя `0004_*`. Если уже есть запись 0005/0006 — STOP, миграция уже применена частично; разбираться вручную.

```bash
# 0.2  колонки brands (owner_id ещё нет)
dc exec postgres psql -U $PG_USER -d $PG_DB -c "\d+ brands"

# 0.3  пользователи и кандидаты на ownership
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT id, email, created_at FROM users ORDER BY created_at;"

# 0.4  бренды (сколько строк нужно бэкфилить)
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT id, slug, name, share_domain, created_at FROM brands ORDER BY created_at;"
```

Verify:

- `users` содержит ровно одного DM (либо вы знаете, какой `id` владелец);
- `brands` содержит N ≥ 0 строк, все они принадлежат этому DM;
- зафиксировать `PROD_DM_USER_ID = <id>` для Phase 3.

Stop-условия:

- В `users` несколько строк, и непонятно, кто owner всех brands → не идём дальше, согласовать.
- В `brands` есть строка, которую этому DM назначать **нельзя** → остановка, эту deployment-процедуру использовать нельзя (она по дизайну "all current brands → one owner").

## Phase 1 — backup

```bash
mkdir -p "$(dirname $BACKUP_PATH)"
dc exec -T postgres pg_dump -U $PG_USER -d $PG_DB --format=custom \
  | gzip > $BACKUP_PATH
ls -lh $BACKUP_PATH
```

Verify: файл существует, размер ≥ ожидаемого, права rw только у operator.

Smoke-тест бэкапа (опционально, на staging-БД):

```bash
gunzip -c $BACKUP_PATH | pg_restore -d <staging_db> --clean --if-exists
```

Без работающего бэкапа дальше не идём.

## Phase 2 — миграция 0005 (nullable + FK)

Эта миграция безопасна на непустой таблице: `owner_id` создаётся nullable, FK
проверяется только для не-NULL значений (а их нет).

```bash
# 2.1  apply 0005 SQL
dc exec -T postgres psql -U $PG_USER -d $PG_DB -v ON_ERROR_STOP=1 \
  < apps/api/src/db/migrations/0005_salty_gwen_stacy.sql

# 2.2  hash файла для drizzle journal
HASH_0005=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('apps/api/src/db/migrations/0005_salty_gwen_stacy.sql')).digest('hex'))")
echo "0005 hash: $HASH_0005"

# 2.3  зарегистрировать в drizzle.__drizzle_migrations
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('$HASH_0005', (extract(epoch from now()) * 1000)::bigint);"
```

Verify:

```bash
dc exec postgres psql -U $PG_USER -d $PG_DB -c "\d brands"
# колонка owner_id uuid NULL, FK brands_owner_id_users_id_fk → users(id) ON DELETE RESTRICT
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT count(*) AS null_owners FROM brands WHERE owner_id IS NULL;"
# = N (все строки пока без владельца)
```

Чекпоинт: если что-то пошло не так на этом шаге, см. Rollback / Phase 2.

## Phase 3 — manual backfill

Используем уже существующий `assign-brand-owner.ts`. Скрипт делает
ровно один `UPDATE brands SET owner_id = $1 WHERE owner_id IS NULL` —
это и есть требуемая защита (правило #8). Никаких bare `UPDATE brands`.

```bash
# Запускаем tsx внутри prod-контейнера API — у него уже есть DATABASE_URL
dc exec api node_modules/.bin/tsx src/scripts/assign-brand-owner.ts \
  --user-id "$PROD_DM_USER_ID"
```

Скрипт выводит список ассигнованных brand'ов:

```
assigned 3 brand(s) to dm@example.com (uuid):
  brand-a (uuid)
  brand-b (uuid)
  ...
```

Verify (обязательно перед Phase 4):

```bash
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT count(*) AS null_owners FROM brands WHERE owner_id IS NULL;"
# = 0

dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT slug, owner_id FROM brands ORDER BY created_at;"
# все owner_id = $PROD_DM_USER_ID
```

Stop-условие: `null_owners > 0` → НЕ применять 0006. Проверить, что
`PROD_DM_USER_ID` существует в `users`, перезапустить скрипт.
Скрипт идемпотентен (фильтр `IS NULL`), повторный запуск безопасен.

## Phase 4 — миграция 0006 (`SET NOT NULL`)

```bash
# 4.1  guard: ещё раз убеждаемся что NULL-ов нет
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT count(*) FROM brands WHERE owner_id IS NULL;"
# = 0; иначе STOP

# 4.2  apply 0006 SQL
dc exec -T postgres psql -U $PG_USER -d $PG_DB -v ON_ERROR_STOP=1 \
  < apps/api/src/db/migrations/0006_clever_cannonball.sql

# 4.3  journal
HASH_0006=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('apps/api/src/db/migrations/0006_clever_cannonball.sql')).digest('hex'))")
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('$HASH_0006', (extract(epoch from now()) * 1000)::bigint);"
```

Verify:

```bash
dc exec postgres psql -U $PG_USER -d $PG_DB -c "\d brands" | grep owner_id
# owner_id | uuid | not null

dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "SELECT id, hash, to_timestamp(created_at/1000) AS at
   FROM drizzle.__drizzle_migrations ORDER BY id;"
# 0000..0006 — все 7 строк
```

Идемпотентность: повторный `pnpm db:migrate` после деплоя должен сказать
`No migrations to apply`. Если он попытается применить 0005/0006 — журнал
синхронизирован неправильно, см. Rollback / Phase 4.

## Phase 5 — deploy backend

К этому моменту схема уже совместима со **старым** API (поле игнорируется
старым кодом для `SELECT`, но `INSERT INTO brands` со старого кода упадёт
по NOT NULL). Поэтому деплой нового API — обязательная и срочная часть.

```bash
# 5.1  pre-pull image (или git pull + build) до окна downtime
docker compose -f $COMPOSE_FILE pull api

# 5.2  rolling restart api (web можно не трогать — API-контракт совместим)
docker compose -f $COMPOSE_FILE up -d --no-deps --force-recreate api

# 5.3  health
curl -sf https://$ADMIN_DOMAIN/api/health
dc exec api node -e "console.log('ok')"
```

Verify:

```bash
# логин prod DM, GET /admin/brands возвращает его бренды
curl -s -c /tmp/prod-dm.cookies -X POST https://$ADMIN_DOMAIN/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<prod-dm-email>","password":"<...>"}' -o /dev/null -w '%{http_code}\n'
# 200

curl -s -b /tmp/prod-dm.cookies https://$ADMIN_DOMAIN/api/admin/brands
# JSON-массив существующих brands prod DM

rm /tmp/prod-dm.cookies
```

## Phase 6 — post-deploy smoke (двух DM)

Цель: подтвердить tenant isolation на проде. Делаем без удаления данных
(правило #9). Вариант A — staging-зеркало; вариант B — прод с
помеченным test-DM.

### Вариант A (рекомендуется, если есть staging)

Прогнать тот же `mja`-смок (см. `delivery-tracker-v2-mja`) на staging,
куда восстановлен прод-бэкап и применена та же миграционная процедура.
Если зелёно — на проде ограничиться шагом 5.3.

### Вариант B (только прод)

Создать второго DM с предсказуемым «test»-email (не удалять после; см.
Aftercare ниже).

```bash
TS=$(date +%Y%m%d-%H%M)
TEST_DM_EMAIL="qa-tenant-isolation-$TS@example.invalid"
TEST_DM_PASS="$(openssl rand -hex 16)"

# 6.1  создать тестового DM
dc exec api node_modules/.bin/tsx src/scripts/seed-admin.ts \
  --email "$TEST_DM_EMAIL" --password "$TEST_DM_PASS"

# 6.2  залогиниться prod DM и тестовый DM (две cookie jar'ы)
curl -sf -c /tmp/prod.cookies https://$ADMIN_DOMAIN/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<prod-dm-email>","password":"<...>"}' -o /dev/null
curl -sf -c /tmp/test.cookies https://$ADMIN_DOMAIN/api/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$TEST_DM_EMAIL\",\"password\":\"$TEST_DM_PASS\"}" -o /dev/null

# 6.3  test DM не видит prod брендов
curl -s -b /tmp/test.cookies https://$ADMIN_DOMAIN/api/admin/brands
# []

# 6.4  prod DM видит только свои
curl -s -b /tmp/prod.cookies https://$ADMIN_DOMAIN/api/admin/brands | jq '.[].slug'
# perekhrist'ов 1+ slug, никаких чужих

# 6.5  test DM на любом prod-slug → 404 (вместо 403, чтобы не утекало существование)
PROD_SLUG="<какой-то существующий prod brand slug>"
for path in dashboard trips cargo; do
  echo -n "$path: "
  curl -s -b /tmp/test.cookies -o /dev/null -w "%{http_code}\n" \
    https://$ADMIN_DOMAIN/api/admin/b/$PROD_SLUG/$path
done
# все 404

# 6.6  prod DM на свой slug → 200
for path in dashboard trips cargo; do
  echo -n "$path: "
  curl -s -b /tmp/prod.cookies -o /dev/null -w "%{http_code}\n" \
    https://$ADMIN_DOMAIN/api/admin/b/$PROD_SLUG/$path
done
# все 200

# 6.7  share-страница без cookie не сломалась (regression)
SHARE_HASH="<любой существующий prod share_hash>"
SHARE_DOMAIN="<его brand.shareDomain>"
curl -s -H "Host: $SHARE_DOMAIN" https://$SHARE_DOMAIN/api/share/$SHARE_HASH \
  | jq 'has("trip"), has("cargo")'
# true, true

rm -f /tmp/prod.cookies /tmp/test.cookies
```

Acceptance (всё должно быть зелёным до объявления деплоя успешным):

- [ ] test DM `GET /admin/brands` → `[]`
- [ ] prod DM `GET /admin/brands` → только его brands
- [ ] test DM на чужой brand-slug → 404 (dashboard/trips/cargo)
- [ ] prod DM на свой brand-slug → 200 (dashboard/trips/cargo)
- [ ] `GET /share/<hash>` без cookie на правильном Host → trip+cargo

---

## Rollback

Главный принцип: **rollback ≠ обратная миграция**. Колонку и FK не
дропаем (правило #9). Откатываем приложение и снимаем `NOT NULL`,
если он успел зафиксироваться, чтобы старый код снова мог делать
`INSERT INTO brands` без `owner_id`.

### Если что-то сломалось…

**…после Phase 2 (0005 применена, backfill ещё не сделан)**

Опасности нет: `owner_id` nullable, старый код ничего не пишет в эту колонку,
ничего не читает. Можно стоять в этой точке сколь угодно долго и решать.

Если всё-таки требуется откатить journal (например, чтобы повторить чисто):

```sql
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<HASH_0005>';
-- колонку и FK НЕ трогаем (правило #9). Drizzle при следующем
-- migrate-проходе наткнётся на 'column already exists' и упадёт.
-- Поэтому DELETE из journal — нежелательная мера, делать только если
-- решено физически удалять колонку (этот runbook этого не делает).
```

**…после Phase 3 (backfill сделан, 0006 ещё не применена)**

Тоже безопасно. Колонка nullable, заполнена. Старый код не сломан.
Можно дождаться нового окна и продолжить с Phase 4.

**…после Phase 4 (NOT NULL включён) или Phase 5 (новый API задеплоен)**

Чтобы вернуть совместимость со старым кодом (он не передаёт `owner_id` при
`INSERT INTO brands`):

```bash
# 1. снять NOT NULL — НЕ destructive (allows NULL again)
dc exec postgres psql -U $PG_USER -d $PG_DB -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE brands ALTER COLUMN owner_id DROP NOT NULL;"

# 2. синхронизировать journal: убрать запись 0006
dc exec postgres psql -U $PG_USER -d $PG_DB -c \
  "DELETE FROM drizzle.__drizzle_migrations WHERE hash = '$HASH_0006';"

# 3. откатить API на предыдущий image tag
docker compose -f $COMPOSE_FILE pull api:<prev-tag>
docker compose -f $COMPOSE_FILE up -d --no-deps --force-recreate api
```

Колонку `owner_id` и FK мы оставляем — они forward-совместимы.

**Полный откат к pre-deploy состоянию схемы** возможен только из бэкапа
(Phase 1) и требует downtime + согласования. Не делать без явного решения.

---

## Aftercare

- Test DM из Phase 6 (`qa-tenant-isolation-*@example.invalid`) удалить
  нельзя (правило #9). Зафиксировать его `users.id` в этом runbook'е и
  пометить как «тестовый, не удалять без отдельного DELETE-окна».
- Проверить через сутки, что `pnpm db:migrate` (или его эквивалент в
  CI/CD) говорит «no pending migrations» — иначе journal не синхронизирован.
- Бэкап `$BACKUP_PATH` хранить минимум 30 дней.

## Acceptance summary

Деплой считается успешным, когда:

1. `\d brands` показывает `owner_id uuid NOT NULL` + FK на `users(id)`.
2. `SELECT count(*) FROM brands WHERE owner_id IS NULL` = 0.
3. `drizzle.__drizzle_migrations` содержит ровно 7 строк (0000..0006).
4. API контейнер на `RELEASE_REF`, `/health` = 200.
5. Все 5 acceptance-чек-боксов в Phase 6 зелёные.
