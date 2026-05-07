# Documentation Coverage Report

> Сгенерировано в рамках Documentation Sprint (2026-05-07).

---

## API Coverage

| Эндпоинт | Метод | OpenAPI | Inline WHY-comment |
|----------|-------|---------|-------------------|
| `/health` | GET | ✅ | — |
| `/auth/login` | POST | ✅ | — |
| `/auth/logout` | POST | ✅ | — |
| `/auth/me` | GET | ✅ | — |
| `/admin/brands` | GET | ✅ | — |
| `/admin/brands` | POST | ✅ | — |
| `/admin/brands/:slug` | DELETE | ✅ | — |
| `/admin/brands/:slug/dns-status` | GET | ✅ | — |
| `/admin/geocode` | GET | ✅ | — |
| `/admin/b/:slug/dashboard` | GET | ✅ | — |
| `/admin/b/:slug/cargo` | GET | ✅ | — |
| `/admin/b/:slug/cargo` | POST | ✅ | — |
| `/admin/b/:slug/cargo/:id` | GET | ✅ | — |
| `/admin/b/:slug/cargo/:id` | PUT | ✅ | — |
| `/admin/b/:slug/cargo/:id` | DELETE | ✅ | — |
| `/admin/b/:slug/trips` | GET | ✅ | — |
| `/admin/b/:slug/trips` | POST | ✅ | — |
| `/admin/b/:slug/trips/preview` | POST | ✅ | — |
| `/admin/b/:slug/trips/:id` | GET | ✅ | — |
| `/admin/b/:slug/trips/:id` | DELETE | ✅ | — |
| `/admin/b/:slug/trips/:id/pause` | POST | ✅ | ✅ atomic WHERE guard |
| `/admin/b/:slug/trips/:id/resume` | POST | ✅ | — |
| `/admin/b/:slug/uploads` | POST | ✅ | — |
| `/share/:hash` | GET | ✅ | ✅ 421 vs 302 |
| `/internal/validate-domain` | GET | ✅ | — |

**API Coverage: 25/25 эндпоинтов (100%)**

---

## Schemas Coverage

| Схема | OpenAPI | Источник |
|-------|---------|---------|
| LatLng | ✅ | `schemas/trip.ts` |
| LineString | ✅ | `schemas/trip.ts` |
| PauseInterval | ✅ | `schemas/trip.ts` |
| DrivingSegment | ✅ | `schemas/trip.ts` |
| RestSegment | ✅ | `schemas/trip.ts` |
| Segment (discriminated union) | ✅ | `schemas/trip.ts` |
| Trip | ✅ | `schemas/trip.ts` |
| TripListItem | ✅ | `schemas/trip.ts` |
| TripAdmin | ✅ | `schemas/trip.ts` |
| GenerateTripInput | ✅ | `schemas/trip.ts` |
| TripPreviewInput | ✅ | `schemas/trip.ts` |
| Brand | ✅ | `schemas/brand.ts` |
| BrandCreate | ✅ | `schemas/brand.ts` |
| BrandDnsStatus | ✅ | `schemas/brand.ts` |
| Cargo / CargoWithPhotos | ✅ | `schemas/cargo.ts` |
| CargoCreate / CargoUpdate | ✅ | `schemas/cargo.ts` |
| ShareResponse / CargoPublic | ✅ | `schemas/share.ts` |
| UploadResponse | ✅ | `schemas/upload.ts` |
| LoginInput / LoginResponse | ✅ | `schemas/auth.ts` |
| UserPublic / MeResponse | ✅ | `schemas/auth.ts` |

**Schema Coverage: 20/20 (100%)**

---

## Architecture Documentation

| Артефакт | Файл | Статус |
|----------|------|--------|
| Системная диаграмма (Mermaid) | `docs/architecture/README.md` | ✅ |
| Поток создания Trip (sequence) | `docs/architecture/README.md` | ✅ |
| Поток Share Page (sequence) | `docs/architecture/README.md` | ✅ |
| ER-диаграмма | `docs/architecture/README.md` | ✅ |
| Monorepo DAG | `docs/architecture/README.md` | ✅ |
| Дрейф architecture vs код | — | ✅ Исправлен inline в `docs/architecture/README.md` |

---

## ADR Coverage

| ADR | Файл | Решение |
|-----|------|---------|
| 0001 | `docs/adr/0001-brand-ownership-model.md` | Brand ownership (owner_id RESTRICT) |
| 0002 | `docs/adr/0002-precomputed-trip-timeline.md` | Pre-computed HOS timeline |
| 0003 | `docs/adr/0003-content-addressed-storage.md` | SHA256-addressed uploads |
| 0004 | `docs/adr/0004-jwt-cookie-auth.md` | JWT в httpOnly cookie |
| 0005 | `docs/adr/0005-share-domain-host-enforcement.md` | 421 + Host enforcement |

---

## Spec Miner Output

| Артефакт | Файл | Статус |
|----------|------|--------|
| Обратная спецификация (EARS) | `specs/delivery_tracker_reverse_spec.md` | ✅ Создан |
| 40+ требований EARS-формата | — | ✅ |
| 7 неопределённостей (U-1..U-7) | — | ✅ |
| 5 рекомендаций | — | ✅ |

---

## Inline Comments (non-obvious WHY)

| Файл | Строка | Комментарий |
|------|--------|-------------|
| `apps/api/src/routes/admin.ts` | ~340 | Atomic pause guard in WHERE — prevents double-pause race condition |
| `apps/api/src/routes/share.ts` | ~38 | 421 vs 302 — server doesn't know protocol, client constructs HTTPS redirect |
| `apps/api/src/routes/internal.ts` | 8 | Network-isolated, Caddy-only access (existing) |
| `apps/api/src/storage/local.ts` | 33 | Host-relative URL — prevents admin host leaking to share pages (existing) |
| `apps/api/src/index.ts` | 22 | Dev-only static serving comment (existing) |

---

## OpenAPI Validation

```
✅ docs/api/openapi.yaml: validated in 68ms
✅ No errors
⚠️  4 warnings (operation-4xx-response: /health, /auth/logout — intentional)
```
