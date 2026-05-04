# Delivery Tracker — Roadmap

Этот документ — план прикладной работы после scaffold'а. Читать вместе с `ARCHITECTURE.md` (что строим) и `RUNBOOK.md` (как настроено окружение).

Принцип построения дороги:

1. **Фундамент сначала.** БД-схема целиком, auth, tenant middleware — потому что они трогают всё остальное и переделка дорогая.
2. **Тонкая вертикальная полоска вторым.** Share-страница на хардкод-таймлайне — она фиксирует **формат данных как контракт** и валидирует фундамент end-to-end.
3. **Симулятор третьим.** Пишется под уже зафиксированный формат timeline, не наоборот.
4. **Админка четвёртой.** Формы создания поездки опираются на готовую функцию `generate(input) → timeline` — никаких заглушек, никаких переделок.
5. **Production пятым.** Только когда продукт работает локально end-to-end.

Каждая milestone заканчивается **точкой синхронизации** — это место, где разные системы должны сойтись на одном контракте, и где легче всего расхождение пропустить.

---

## Глобальные решения, зафиксированные до старта

Эти решения проходят через все milestone'ы — фиксирую сейчас, чтобы дальше не возвращаться.

### Tenant-резолвер: path-based в админке, host-based на share

Админка резолвит бренд из URL: `/admin/b/:brandSlug/...`. Это значит, что:
- Каждый раз когда фронт запрашивает данные у API, в URL присутствует `brandSlug`.
- Бэкенд имеет два разных middleware: `requireAdminBrand` (читает path) и `requireShareBrand` (читает `Host`-заголовок).
- Эндпоинты вида `/admin/settings` (управление списком брендов) **не** требуют brand-context'а.

В `packages/schemas` это — `BrandSlugSchema`. На фронте `brandSlug` доступен через хук `useBrandSlug()` (TanStack Router params).

### Auth: минимальный, без регистрации

- Одна таблица `users` (email, passwordHash, createdAt).
- JWT с `userId`, без ролей, без скоупов.
- Любой залогиненный пользователь имеет доступ ко всем брендам.
- Регистрация — **только** через CLI: `pnpm --filter @delivery/api db:seed-admin --email ... --password ...`.
- Пароль хешируется через `argon2` (не bcrypt — Argon2id выиграл Password Hashing Competition и сейчас рекомендуется OWASP).
- JWT в HTTP-only cookie, не в localStorage. CSRF-защита через SameSite=lax.

### Формат timeline — единственный источник правды

Тип `Segment[]` (и `Trip`) живёт в **одном месте**: `packages/schemas/src/trip.ts` (Zod-схема + выводимый тип). От него зависят:
- `simulation/generate` — производит
- `simulation/interpolate` — потребляет
- `apps/api/src/db/schema.ts` — хранит как jsonb (но не валидирует структуру в БД, валидация на API-уровне)
- `apps/web/src/routes/s.$hash.tsx` — рендерит
- `apps/web/src/routes/admin/.../preview.tsx` — preview перед публикацией (M5)

Любое изменение типа = изменение во всех пяти местах. Это **критическая синхронизация номер 1**. `packages/schemas` остаётся API-контрактным пакетом без runtime-зависимостей; `simulation` импортирует тип/схему оттуда — DAG `simulation → schemas` сохраняется.

### Storage — абстракция с первого дня

Никто, кроме `apps/api/src/storage/`, не знает, как именно хранятся файлы. Все остальные слои работают через interface `Storage` и видят только `storageKey: string`. Публичный URL собирается через `storage.url(key)`, и только внутри API.

Если эта дисциплина соблюдается — миграция на R2 в будущем = одна новая реализация интерфейса и переключение env-переменной.

---

## M0: Scaffold (готово)

```
✅ Monorepo с pnpm workspaces
✅ packages/schemas, packages/simulation, packages/tsconfig
✅ apps/api на Hono с минимальным /health и /brands
✅ apps/web на Vite + React + Tailwind 4 + shadcn + TanStack Router/Query
✅ Drizzle подключён, migrations работают
✅ Postgres локально через docker-compose
✅ End-to-end: /admin рендерит данные из API через типизированные Zod-схемы
```

---

## M1: Foundation (БД, auth, tenant middleware)

**Цель:** Закрыть все «общие места», на которых дальше будут стоять все остальные milestone'ы.

### M1.1 — БД-схема целиком

Расширяем `apps/api/src/db/schema.ts` всеми таблицами из `ARCHITECTURE.md` сразу:

- `brands` (уже есть, дополнить полями `theme`, `logoStorageKey`, `primaryDomain`)
- `users` (новая)
- `cargo` (карточки грузов)
- `trips` (поездки + полный JSON timeline)
- `uploads` (метаданные файлов: storageKey, mime, sha256, sizeBytes)

Делаем **одной миграцией** — пока проект в локальном dev'е, нет смысла дробить на 5 миграций. Когда продукт будет в проде, новые изменения пойдут отдельными миграциями.

**Важно:**
- Все brand-owned таблицы (`cargo`, `trips`) имеют `brandId` с `ON DELETE CASCADE`.
- Все timestamp'ы — `timestamp with time zone`, `defaultNow()`.
- `uploads` **не** имеет `brandId`. Файл — независимая сущность; связь через `cargo.photoIds` или `brands.logoUploadId`. Это позволяет одному файлу теоретически использоваться в нескольких местах (хотя на практике мы будем создавать копии).

### M1.2 — Auth (login + JWT middleware + seed CLI)

Три эндпоинта:
- `POST /auth/login` — принимает email/password, возвращает JWT в HTTP-only cookie.
- `POST /auth/logout` — обнуляет cookie.
- `GET /auth/me` — возвращает текущего user'а или 401.

Middleware `requireAuth` для всех `/admin/*` эндпоинтов (кроме `/auth/login`).

CLI-скрипт `apps/api/src/scripts/seed-admin.ts`, запускается через `pnpm --filter @delivery/api seed-admin -- --email x --password y`.

### M1.3 — Tenant middleware

**Два разных middleware**, не один:

`requireAdminBrand` (для `/admin/b/:brandSlug/*`):
- Читает `brandSlug` из path-параметра.
- Резолвит в БД → `brand`.
- Кладёт `brand` в Hono `c.var`.
- 404 если нет.

`requireShareBrand` (для `/share/*` и `/internal/validate-domain`):
- Читает `Host`-заголовок.
- Резолвит в БД по `brand.shareDomain`.
- Кладёт `brand` в `c.var`.
- 404 если домен не привязан.

В `packages/schemas` — общий тип `Brand` (без поля passwordHash и других sensitive данных, только то что наружу торчит).

### M1.4 — Frontend integration

В `apps/web`:
- Login-страница `/login`.
- Глобальный `useAuth()` хук (TanStack Query на `/auth/me`).
- Защищённый layout для `/admin/*` — редиректит на `/login` если не залогинен.
- Главная админская страница `/admin` — список брендов (карточки), клик ведёт на `/admin/b/:brandSlug/dashboard`.
- Layout для `/admin/b/:brandSlug/*` — sidebar с навигацией внутри бренда (Trips, Cargo, Settings).

### Точка синхронизации M1

**Контракт `Brand`** — единый тип в `packages/schemas/src/brand.ts`. Используется:
- API: возвращает в `/auth/me`, в `/brands`, кладёт в context middleware.
- Web: `useAuth()` возвращает `User`, `useBrand()` возвращает `Brand`.
- Caddy validate-domain endpoint (M6) — будет читать ту же таблицу `brands`.

Если поле меняется — меняется в одном месте, попадает во все четыре.

### Smoke test M1

```
1. Запускаешь миграцию — таблицы создались.
2. pnpm seed-admin --email me@test.com --password test12345 — пользователь в БД.
3. В админке вводишь любой бренд через psql (один INSERT).
4. Открываешь /login → вводишь email/password → редирект на /admin.
5. Видишь карточку бренда → клик → /admin/b/test-brand/dashboard загружается.
6. curl без cookie на /admin/b/.../trips → 401.
7. curl на share-домен (Host: delivery.brand.com) с правильным брендом → 200, без бренда → 404.
```

---

## M2: Vertical slice — share-страница на хардкод-таймлайне

**Цель:** Получить визуально работающее end-to-end демо без симулятора и без админки. Зафиксировать формат timeline как контракт.

### M2.1 — Тип Segment окончательно

В `packages/schemas/src/trip.ts` (Zod-схема + `z.infer<>`-выводимые типы):

```ts
export type DrivingSegment = {
  type: 'driving'
  tStart: number          // unix seconds
  tEnd: number
  distStart: number       // meters from origin along polyline
  distEnd: number
}

export type RestSegment = {
  type: 'rest'
  tStart: number
  tEnd: number
  atDist: number          // meters from origin
  reason: 'sleep' | 'break' | 'fuel' | 'wait'
}

export type Segment = DrivingSegment | RestSegment

export type Trip = {
  startedAt: number       // unix seconds, абсолютное время старта
  polyline: GeoJSON.LineString
  totalDistance: number   // meters
  segments: Segment[]
}
```

Формат **деталей**: время в unix-секундах (UTC, без часовых поясов), дистанции в метрах. Никакого ISO-строкового времени, никаких дробных часов. Один тип чисел везде.

### M2.2 — Интерполятор

`packages/simulation/src/interpolate.ts` — чистая функция:

```ts
export function interpolatePosition(trip: Trip, t: number): {
  position: { lat: number; lng: number }
  segment: Segment
  progress: number  // 0..1, прогресс по всему trip'у
}
```

Алгоритм: бинарный поиск по `segments` → если `driving`, линейная интерполяция `dist` между `distStart`/`distEnd` → `@turf/along` находит точку на polyline → возвращаем. Если `rest` — точка статична на `atDist`.

Покрыть unit-тестами (vitest) — это единственное место, где математика, и баги тут самые тонкие.

### M2.3 — Хардкод-фикстура

Скрипт `apps/api/src/scripts/seed-demo-trip.ts`:
- Создаёт демо-бренд (если нет).
- Создаёт демо-cargo.
- Создаёт `trip` с polyline NYC → Chicago (~1300 км, можно взять готовый GeoJSON из Mapbox Studio или просто захардкодить ~10 точек) и timeline:
  - День 1: 8 часов driving, 30 мин break, ещё 3 часа driving, 10 часов rest.
  - День 2: то же.
  - И так 2-3 дня.
- Печатает share URL: `http://localhost:3000/share/<hash>` (для теста; на проде это будет `delivery.brand.com/<hash>`).

### M2.4 — Public API endpoint

`GET /share/:hash` (с `requireShareBrand` middleware):
- Резолвит trip по hash.
- Проверяет, что `trip.brandId === c.var.brand.id` (защита от утечек между брендами).
- Возвращает JSON: `{ trip, cargo }`. Бренд в response **не уходит** — share-страница нейтральная и одинаковая для всех брендов; бренд используется только для валидации домена и tenant-ownership.

В `packages/schemas` — `ShareResponseSchema`.

### M2.5 — Share-страница на фронте

`apps/web/src/routes/s.$hash.tsx` (TanStack Router):
- Запрос на `/share/:hash` через TanStack Query, валидация через `ShareResponseSchema`.
- MapLibre GL JS рендерит карту, polyline как layer, маркер грузовика.
- `setInterval` каждые 10 секунд — `interpolatePosition(trip, Date.now() / 1000)` → двигает маркер.
- Прогресс-бар внизу: %, ETA (когда `tEnd` последнего сегмента), статус («движется» / «отдых до 14:00»).
- Никакого брендирования: нейтральная Tailwind-палитра, одинаковая для всех брендов на всех доменах. Бренд — это группировка для админа, не визуальный элемент share-страницы.

**MapLibre setup** — отдельная подзадача, потому что тайлы платные/бесплатные:
- Стартовый стиль: бесплатный MapLibre demo style (`https://demotiles.maplibre.org/style.json`).
- Когда дойдёт до прода — переключим на Mapbox tiles или MapTiler. Структура кода не изменится, только URL стиля.

### Точка синхронизации M2

**Тип `Trip` зафиксирован.** После M2 любое изменение этого типа = breaking change. Все последующие milestone'ы (M3 генератор, M5 preview в админке) опираются именно на этот формат.

Если в процессе M2 ты понял, что нужно добавить поле (например, `weatherDelay` в Segment) — добавляй сейчас, пока всё на одном фронтенде. Потом будет дороже.

### Smoke test M2

```
1. pnpm seed-demo-trip → выводит share URL.
2. Открыл URL в браузере → видна карта, маршрут NYC→Chicago, маркер.
3. Маркер движется (визуально, в течение секунд) — потому что timeline начинается с tStart=now.
4. На странице видишь название груза, фото (заглушка), бренд-цвет.
5. Прогресс-бар обновляется.
6. Открыл консоль — нет ошибок, нет warning'ов от React/MapLibre.
```

---

## M3: HOS-симулятор

**Цель:** Заменить хардкод-фикстуру на реальный генератор timeline'а через Mapbox + HOS-логику.

### M3.1 — Mapbox Directions API клиент

`packages/simulation/src/mapbox.ts`:
- Функция `getRoute(origin, destination, waypoints)` → возвращает polyline + total distance + duration.
- Использует `driving` profile (truck profile в публичном API нет — это ограничение из ARCHITECTURE.md).
- Кладёт `MAPBOX_TOKEN` через параметр (не из env — функция остаётся чистой).

### M3.2 — HOS-автомат

`packages/simulation/src/hos.ts`:

Правила (упрощённые US FMCSA для property-carrying drivers):
- 11 часов вождения в смене
- 14 часов on-duty (вождение + ожидания) в смене
- 30-минутный break после 8 часов накопленного driving
- 10 часов rest между сменами
- 60/70-часовой rolling window — **игнорируем**, слишком сложно для MVP

Алгоритм:
1. Получаем `totalDistance` и `desiredArrival` от админа.
2. Считаем `requiredDriving = totalDistance / avgSpeed` (avgSpeed = 88 km/h).
3. Считаем `availableTime = desiredArrival - startedAt`.
4. Считаем `requiredRest` через автомат: каждые 11 часов driving = 10 часов rest, каждые 8 часов driving в смене = 30 мин break.
5. Если `requiredDriving + requiredRest > availableTime` → возвращаем ошибку «не уложимся, минимум столько-то».
6. Если `availableTime > requiredDriving + requiredRest` → распихиваем `slack` между rest-сегментами (увеличиваем длительность).

Покрыть unit-тестами с разными сценариями: тривиальный короткий путь, длинный путь с одним rest, нереальный ETA → ошибка, очень большой slack.

### M3.3 — `generate.ts`

`packages/simulation/src/generate.ts`:

```ts
export async function generateTrip(input: GenerateTripInput, opts: { mapboxToken: string }): Promise<Trip>
```

Внутри:
1. `getRoute()` через Mapbox.
2. `buildTimeline()` через HOS-автомат.
3. Возвращает `Trip` (тот самый из M2).

В `packages/schemas` — `GenerateTripInputSchema`.

### M3.4 — Эндпоинт создания поездки

`POST /admin/b/:brandSlug/trips`:
- Валидирует body через `GenerateTripInputSchema`.
- Вызывает `generateTrip()`.
- Сохраняет в БД через Drizzle.
- Возвращает `{ trip, shareUrl }`.

### Точка синхронизации M3

`generateTrip` возвращает **точно тот же** `Trip`, что и хардкод-фикстура из M2. Share-страница не должна заметить разницу. Если заметила — формат разошёлся, чини.

Тест: после M3 удали хардкод-фикстуру, создай поездку через API, открой share-URL — всё работает идентично.

### Smoke test M3

```
1. curl POST /admin/b/.../trips с реальными координатами NYC→LA (4500 км) → получаешь shareUrl.
2. Открываешь shareUrl → маршрут построен через настоящие highways, не прямая линия.
3. На timeline видны реалистичные паузы (rest каждые ~11 часов driving).
4. Меняешь desiredArrival на нереально близкое → API возвращает 400 с понятным сообщением.
```

---

## M4: Storage abstraction + uploads

**Цель:** Возможность загружать фото грузов через админку.

Делаем **после** симулятора, потому что симулятор — основная фича, а фото — украшение, и админка без них всё равно нужна для создания поездок.

### M4.1 — Storage interface + LocalStorage

`apps/api/src/storage/types.ts`:

```ts
export interface Storage {
  put(data: Buffer, mime: string): Promise<{ key: string; sha256: string }>
  url(key: string): string
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

Заметь: `put` **сам генерирует key** (`{sha256}.{ext}`), не принимает его снаружи. Это инварианта: имя файла зависит только от содержимого. Дедупликация бесплатная.

`apps/api/src/storage/local.ts`:
- Пишет в `STORAGE_ROOT`, разбивая по первым двум символам sha256 (`/uploads/ab/abc123.jpg`) — иначе в одной директории будут миллионы файлов.
- `url(key)` возвращает `${PUBLIC_BASE}/uploads/${key.slice(0,2)}/${key}`.

### M4.2 — Upload endpoint

`POST /admin/b/:brandSlug/uploads` (multipart/form-data):
- Принимает один файл за раз, max 10 MB.
- Валидирует MIME (только image/jpeg, image/png, image/webp).
- Кладёт в storage, пишет метаданные в `uploads`.
- Возвращает `{ id, storageKey, url }`.

### M4.3 — Static serving в dev

В dev окружении API сам отдаёт `/uploads/*` через Hono middleware (`hono/serve-static` или ручной handler). В prod это будет делать Caddy (M6).

### M4.4 — Cargo + photos integration

В `cargo` таблице — `photoUploadIds: uuid[]`.

Фронт-форма карточки груза:
- shadcn `<input type="file" multiple>` (или dropzone-компонент).
- Загружает по одному, накапливает массив `uploadId`.
- При сохранении карточки — `POST /admin/b/.../cargo` с массивом id.

### Точка синхронизации M4

`Storage.url(key)` — единственный способ получить публичный URL. Никто (ни фронт, ни другие сервисы) не строит URL вручную. Если завтра меняем layout файлов на диске или переезжаем на R2 — затрагивается только `LocalStorage.url`.

### Smoke test M4

```
1. В админке создаёшь cargo, загружаешь 3 фото — все три появляются.
2. Перезагрузка страницы — фото остались.
3. ls -la storage volume — файлы лежат, имена = sha256.
4. Загрузка одного и того же файла дважды — в storage один файл, в БД две записи uploads с одним storageKey.
5. .pdf файл → 400 Bad Request.
```

---

## M5: Админка целиком

**Цель:** Все CRUD-операции работают, поездка создаётся from scratch через UI.

### M5.1 — Cargo CRUD

`/admin/b/:brandSlug/cargo`:
- Список (таблица shadcn).
- Создание (форма с произвольными полями + загрузка фото).
- Редактирование.
- Удаление (с подтверждением).

### M5.2 — Trip creation flow

`/admin/b/:brandSlug/trips/new`:
- Step 1: выбор cargo.
- Step 2: route — пара полей с автокомплитом адресов (Mapbox Geocoding API), waypoints (массив, max 10).
- Step 3: время — `startedAt` (default: now), `desiredArrival` (date+time picker).
- Step 4: preview — показываем результат `generateTrip()` на карте (то же, что увидит клиент). Если симулятор вернул ошибку «не уложимся» — показываем минимально возможное время прибытия и кнопку «использовать его».
- Submit → POST /trips → редирект на `/admin/b/.../trips/:id`.

### M5.3 — Trip detail page

`/admin/b/:brandSlug/trips/:tripId`:
- Та же карта что на share-странице, тот же интерполятор.
- Share URL с кнопкой «копировать».
- Список сегментов timeline (читабельно: «Driving 8h, NYC → Cleveland», «Rest 10h»).
- Кнопка «удалить trip».

### M5.4 — Brand settings

`/admin/settings/brands/:brandId`:
- Edit name, slug, primary color, logo (через upload).
- Edit `shareDomain` — но не активирует TLS пока (это M6).

### M5.5 — Trips listing

`/admin/b/:brandSlug/trips`:
- Таблица: cargo title, origin/destination, статус (рассчитывается в реалтайме через интерполятор: Pending / Driving / Resting / Arrived), share URL.
- Фильтры: статус, дата создания.

### Точка синхронизации M5

`Trip preview в админке` использует **тот же компонент карты** и **тот же интерполятор**, что share-страница. Это не копипаста — это `apps/web/src/components/share/TripMap.tsx`, импортируемый и там, и там.

Если ты замечаешь, что копируешь код карты — стоп, выноси в общий компонент.

### Smoke test M5

```
1. Логинишься, создаёшь бренд через CLI (или /settings).
2. Открываешь /admin/b/test/cargo, создаёшь груз с фото.
3. Открываешь /admin/b/test/trips/new, заполняешь форму, видишь preview.
4. Submit → редирект на trip detail → share URL.
5. Копируешь URL, открываешь в incognito — share-страница работает.
6. Возвращаешься в админку, удаляешь trip → share URL даёт 404.
```

---

## M6: Production deploy

**Цель:** Всё работает на реальном домене с реальным TLS, multi-tenant.

### M6.1 — Caddyfile с on-demand TLS

Финальный `infra/Caddyfile` из ARCHITECTURE.md.

`apps/api/src/routes/internal.ts`:
- `GET /internal/validate-domain?domain=...`
- Принимает запросы только из docker-сети (проверка по `c.req.header('X-Forwarded-For')` или просто `X-Internal-Token`).
- Резолвит домен в `brands.shareDomain`.
- 200 / 404.

### M6.2 — Dockerfile для apps/api и apps/web

Multi-stage builds:
- api: stage 1 ставит deps, stage 2 копирует `dist/` + production deps в slim-образ.
- web: stage 1 билдит Vite, stage 2 — nginx-alpine отдаёт статику.

### M6.3 — Production compose + secrets

`infra/compose.prod.yml` (уже есть в ARCHITECTURE.md). `.env.production` локально, не комитим.

### M6.4 — Backup setup

На сервере cron-скрипт:
- `pg_dump` каждый день в 03:00.
- `restic backup` `cargo_uploads` volume + dump в Hetzner Storage Box.

### M6.5 — Deploy

Через Docker Context (или save/load если CPX21 не тянет билд):

```bash
pnpm deploy
pnpm db:migrate:prod
```

DNS:
- `admin.example.com` → A record на VPS.
- Test brand: `delivery.brand1.com` CNAME → `tracker.example.com`.

### M6.6 — Sentry + UptimeRobot

- Sentry SDK в `apps/api` и `apps/web`.
- UptimeRobot на `https://admin.example.com/health` каждые 5 минут.

### Smoke test M6

```
1. https://admin.example.com открывается, TLS зелёный.
2. Логин, создание trip.
3. Share URL на delivery.brand1.com открывается — TLS выпустился on-demand.
4. UptimeRobot шлёт ОК.
5. Кладёшь сервис (`docker stop api`) → Sentry/UptimeRobot шлёт алерт.
```

---

## Приоритетная карта critical syncs

Один взгляд на все «места разрыва», за которыми надо следить:

| Контракт | Где живёт | Кто потребляет |
|----------|-----------|-----------------|
| `Brand` (тип) | `packages/schemas/src/brand.ts` | api middleware, web `useBrand`, Caddy validate-domain |
| `Trip` + `Segment[]` | `packages/schemas/src/trip.ts` | generate, interpolate, БД, share, admin preview |
| `Storage.url(key)` | `apps/api/src/storage/types.ts` | все, кто отдаёт файлы наружу |
| `brandSlug` в URL | TanStack Router params + Hono path-params | админка, tenant middleware |
| `Host`-резолвер | `requireShareBrand` middleware | share-эндпоинт, validate-domain |

Если нужно поменять что-то в одной строке этой таблицы — мысленно пройди по всему столбцу «Кто потребляет» и проверь каждое место.

---

## Что осталось за пределами roadmap

Сознательно не включено, делать **только по реальному запросу**, не превентивно:

- **R2/S3 миграция** — пока volume справляется.
- **Realtime обновления share-страницы** — таймлайн детерминированный, незачем.
- **Управление поездкой** (delay, cancel) — нужен сценарий, не сейчас.
- **Multi-language** — все клиенты в US/Canada, английский.
- **Analytics для админа** — пусть появится когда будет что показывать.
- **Email-нотификации клиенту** — сначала проверим, что share-ссылки в принципе достаточно.
- **API для клиентов** (программный доступ к статусу) — пока нет ни одного запроса.
- **Audit log** — добавим если несколько админов начнут конфликтовать.

Каждый из этих пунктов — отдельная сессия проектирования, когда понадобится. Раньше — нет.
