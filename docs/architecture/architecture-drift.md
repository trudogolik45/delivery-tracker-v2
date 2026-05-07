# Architecture Drift Log

> Расхождения между `ARCHITECTURE.md` (проектные решения) и реальным состоянием кода на 2026-05-07.
> Не ошибки — зафиксированный дрейф. Синхронизировать при следующем редактировании ARCHITECTURE.md.

---

## Файловая структура API (схема vs реальность)

| ARCHITECTURE.md | Реальный путь в коде |
|-----------------|---------------------|
| `routes/trips.ts` | Не существует; логика trips в `routes/admin.ts` |
| `routes/public.ts` | Не существует; это `routes/share.ts` |
| `routes/uploads.ts` | Не существует; uploads endpoint в `routes/admin.ts` brandScoped |
| `routes/health.ts` | Не существует; `GET /health` — анонимный обработчик в `index.ts` |
| `services/tripService.ts` | Не существует; нет слоя services, логика прямо в routes |
| `services/brandService.ts` | Не существует |
| `services/uploadService.ts` | Не существует |

## Схема БД

| Поле | ARCHITECTURE.md | Реальная schema.ts |
|------|-----------------|-------------------|
| `brands.owner_id` | Отсутствует в схеме-эскизе | Присутствует `NOT NULL REFERENCES users(id) RESTRICT` |
| `trips.pauses` | Отсутствует | Присутствует `jsonb NOT NULL DEFAULT '[]'` |
| `cargo.photoKeys` | `photoKeys: text[]` | Реально `photoUploadIds: uuid[]` (ссылки на `uploads.id`) |
| `uploads` таблица | Не упомянута в эскизе | Существует: `{id, storageKey, mimeType, sizeBytes, sha256, createdAt}` |

## Storage фабрика

| ARCHITECTURE.md | Реальность |
|-----------------|-----------|
| `STORAGE_DRIVER` env var → фабрика | `storage/index.ts` всегда создаёт `new LocalStorage(env.STORAGE_ROOT)`. STORAGE_DRIVER не реализован |
| `R2Storage` класс упомянут | Не существует |
| `STORAGE_PUBLIC_BASE_ADMIN` env var | Не существует; URL host-relative, не абсолютный |

## CORS

| ARCHITECTURE.md | Реальность |
|-----------------|-----------|
| Не упомянут | `index.ts`: `cors({ origin: 'http://localhost:5173', credentials: true })` захардкожен |

## Пакет simulation — экспорты

| ARCHITECTURE.md | Реальность |
|-----------------|-----------|
| `exports: { "./generate", "./interpolate", "./types" }` | Нет `./types` — типы живут в `@delivery/schemas` |
| `geo.ts` файл упомянут | Не существует |

---

_Создан Architecture Designer в рамках Documentation Sprint._
