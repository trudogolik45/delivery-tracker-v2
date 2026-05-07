# Delivery Tracker — Roadmap

Читать вместе с [`docs/architecture/README.md`](architecture/README.md) и [`docs/runbook.md`](runbook.md).

**Принцип построения:** фундамент → вертикальная полоска → симулятор → админка → production. Каждая milestone заканчивается точкой синхронизации, где разные системы сходятся на одном контракте.

---

## Статус milestone'ов

| Milestone | Статус |
|-----------|--------|
| M0: Scaffold | ✅ |
| M1: Foundation (БД, auth, tenant middleware) | ✅ |
| M2: Share-страница на хардкод-таймлайне | ✅ |
| M3: HOS-симулятор | ✅ |
| M4: Storage abstraction + uploads | ✅ |
| M5: Админка целиком | ✅ |
| M6: Production deploy | ✅ |

---

## Глобальные архитектурные решения

### Tenant-резолвер
- Админка: бренд из path `/admin/b/:brandSlug/...` → middleware `requireAdminBrand`.
- Share: бренд из `Host`-заголовка → middleware `requireShareBrand`.
- Эндпоинты `/admin/settings` (список брендов) не требуют brand-context.

### Auth
- Таблица `users` (email, passwordHash). JWT с `userId`, без ролей.
- Любой залогиненный имеет доступ ко всем брендам.
- Регистрация только через CLI: `pnpm --filter @delivery/api seed-admin`.
- Argon2id (OWASP-рекомендован), JWT в HTTP-only cookie, SameSite=lax.

### Формат timeline
Тип `Trip` / `Segment[]` живёт в одном месте: `packages/schemas/src/trip.ts`. Изменение типа = breaking change во всех потребителях (generate, interpolate, БД, share, admin preview).

### Storage
Никто, кроме `apps/api/src/storage/`, не знает как хранятся файлы. Все слои видят только `storageKey: string`. Миграция на R2 = новая реализация интерфейса + переключение env.

---

## Приоритетная карта critical syncs

| Контракт | Где живёт | Кто потребляет |
|----------|-----------|----------------|
| `Brand` (тип) | `packages/schemas/src/brand.ts` | api middleware, web `useBrand`, Caddy validate-domain |
| `Trip` + `Segment[]` | `packages/schemas/src/trip.ts` | generate, interpolate, БД, share, admin preview |
| `Storage.url(key)` | `apps/api/src/storage/types.ts` | все, кто отдаёт файлы наружу |
| `brandSlug` в URL | TanStack Router params + Hono path-params | админка, tenant middleware |
| `Host`-резолвер | `requireShareBrand` middleware | share-эндпоинт, validate-domain |

---

## За пределами roadmap

Сознательно не включено, делать **только по реальному запросу**:

- R2/S3 миграция — volume справляется
- Realtime обновления share-страницы — таймлайн детерминированный
- Управление поездкой (delay, cancel) — нужен сценарий
- Multi-language — все клиенты в US/Canada
- Analytics для админа
- Email-нотификации клиенту
- API для клиентов (программный доступ к статусу)
- Audit log — добавим если несколько админов начнут конфликтовать
