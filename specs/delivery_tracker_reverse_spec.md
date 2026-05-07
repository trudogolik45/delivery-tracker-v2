# Delivery Tracker — Обратная спецификация

> Извлечено из кода методом Spec Miner (EARS-формат). Дата: 2026-05-07.

---

## 1. Стек и версии

| Слой | Технология |
|------|-----------|
| Runtime | Node ≥ 24, ESM (`"type":"module"`) |
| Пакетный менеджер | pnpm 10 (workspace monorepo) |
| База данных | Postgres 18 via Drizzle ORM 0.45 |
| API фреймворк | Hono 4 (port 3000) |
| Валидация | Zod v4 (`z.uuid()`, `z.email()` — top-level) |
| Web SPA | Vite 8 + React 19 + TypeScript 6 |
| Маршрутизация (web) | TanStack Router (file-based) |
| Состояние/запросы | TanStack Query |
| UI компоненты | shadcn/ui (`base-nova`), Tailwind v4 |
| Картография | Mapbox (геокодинг + маршруты) |
| Инфра | Docker Compose (dev) / Caddy + Docker Compose (prod) |

---

## 2. Структура модулей

```
apps/api/src/
  index.ts              — точка входа, CORS, маршрут /health
  env.ts                — загрузка env var (required/optional)
  uploads.ts            — resolvePhotoUrls (ID → URL)
  auth/
    jwt.ts              — signSession / verifySession (HS256, TTL 7d)
    middleware.ts       — requireAuth: парсит cookie, загружает user
    passwords.ts        — bcrypt-совместимая верификация
    routes.ts           — /auth/login | /auth/logout | /auth/me
  db/
    schema.ts           — Drizzle-схема (brands, users, cargo, trips, uploads)
    index.ts            — singleton db (pg)
  middleware/
    tenant.ts           — requireAdminBrand: slug → brand + ownerCheck
  routes/
    admin.ts            — /admin/* (brand CRUD, cargo CRUD, trips, uploads)
    share.ts            — /share/:hash (публичный, domain-enforced)
    internal.ts         — /internal/validate-domain (для Caddy TLS)
  storage/
    types.ts            — интерфейс Storage
    local.ts            — LocalStorage (файловая система, SHA256-адресация)
    index.ts            — singleton storage

packages/schemas/src/
  auth.ts               — LoginInput, LoginResponse, MeResponse, UserPublic
  brand.ts              — Brand, BrandCreate, BrandDnsStatus, BrandSlug
  cargo.ts              — Cargo, CargoCreate, CargoUpdate, CargoWithPhotos
  trip.ts               — Trip, Segment, TripListItem, TripAdmin, LatLng, GenerateTripInput
  share.ts              — ShareResponse, CargoPublic
  upload.ts             — UploadResponse

packages/simulation/src/
  generate.ts           — generateTrip: Mapbox → HOS-timeline
  hos.ts                — buildTimeline, HosError (FMCSA-правила)
  mapbox.ts             — getRoute (Directions API)
  interpolate.ts        — позиция водителя по timestamp

apps/web/src/
  routes/s.$hash.tsx    — публичная Share Page
  routes/admin/         — защищённый раздел (TanStack Router layout)
  components/TripMap.tsx — Mapbox GL карта с треком и маркером водителя
  components/GeoSearch.tsx — геокодинг-комбобокс (debounce → /admin/geocode)
  lib/api.ts            — apiRequest / apiJson (fetch + credentials: include)
  lib/trip-status.ts    — tripStatus: Pending | Driving | Resting | Arrived
  lib/format.ts         — formatDateTime, formatMiles
```

---

## 3. Наблюдаемые требования (EARS)

### 3.1 Аутентификация

**AUTH-1** (Event-driven)
Когда клиент отправляет `POST /auth/login` с валидными email/password, система должна:
- нормализовать email (trim + lowercase),
- установить `httpOnly, SameSite=Lax, Secure=prod, path=/` cookie `auth` с JWT (HS256, TTL 7 дней),
- вернуть `{user: {id, email}}` со статусом 200.
> _Источник: `auth/routes.ts:15-43`, `auth/jwt.ts:14-22`_

**AUTH-2** (Event-driven)
Когда email или password не совпадают с записью в базе, система должна вернуть `{error: "invalid credentials"}` со статусом 401.
> _Источник: `auth/routes.ts:25-27`_

**AUTH-3** (Event-driven)
Когда клиент отправляет `POST /auth/logout`, система должна удалить cookie `auth` и вернуть 204.
> _Источник: `auth/routes.ts:45-48`_

**AUTH-4** (Event-driven)
Когда запрос к `/admin/*` не содержит cookie `auth` или токен не прошёл верификацию, система должна вернуть `{error: "unauthenticated"}` со статусом 401.
> _Источник: `auth/middleware.ts:19-41`_

**AUTH-5** (Ubiquitous)
Система должна хранить пароли в хэшированном виде — никогда в открытом тексте.
> _Источник: `auth/passwords.ts`, `scripts/seed-admin.ts`_

---

### 3.2 Multi-tenancy (Brand Ownership)

**TENANT-1** (Ubiquitous)
Каждый Brand должен иметь ровно одного владельца (Dispatch Manager) — поле `owner_id NOT NULL REFERENCES users(id) RESTRICT`.
> _Источник: `db/schema.ts:17`_

**TENANT-2** (Event-driven)
Когда аутентифицированный пользователь обращается к `/admin/b/:brandSlug/*`, система должна проверить, что slug принадлежит именно этому пользователю; при несовпадении вернуть `{error: "brand not found"}` со статусом 404.
> _Источник: `middleware/tenant.ts:28-30` — 404, не 403_

**TENANT-3** (Ubiquitous)
`GET /admin/brands` должен возвращать только те бренды, где `ownerId = user.id`.
> _Источник: `routes/admin.ts:33`_

**TENANT-4** (Event-driven)
При создании бренда (`POST /admin/brands`) система должна автоматически назначить владельцем текущего аутентифицированного пользователя.
> _Источник: `routes/admin.ts:51-54`_

**TENANT-5** (Ubiquitous)
Передача Brand между Dispatch Manager'ами через API не поддерживается — только напрямую в базе.
> _Источник: `CONTEXT.md:43`_

---

### 3.3 Brand CRUD

**BRAND-1** (Event-driven)
При создании бренда система должна проверить уникальность `slug` и `shareDomain`; при конфликте — вернуть `{error: "slug or share domain already in use"}` со статусом 409.
> _Источник: `routes/admin.ts:44-50`_

**BRAND-2** (Ubiquitous)
Brand slug должен соответствовать регулярному выражению `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/` и быть длиной 1–64 символа.
> _Источник: `schemas/brand.ts:3-7`_

**BRAND-3** (Ubiquitous)
Share domain должен быть валидным hostname (3–253 символа), всегда хранится в нижнем регистре.
> _Источник: `schemas/brand.ts:20-25`_

**BRAND-4** (Event-driven)
`GET /admin/brands/:slug/dns-status` должен вернуть `{resolved: bool, expected: string[], actual: string[]}`, сравнивая A-записи shareDomain с A-записями admin-хоста.
> _Источник: `routes/admin.ts:78-94`_

---

### 3.4 Cargo

**CARGO-1** (Ubiquitous)
Cargo принадлежит конкретному бренду; все операции должны применять фильтр `brandId = brand.id`.
> _Источник: `routes/admin.ts:132-221`_

**CARGO-2** (Ubiquitous)
Cargo должен содержать: `title` (1–255 символов), `fields` (ключ-значение строк), `photoUploadIds` (массив UUID).
> _Источник: `schemas/cargo.ts:17-21`_

**CARGO-3** (Event-driven)
При ответе на любой запрос cargo система должна подставлять `photoUrls` — фактические URL файлов по `uploadId`.
> _Источник: `routes/admin.ts:134-143`, `uploads.ts:6-17`_

**CARGO-4** (Event-driven)
При удалении cargo-записи (`DELETE /admin/b/:brandSlug/cargo/:cargoId`) система должна вернуть 204 при успехе или 404, если запись не найдена в данном бренде.
> _Источник: `routes/admin.ts:213-222`_

---

### 3.5 Trips

**TRIP-1** (Event-driven)
При создании Trip система должна:
1. получить маршрут через Mapbox Directions API,
2. построить HOS-timeline через `buildTimeline`,
3. создать уникальный `shareHash` (nanoid 16 символов),
4. сохранить trip в базе,
5. вернуть `{tripId, shareHash}` со статусом 201.
> _Источник: `routes/admin.ts:427-469`_

**TRIP-2** (Event-driven)
Когда `desiredArrival` физически недостижим с учётом HOS-правил, система должна вернуть `{error: "...", minimumArrival: <unix-seconds>}` со статусом 422.
> _Источник: `packages/simulation/hos.ts:27-35`_

**TRIP-3** (Optional)
Там, где `MAPBOX_TOKEN` не настроен, система должна возвращать 503 при попытке создать или preview Trip.
> _Источник: `routes/admin.ts:410-412`, `routes/admin.ts:428-430`_

**TRIP-4** (Event-driven)
`POST /admin/b/:brandSlug/trips/preview` должен генерировать trip без сохранения в базе и вернуть полный объект `Trip`.
> _Источник: `routes/admin.ts:409-425`_

**TRIP-5** (Event-driven)
`POST /trips/:tripId/pause` должен добавить объект `{pausedAt: <unix>}` в массив `pauses`; если trip уже на паузе — вернуть 409.
> _Источник: `routes/admin.ts:325-363`_

**TRIP-6** (Event-driven)
`POST /trips/:tripId/resume` должен записать `resumedAt: <unix>` в последний элемент `pauses`; если trip не на паузе — вернуть 409.
> _Источник: `routes/admin.ts:365-395`_

**TRIP-7** (Ubiquitous)
Операции pause/resume должны быть атомарными — используют `jsonb`-выражения с условием в `WHERE`, не отдельные SELECT + UPDATE.
> _Источник: `routes/admin.ts:334-350`_

**TRIP-8** (Ubiquitous)
`GET /admin/b/:brandSlug/trips/:tripId` должен возвращать вычисленный `Trip` объект (polyline + segments) только если в базе есть оба поля `routeGeometry` и `timeline`; иначе — `trip: null`.
> _Источник: `routes/admin.ts:291-307`_

---

### 3.6 Share Page

**SHARE-1** (Event-driven)
Когда клиент запрашивает `GET /share/:hash` с корректным `Host`-заголовком, система должна вернуть `ShareResponse {trip, cargo}`.
> _Источник: `routes/share.ts:11-78`_

**SHARE-2** (Event-driven)
Когда `Host`-заголовок не совпадает с `brand.shareDomain`, система должна вернуть 421 с `{redirectTo: "https://<shareDomain>/s/<hash>"}`.
> _Источник: `routes/share.ts:37-43`_

**SHARE-3** (Event-driven)
Когда клиент получает 421, веб-приложение должно автоматически сделать `window.location.replace(redirectTo)`.
> _Источник: `apps/web/src/routes/s.$hash.tsx:24-27`_

**SHARE-4** (Ubiquitous)
Share Page должна отображать: название груза, ETA, общее расстояние (мили), поля груза, фотографии, карту с треком и текущим положением.
> _Источник: `apps/web/src/routes/s.$hash.tsx:44-100`_

**SHARE-5** (State-driven)
Пока trip находится на паузе (последний pause не имеет `resumedAt` или `resumedAt > now`), Share Page должна показывать badge «Service stop».
> _Источник: `apps/web/src/routes/s.$hash.tsx:47-50`_

**SHARE-6** (Ubiquitous)
ShareResponse должен содержать только `{trip, cargo}` — без данных бренда или владельца.
> _Источник: `schemas/share.ts`_

---

### 3.7 HOS-симулятор

**HOS-1** (Ubiquitous)
Симулятор должен применять упрощённые FMCSA правила для property-carrying driver:
- средняя скорость 88 км/ч,
- максимум 8 ч непрерывного вождения до обязательного 30-мин перерыва,
- максимум 11 ч вождения за смену,
- 10 ч сна между сменами.
> _Источник: `packages/simulation/hos.ts:3-8`_

**HOS-2** (Event-driven)
Когда у маршрута есть «запас» времени между минимально возможным прибытием и `desiredArrival`, симулятор должен равномерно распределить этот запас по сегментам сна.
> _Источник: `packages/simulation/hos.ts:91-105`_

---

### 3.8 Загрузка файлов

**UPLOAD-1** (Ubiquitous)
Система должна принимать только файлы типов: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
> _Источник: `routes/admin.ts:474`_

**UPLOAD-2** (Ubiquitous)
Максимальный размер файла — 10 МБ; при превышении — 413.
> _Источник: `routes/admin.ts:475`_

**UPLOAD-3** (Ubiquitous)
Система должна хранить файлы с content-addressed ключом: `{sha256}.{ext}`, в поддиректориях `{sha256[0:2]}/`.
> _Источник: `storage/local.ts:13-17, 21-23`_

**UPLOAD-4** (Event-driven)
Если файл с таким же хэшем уже существует, система должна вернуть существующий `uploadId` без повторной записи (idempotent).
> _Источник: `routes/admin.ts:495-515`_

**UPLOAD-5** (Ubiquitous)
URL файлов должен быть хост-относительным (`/uploads/<2char>/<key>`), чтобы не передавать admin-домен на share-страницы.
> _Источник: `storage/local.ts:33-37` (комментарий в коде)_

---

### 3.9 Internal API (Caddy TLS)

**INTERNAL-1** (Event-driven)
Когда Caddy запрашивает `GET /internal/validate-domain?domain=<host>`, система должна вернуть 200 `"ok"` если домен зарегистрирован как `shareDomain` бренда, иначе 404 `"not found"`.
> _Источник: `routes/internal.ts:10-21`_

**INTERNAL-2** (Ubiquitous)
Маршрут `/internal/*` не должен быть доступен публично — только из docker-сети (network isolation).
> _Источник: `routes/internal.ts:8` (комментарий)_

---

### 3.10 Геокодинг-прокси

**GEO-1** (Event-driven)
Когда клиент запрашивает `GET /admin/geocode?q=<query>`, API должен проксировать запрос к Mapbox Geocoding v5, возвращая массив `{label, lng, lat}`.
> _Источник: `routes/admin.ts:105-119`_

**GEO-2** (Ubiquitous)
Mapbox-токен должен оставаться серверным — никогда не передаётся в браузер.
> _Источник: `routes/admin.ts:104` (комментарий)_

---

## 4. Нефункциональные наблюдения

### Безопасность
- Cookie `auth`: `httpOnly=true, sameSite=Lax, secure=isProd` — защита от XSS и CSRF
- Cross-tenant access маскируется под 404, не 403
- Mapbox токен не экспонируется клиенту
- `/internal/*` изолирован на сетевом уровне (docker network)
- Share domain validation на уровне HTTP `Host` заголовка

### Производительность
- Запрос `/share/:hash` делает один JOIN (trips + cargo + brands) через `shareHash` с индексом `trips_share_hash_idx`
- Upload idempotency через `onConflictDoNothing` — без двойной записи
- Pause/resume — атомарные `WHERE`-условия, нет race condition при двойном вызове

### Надёжность
- Env vars с жёстким `required()` — сервер не запустится без обязательных переменных
- HosError возвращает `minimumArrival` — UI может auto-correct desiredArrival

### Ограничения (зафиксированные в коде)
- HOS: rolling 60/70h window не реализован (упрощённая модель)
- Storage: только LocalStorage — нет S3/CDN
- CORS: захардкожен `http://localhost:5173` в dev-режиме

---

## 5. Выведенные acceptance criteria

| ID | Критерий |
|----|---------|
| AC-1 | Dispatch Manager не может получить данные бренда, которым не владеет — возвращается 404 |
| AC-2 | Две параллельные попытки `pause` одного trip дают: одна — 200, другая — 409 |
| AC-3 | Upload одного и того же файла дважды возвращает один `uploadId` |
| AC-4 | Trip с `desiredArrival` менее чем за (distance/88км/ч × HOS-правила) часов до `startedAt` отклоняется с 422 + `minimumArrival` |
| AC-5 | Запрос Share Page с неправильным Host → 421 + redirect URL на корректный домен |
| AC-6 | Share Page не содержит никаких данных об owner или Brand в ответе |
| AC-7 | `POST /auth/login` с несуществующим email и с неверным паролем возвращают одинаковый ответ (timing-safe через bcrypt) |

---

## 6. Неопределённости и вопросы

| # | Вопрос | Где нашёл |
|---|--------|-----------|
| U-1 | Rolling 60/70h HOS window не реализован — допустимо для MVP? | `hos.ts:3` comment |
| U-2 | `STORAGE_ROOT` захардкожен как `./uploads` в dev — как организовано в prod при горизонтальном масштабировании? | `env.ts:17`, `infra/compose.prod.yml` |
| U-3 | Нет rate-limiting на `/auth/login` — защита от brute-force? | `auth/routes.ts` |
| U-4 | `GET /admin/brands/:slug/dns-status` не проверяет, что slug принадлежит текущему user | `routes/admin.ts:78-94` |
| U-5 | `GET /admin/b/:brandSlug/dashboard` возвращает только `{brand}` — предполагается расширение? | `routes/admin.ts:127` |
| U-6 | Нет пагинации для `/admin/b/:brandSlug/cargo` и `/trips` | все list-endpoints |
| U-7 | Файлы удалённого cargo/trip не удаляются из storage (нет cascade delete для uploads) | `routes/admin.ts:213-222` |

---

## 7. Рекомендации

1. **Rate limiting** на `/auth/login` — минимум 5 попыток/мин на IP (U-3)
2. **DNS-status ownership check** — добавить `AND owner_id = user.id` в запрос (U-4)
3. **Пагинация** списков cargo и trips — при росте базы до тысяч записей (U-6)
4. **Storage orphan cleanup** — background job или cascade при удалении cargo/trip (U-7)
5. **S3/compatible storage** — для горизонтального масштабирования (U-2)
6. **CORS config** через env var — убрать hardcode `localhost:5173` (нефункциональные ограничения)
