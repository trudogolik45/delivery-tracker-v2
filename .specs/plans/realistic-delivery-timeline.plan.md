# План: Реалистичный таймлайн доставки через авто-крюк

**Источник:** [`.specs/realistic-delivery-timeline.spec.md`](../realistic-delivery-timeline.spec.md) (Draft v2)
**Статус:** Approved (после spike + adversarial-планирования). Готов к `/agent-skills:build`.
**Происхождение:** синтез двух независимых черновиков (dependency-first / risk-first) + adversarial slice-критик (14 находок учтены).

---

## Принципы исполнения

- **Вертикальные срезы, зелёные на границе среза.** Каждый срез — завершённый путь (schema→sim→api→web→test, насколько применимо), оставляющий систему собираемой/проходящей тесты. Детур — это _фаза_ из юнит-зелёных срезов; сквозная ценность проверяется на **границе фазы** (`curl POST /trips/preview`).
- **One-commit-one-file × TDD.** Внутри среза каждый файл — отдельный коммит; порядок **test→source** (файл теста под новое поведение коммитится первым, он намеренно красный; файл-источник делает зелёным). «Зелёным» система обязана быть на чекпоинте среза, не каждого коммита. Для рефакторов, ломающих существующие тесты (S2), коммит обновлённых фикстур предшествует коммиту источника.
- **TDD-цикл** (`/agent-skills:test`): сначала падающий тест, затем код. Для багов — сначала воспроизводящий тест.
- **Mapbox в тестах всегда замокан** (`vi.mock`) — детерминизм, ноль сетевых вызовов в CI.
- **Старые flat-88 trip'ы валидны без бэкфилла** во всех срезах.
- Conventional commits; squash-merge на PR.

---

## Граф зависимостей

```
S1 (spike, ГЕЙТ) ─────────────┐
                              ├─► S7 (detour.ts) ─┐
S2 → S3 → S4 → S5 ────────────┤                   ├─► S8 (generate.ts) → S9 (api) → S10 (wizard) → S11 (timeline)
S6 (schema) ──────────────────┴───────────────────┘
S4 → S12 (seed)
S1 → S13 (ADR + spec FR-3)
S3 → S11 (fuel-сегменты в таймлайне)
```

**Параллельно сразу:** `{S1, S2, S6}`. **После CP-Gate (S1 зелёный):** `{S7, S13}`. HOS-цепочка `S2→S3→S4→S5` независима от детура.

---

## Фаза 0 — De-risk (гейт)

### S1 · Spike → multi-bump + повторный прогон 🚦

**Срез:** spike (`.specs/spikes/detour-geometry-spike.mjs`). **Зависит:** —
**AC:**

- Генератор переписан с одиночного midpoint-arc на **распределённый multi-bump**: `K` маленьких бугров вдоль коридора, амплитуда каждого `A·sin(π·k/(K+1))`, но **с капом per-bump offset** (напр. ≤ ~150 км), чтобы via не улетали в океан на длинных маршрутах. Длина растёт от числа/частоты бугров, не от амплитуды одного.
- Per-via отбраковка: via с `waypoints[i].distance > SNAP_BAD_M` отбрасывается; если >50% плохих — `NO-SNAP` диагностика, не продолжать.
- `NO-BRACKET` (`f(A_max) < d*`) явно логируется как FR-5 reject-условие, не silent-✗.
- Прогон на 4 коридорах × 1.5/2.0×: LA→NYC 2.0× (был NO-BRACKET) сходится ИЛИ явный INFEASIBLE; Denver→SLC 2.0× в ±2% ИЛИ INFEASIBLE; SF→LA и Memphis→LR — ✓. Итого ≤ ~80 Mapbox-вызовов.
  **Verification:** `MAPBOX_TOKEN=… node .specs/spikes/detour-geometry-spike.mjs` (запускает пользователь через `!`); таблица показывает ✓/явный INFEASIBLE, ноль silent-✗.
  **🚦 CP-Gate:** ≥6/8 пар PASS (или явный обоснованный reject). **Если нет — пересмотр механизма детура до S7.**

---

## Фаза 1 — HOS-ядро (simulation)

### S2 · Truck-скорость

**Срез:** `hos.ts` → `hos.test.ts`. **Зависит:** —
**AC:** `AVG_SPEED_MS` → `TRUCK_AVG_SPEED_MS = GOVERNED_TOP_SPEED × ROAD_CLASS_FACTOR` (≈80 км/ч), именованные экспорты; комментарий `windowLeft` (≈стр.68-70) переписан на скорость-независимость + риск on-duty заправки; фикстуры `hos.test.ts` импортируют новую константу (test-first, красный); новый тест `minimumArrival(truck) > minimumArrival(88)` для 1000 км (AC-3).
**Verification:** `pnpm --filter @delivery/simulation test`, `pnpm typecheck`.

### S3 · Заправки: эмиттер + split

**Срез:** `hos.ts` → `hos.test.ts` + `interpolate.test.ts`. **Зависит:** S2
**AC:** `FUEL_RANGE` (≈2.4e6 м), `FUEL_STOP_DURATION` (2700 с) — именованные; `simulateMinimum` расщепляет driving ровно на `n×FUEL_RANGE`, вставляет `fuel`-rest (`atDist=n×FUEL_RANGE`), driving возобновляется; `fuel` не схлопнут с break/sleep; `2×FUEL_RANGE` → ровно 2 fuel + 3 driving (AC-2); `windowLeft > shiftDriveLeft` в смене с заправкой; **`interpolate.test.ts`: маркер статичен на `atDist` во время заправки** (AC-12, изменений в `interpolate.ts` не требуется).
**Verification:** `pnpm --filter @delivery/simulation test`, `pnpm typecheck`.

### S4 · Time-solver: границы/прыжок/in-gap + `HosError.direction`

**Срез:** `hos.ts` → `hos.test.ts`. **Зависит:** S3
**AC:** обратный солвер `arrival(d)→d*` — closed-form внутри региона + **прыжок** `next_boundary+ε`; «следующая граница» = `min(next shift, next fuel)`; in-gap цель → `boundary-d` (детерминированно, без зацикливания); `HosError` получает `direction:'too_fast'|'too_slow'` + `maximumArrival?`; too-fast по-прежнему даёт `minimumArrival`; `MAX_SOLVER_ITERATIONS=20` — assertion (throws), не silent-guard; тест 10000 км завершается < лимита (AC-6); test-first для in-gap/прыжка.
**Verification:** `pnpm --filter @delivery/simulation test`, `pnpm typecheck`.

### S5 · `distributeSlack` cap + too-slow reject

**Срез:** `hos.ts` → `hos.test.ts`. **Зависит:** S4
**AC:** leftover > `MAX_RESIDUAL_WAIT` (≈2700 с) → `throw HosError(direction:'too_slow', maximumArrival)`; leftover ≤ cap → короткий `wait` (ограничен); **существующий тест большого slack обновлён** ожидать reject вместо гигантского `wait`; сон ∈ `[SLEEP_DURATION, SLEEP_DURATION_MAX]` во всех таймлайнах (AC-1); `desiredArrival==minimumArrival` → zero-slack успех (AC-10 off-by-one).
**Verification:** `pnpm --filter @delivery/simulation test`, `pnpm typecheck`.
**🟢 CP1:** `pnpm --filter @delivery/simulation test` зелёный; старые flat-88 trip'ы валидны.

> S4+S5 тесно связаны (форма `HosError` + reject) — допустимо смержить в один срез, если так чище.

---

## Фаза 2 — Детур (гейт: S1)

### S6 · Схема: `LatLng.generated?` + срез на входе

**Срез:** `trip.ts` (типы → api+web). **Зависит:** —
**AC:** `LatLngSchema.generated?: z.boolean().optional()` (обратносовместимо); `GenerateTripInputSchema` срезает `generated:true` со входа клиента (`.transform`/strip — нельзя подделать); `TripPreviewInput` несёт `generated?` для round-trip preview→create; комментарий про бюджет 25 координат (user-max=10, внутр. до 23); существующие schema-тесты не падают.
**Verification:** `pnpm typecheck`, `pnpm --filter @delivery/schemas test` (или typecheck).

### S7 · `detour.ts` multi-bump + `mapbox.ts`

**Срез:** `detour.ts` (нов.) + `detour.test.ts` (нов., Mapbox мок) + `mapbox.ts`. **Зависит:** **S1 (гейт)**
**AC:** `mapbox.ts`: `alternatives=true`, `exclude=ferry`, обработка NoRoute/исчезнувшего `routes[0]`. `detour.ts` экспортирует `solveTripDistance(...) → { polyline, totalDistance } | { degraded, reason }`: слой-0 alternatives (0 доп. вызовов при попадании); слой-1 multi-bump (`K=min(10, 23−userWaypoints)`, `K=0`→degraded), амплитудная бисекция в `[0, A_max]`; per-via снап-отбраковка (>50% плохих → degraded); брекет-предусловие (`f(A_max)<d*`→degraded, no silent cap); отброс маршрута короче базы (AC-11); `MAX_DETOUR_ITERATIONS=10` cap → degraded+`log()`; бюджет 25 координат; кэш-интерфейс (in-memory Map, geohash-ключ, TTL, swap под Redis). Все тесты — `vi.mock` Mapbox.
**Verification:** `pnpm --filter @delivery/simulation test` (assert: fetch к mapbox.com не вызван), `pnpm typecheck`.

### S8 · `generate.ts` оркестрация + `origin==dest` guard

**Срез:** `generate.ts` + `generate.test.ts` (нов., мок). **Зависит:** S4, S5, S6, S7
**AC:** если есть `generated:true` waypoint → **пропуск солвера**, `getRoute` полного набора + `buildTimeline` (детерминизм preview→create); иначе → база (user-waypoint'ы) → time-solver `d*` → `solveTripDistance` → `buildTimeline`; `degraded` детур → `throw HosError(too_slow, maximumArrival)`; **`origin==dest` guard** (база < 1 м → typed error **до** Mapbox, тест-спай подтверждает Mapbox не вызван, AC-9); Trip удовлетворяет `TripSchema`; polyline-инвариант `Σ(distEnd−distStart)≈totalDistance` (AC-7); ESM `.js`-импорты.
**Verification:** `pnpm --filter @delivery/simulation test`, `pnpm typecheck`, `pnpm build`.

### S9 · `admin.ts` обе ветки 422 + relay

**Срез:** `admin.ts` + `admin.trip-validation.test.ts`. **Зависит:** S5, S6, S8
**AC:** `/trips/preview` и `/trips` ловят `HosError` → плоское 422: `too_fast`→`{error, minimumArrival}`, `too_slow`→`{error, maximumArrival}`; `origin==dest`→422 **до** Mapbox; `generated`-waypoint'ы из тела пробрасываются в `generateTrip`; **мок `HosError` в тесте обновлён** (`direction`+`maximumArrival`), новый тест too-slow 422 + generated round-trip (не зовёт `solveTripDistance`); 400/Zod-путь (`onValidationError`) не тронут.
**Verification:** `pnpm --filter @delivery/api test`, `pnpm typecheck`, `pnpm lint`.
**🟢 CP2:** `pnpm lint && typecheck && test` + `curl POST /trips/preview` (большое окно) → `totalDistance > base`, fuel есть, too-slow→422 `maximumArrival`, too-fast→422 `minimumArrival`, `origin==dest`→422.

---

## Фаза 3 — Web

### S10 · Wizard: обе error-карточки + drift-фиксы

**Срез:** `b.$brandSlug.trips.new.tsx`. **Зависит:** S9
**AC:** `previewError: { message; minimumArrival?; maximumArrival? }`; too-slow карточка «Use latest plausible arrival» → `fetchPreview(maximumArrival)` + запись в `state.desiredArrival`; `fetchPreview` читает `data.maximumArrival`; **clear-on-back** (Step4→3 чистит `preview`+`previewError`); `handleSubmit` шлёт **превьюнутый** `desiredArrival` (не текстовое поле) + `generated`-waypoint'ы из preview; submit disabled при любом error; `interpolate.ts` не тронут.
**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build`, `dev:web` smoke (абсурдно позднее прибытие → появляется карточка).

### S11 · `TripTimeline.tsx` + Step 4

**Срез:** `TripTimeline.tsx` (нов.) + `trips.new.tsx`. **Зависит:** S3, S10
**AC:** разбивка: суммарное driving/break/sleep-время, число заправок+refuel-время, `wait` если >0; доступ к сегментам **type-дискриминированный** (`.filter` по `type`/`reason`), не позиционный; рендер в Step 4 под картой при наличии preview (AC-8); хелперы `formatMiles`/`formatDateTime`, без новых date-зависимостей; smoke: preview маршрута > `FUEL_RANGE` показывает ≥1 fuel.
**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build`.
**🟢 CP3:** `pnpm build` + `dev:web` smoke — таймлайн и обе карточки.

---

## Фаза 4 — Cleanup + docs

### S12 · Чистка `seed-demo-trip.ts`

**Срез:** `seed-demo-trip.ts`. **Зависит:** S4
**AC:** удалить локальные `AVG_SPEED_MS` + дивергентный `buildTimeline`; звать канонический путь (`flatSpeedProfile`-эквивалент/`buildTimeline` из `hos.ts`, без Mapbox-токена); демо-trip по-прежнему создаётся; ноль inline speed-литералов.
**Verification:** `pnpm typecheck`.

### S13 · ADR-0006 + правка спеки FR-3

**Срез:** `docs/adr/0006-detour-multi-bump-car-geometry.md` (нов.) + `.specs/realistic-delivery-timeline.spec.md`. **Зависит:** S1
**AC:** ADR документирует (a) выбор multi-bump над single-arc (доказательства spike), (b) ограничение car-profile геометрии (truck-нелегальные дороги возможны), (c) trade-off со ссылкой на ADR-0002, (d) forward-compat для variable-road-speeds; ADR-0002 **не** переписывается; спека FR-3 обновлена с «single midpoint arc» на multi-bump.
**Verification:** `ls docs/adr/0006-*`, `grep -q multi-bump …`.
**🟢 CP4:** полный `pnpm lint && typecheck && test && build` зелёный.

---

## Константы (defaults — подтверждены в плане, tunable)

| Константа                                    | Значение                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUCK_AVG_SPEED_MS`                         | ≈80 км/ч (22.22 m/s) = `GOVERNED_TOP_SPEED(100) × ROAD_CLASS_FACTOR(0.8)`                                                                                           |
| `FUEL_RANGE` / `FUEL_STOP_DURATION`          | ≈2400 км / 2700 с (45 мин)                                                                                                                                          |
| `MAX_DETOUR_RATIO`                           | 2.0× **soft-guard** (база = Mapbox через user-wp). S1: реальный предел length-bounded (~1.5× при 4476 км); истинная граница эмпирическая — detour `degraded`→reject |
| `MAX_DETOUR_ITERATIONS` / `DETOUR_TOLERANCE` | 10 / ±2%                                                                                                                                                            |
| `MAX_SOLVER_ITERATIONS`                      | 20 (assertion)                                                                                                                                                      |
| `MAX_RESIDUAL_WAIT`                          | ≈45 мин                                                                                                                                                             |
| waypoint budget                              | user-max 10; детур `K=min(10, 23−userWaypoints)`                                                                                                                    |

## Разрешённые «ask first» (вшито в план)

- waypoint-max остаётся **10**, динамический `K`; `K=0`→reject. Снижение до 8 не нужно.
- `origin==dest` guard — в `generateTrip` (→422), не в Zod (иначе 400).
- ADR номер **0006** (существуют 0001–0005).

## S1 gate — результат (закрыт)

Прогон multi-bump spike v2: **7/8 resolved, 56 Mapbox-вызовов → гейт ПРОЙДЕН** (бинарный риск снят). Находки переданы в S7 (`delivery-tracker-v2-4av`):

1. **Достижимый ratio length-bounded** (бюджет 25 координат): ~1.5× при 4476 км, 2× легко при ≤838 км. ⇒ `MAX_DETOUR_RATIO` — soft-guard; реальная граница эмпирическая (`degraded`→FR-5 reject). Не обещать 2× универсально.
2. **`A_CAP` масштабировать с длиной** в S7: `min(~130 км, directDist × FRAC)` — фикс 130 км недолетел на 221 км (Memphis 1.5×→1.42× NEAR).
3. **Снап-отбраковка + multi-side resample обязательны** (SF→LA 2× bad-snap 3161 м). Denver→SLC (горы) — чисто (v1 ломал) ⇒ multi-bump подтверждён.
