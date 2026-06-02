# SPEC: Реалистичный таймлайн доставки через авто-крюк

**Статус:** Draft v2 (после adversarial-верификации; ожидает подтверждения → `/agent-skills:plan`)
**Scope:** `packages/simulation`, `packages/schemas`, `apps/api` (generate/preview path + seed), `apps/web` (wizard создания trip'а)
**Связанные артефакты:** `.specs/plans/variable-road-speeds-hos.design.md` (отдельный, последующий таск), `docs/adr/0002-precomputed-trip-timeline.md`
**История ревизии:** v2 вплавляет находки 4-агентного adversarial-прохода (geometry/time-solver/completeness/codebase-grounding) — см. §13.

---

## 1. Objective и целевые пользователи

### Проблема

HOS-симулятор (`packages/simulation/src/hos.ts`) считает **минимально-возможный** таймлайн по прямому Mapbox-маршруту на плоской скорости 88 км/ч, а разницу до желаемого прибытия поглощает `distributeSlack()` — раздувая сон до 14 ч и добавляя **финальный `wait`-сегмент в точке выгрузки**. На карте трак доезжает и «стоит» оставшееся время. Пользователи жалуются на нереалистичный срок доставки.

### Цель

Пользователь задаёт **origin, destination и желаемое время доставки** (+ опц. обязательные waypoint'ы). Приложение **без ручного вмешательства** достраивает физический «крюк» (авто-waypoint'ы), удлиняющий реальный маршрут так, чтобы доставка естественно заняла нужное время за счёт реалистичной truck-скорости, HOS-перерывов/сна и заправок — трак **всегда правдоподобно едет**. Затем показывает предполагаемый маршрут и таймлайн с разбивкой по сегментам.

### Целевые пользователи

Бренд-администраторы (`requireAdminBrand`) через wizard `apps/web/src/routes/admin/b.$brandSlug.trips.new.tsx`. Получатели share-страниц выигрывают косвенно.

---

## 2. Принятые решения (зафиксировано с пользователем)

| #   | Решение                             | Выбор                                                                                                               |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Q1  | Механизм заполнения окна            | **Крюк primary + отдых fallback**                                                                                   |
| Q2  | Что блокировать                     | **Min + max (детур-кап)**                                                                                           |
| Q3  | Профиль скорости                    | **Фиксированный truck-профиль** (не параметризуется грузом)                                                         |
| Q4  | Связь с `variable-road-speeds-hos`  | **Независимо, поверх плоской скорости** (forward-compat для per-band)                                               |
| Q5  | Остаточный idle, не закрытый крюком | **Ограниченный `wait` (`MAX_RESIDUAL_WAIT`) + ранний `reject` через `maximumArrival`**                              |
| Q6  | Глубина truck-маршрутизации         | **Геометрия легковушки (Mapbox car) + truck-профиль только для скорости/таймлайна.** Известное ограничение (см. §7) |

---

## 3. Константы (defaults; финализировать в `/plan`)

| Константа                    | Default               | Обоснование                                                                                                           |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TRUCK_AVG_SPEED_MS`         | ≈ 80 км/ч (22.22 m/s) | Пониженная door-to-door truck-average vs 88 км/ч легковушки. Выводится как `GOVERNED_TOP_SPEED × ROAD_CLASS_FACTOR`.  |
| `GOVERNED_TOP_SPEED`         | ≈ 100 км/ч (62 mph)   | Типичный governed limiter тяжёлого трака. Forward-compat для per-band derate.                                         |
| `ROAD_CLASS_FACTOR`          | ≈ 0.8                 | Усреднённая потеря на город/уклон/трафик. При variable-road-speeds станет per-band.                                   |
| `FUEL_RANGE`                 | ≈ 2400 км (~1500 mi)  | Запас хода с прицепом. При 880 км/смену → заправка раз в ~2.7 смены (≤1 на смену).                                    |
| `FUEL_STOP_DURATION`         | ≈ 45 мин              | Заправка + оплата + манёвр.                                                                                           |
| `MAX_DETOUR_RATIO`           | 2.0×                  | Маршрут ≤ ratio × **базы** (база = Mapbox-маршрут через user-waypoint'ы, см. FR-3).                                   |
| `MAX_DETOUR_ITERATIONS`      | 10                    | Бюджет Mapbox-вызовов/латентности на preview (~2–6 с). `ceil(log2(range/tol))≈6` в гладком случае + запас.            |
| `DETOUR_TOLERANCE`           | ±2 % от `d*`          | Точность сходимости длины маршрута.                                                                                   |
| `MAX_SOLVER_ITERATIONS`      | 20                    | Backstop временного солвера (регионов ≤ ~15 на 10000 км конверте). Assertion, не тихий guard.                         |
| `MAX_RESIDUAL_WAIT`          | ≈ 45 мин              | Порог терминального `wait`: меньше — правдоподобное ожидание окна выгрузки; больше — `reject` через `maximumArrival`. |
| `MAX_ARRIVAL_WINDOW_SECONDS` | 14 дней (есть)        | Жёсткий backstop сверху.                                                                                              |

---

## 4. Функциональные требования

### FR-1. Truck-профиль скорости

- Заменить `AVG_SPEED_MS = 88_000/3600` на `TRUCK_AVG_SPEED_MS` (единственное место truck-константы, как `flatSpeedProfile` в `variable-road-speeds-hos.design.md`).
- Forward-compat: структура `GOVERNED_TOP_SPEED × ROAD_CLASS_FACTOR` такая, чтобы per-band derate (`min(GOVERNED_TOP_SPEED, mapboxBandSpeed) × factor`) приземлился без переписывания солвера.
- **Инвариант `windowLeft` скорость-независим:** `shiftDriveLeft (3 ч) < windowLeft (5.5 ч)` — чисто временны́е константы, скорость сокращается. Снижение 88→80 км/ч его НЕ меняет. Исправить вводящий в заблуждение комментарий `hos.ts:68-70`, явно отметив скорость-независимость и что фактор риска — только on-duty не-driving вставки (заправка).

### FR-2. Заправки (`fuel`-сегменты)

- `RestSegmentSchema.reason` **уже** допускает `'fuel'`; достроить эмиттер в `simulateMinimum`.
- **Расщепление driving-сегмента:** при пересечении порога `n × FUEL_RANGE` посреди driving-фазы — driving-сегмент завершается ровно в точке порога (`distEnd = distStart + (n×FUEL_RANGE − distStart)`), вставляется `fuel`-rest с `atDist = n×FUEL_RANGE`, затем driving возобновляется. Не вставлять заправку на ближайшей фазовой границе — иначе маркер «едет» во время заправки (ломает `interpolatePosition`).
- `fuel` не схлопывать с `break`/`sleep` (разные duty-статусы), даже при совпадении момента.
- Заправка добавляет on-duty время → `windowLeft` падает до 4.75 ч (всё ещё > 3 ч). Тест-инвариант: `windowLeft > shiftDriveLeft` для каждой смены, включая смены с заправкой.

### FR-3. Авто-крюк — геометрический солвер (multi-via arc, LOCKED)

> **Решено** после adversarial-верификации + grounding по докам Mapbox. **Отвергнуты:** «один offset + бисекция» (единичный снап в воду = плато/non-монотонная `f(offset)`); **Isochrone-подход** (cap 60 мин — мал для много-часовых детуров + лицензия «только на Mapbox-карте»); расчёт только на **`alternatives`** (альтернативы похожей длины, не 1.5–2×). **Принят: parametric multi-via arc + амплитудная бисекция.**

**Grounded Mapbox-факты (Context7 `/websites/mapbox`):** Directions ≤ **25 координат**/запрос → бюджет на ~10–20 via-точек; `exclude=ferry` (избегать паромов); `radiuses`/`approaches`/`bearings` контролируют снап; `waypoints[i].distance` в ответе = насколько точку оттащило на дорогу (детектор плохого снапа в воду/off-road). Truck-профиля в Directions нет (Q6/FR-7).

**База для `MAX_DETOUR_RATIO`** = длина Mapbox-маршрута через **только user-waypoint'ы** (origin → user wp → destination). Крюк измеряет дистанцию авто-точек сверх того, на что пользователь уже согласился. Если user-маршрут уже > `MAX_DETOUR_RATIO × straight_OD` — крюк не нужен/невозможен, идём в fallback/reject.

Целевая дистанция `d*` приходит из временного солвера (FR-4). Построить маршрут длины ≈ `d*`:

1. **Слой 0 — alternatives (0 доп. вызовов):** `getRoute(alternatives=true)`; если длиннейшая альтернатива в пределах `DETOUR_TOLERANCE` от `d*` — взять её, без синтетики. (Покрывает только малые `d*`.)
2. **Слой 1 — distributed multi-bump arc + амплитудная бисекция (ОСНОВНОЙ механизм):**
   > **Уточнено spike'ом (S1):** одиночный полусинус-«бугор» `A·sin(π·t)` НЕ масштабируется на длинные маршруты — на LA→NYC 2× амплитуда одного бугра становится географически абсурдной (via в океане/Канаде), spike дал `NO-BRACKET` (achieved 1.00×). Замена — **много малых бугров**.
   - `NBUMPS` бугров на одной стороне: `off(t_k) = side · A · |sin(π · NBUMPS · t_k)|`, амплитуда `A` ограничена `A_CAP` (≈100–150 км/via) → via остаётся у дороги, снап чистый. **Длина растёт от числа бугров**, не от амплитуды одного.
   - Двухуровневый поиск: бисекция по `A ∈ [0, A_CAP]` при фиксированном `NBUMPS`; если `f(A_CAP) < d*` — увеличить `NBUMPS` (в пределах бюджета `K ≤ 23 − userWaypoints` via, `K ≈ NBUMPS × 2–3`) и повторить.
   - **Истинная недостижимость** (`d*` не берётся даже при max `NBUMPS` + `A_CAP` — напр. 2× на трансконтинентальном маршруте) → INFEASIBLE → FR-5 reject (`maximumArrival`), не silent-✗. Spike измеряет, где проходит эта граница (реальный достижимый `MAX_DETOUR_RATIO` как функция длины).
   - `K` via-точек на долях `t_k = k/(K+1)`.

**Эмпирический гейт:** форма multi-bump и достижимые ratio подтверждаются прогоном S1; **финальная формулировка FR-3 фиксируется в S13 после re-run** (текущий блок — design-intent, не верифицирован).

**Защитные правила (anti-silent-wrong):**

- **Снап-валидация:** если `max(waypoints[i].distance)` выше порога (точка села далеко = вода/off-road) — отбраковать/сдвинуть эту via; при многих плохих — уменьшить `K` или пересэмплировать. Всегда `exclude=ferry`.
- `routes[0]` исчез / `data.message` (NoRoute) → итерация несошедшаяся, продолжить бисекцию/пересэмпл, **не crash**.
- Отбрасывать маршрут короче базового (регрессия снапа).
- После бисекции: `|length − d*|/d* > DETOUR_TOLERANCE` → **`log()` деградацию** и fallback (FR-5); не использовать молча (no silent caps).
- Бюджет координат Mapbox = **25** (origin + destination + via). User-waypoint'ы capped, чтобы оставить место авто-via (FR-6).

**Кэш:** ключ `(origin_geohash, destination_geohash, desiredArrival_bucket)`, TTL (in-memory Map в dev/тестах, swap-интерфейс под Redis в prod). Per-preview латентный бюджет ≤ 5 с.

**Feasibility-gate (обязателен до полной реализации):** прогнать `.specs/spikes/detour-geometry-spike.mjs` (dependency-free node, читает `MAPBOX_TOKEN` из env) на реальных коридорах (LA→NYC, побережье SF→LA, горы Denver→SLC, переход через р. Миссисипи) при `d* = 1.5×/2.0×` — подтвердить % сходимости и число Mapbox-вызовов. Риск понижен с бинарного («работает ли концепт») до тюнингового («какие `K`/tolerance»), но эмпирически закрывается только этим прогоном.

### FR-4. Авто-крюк — временной солвер (корректность)

> `arrival(d)` (конец таймлайна как функция дистанции) — монотонно **не-убывающая со ступенями**, НО со скачками. Солвер обязан их учитывать.

- **Две границы скачков:** (а) граница смены каждые `shiftDist` (~880 км при 80 км/ч) → скачок `+SLEEP_DURATION` (10 ч); (б) граница заправки каждые `FUEL_RANGE` → скачок `+FUEL_STOP_DURATION` (45 мин). «Следующая граница» = `min(next shift, next fuel)`.
- **Closed-form внутри региона:** `d* = d_lo + (desiredArrival − arrival(d_lo)) × TRUCK_AVG_SPEED_MS`, валидно только пока `d*` не пересекает ближайшую границу.
- **Шаг через границу = ПРЫЖОК** `d = next_boundary + ε` (не +1 м!). Инкрементальный шаг = 880 000 итераций на одну границу = катастрофа. Guard `MAX_SOLVER_ITERATIONS` как assertion.
- **Детект недостижимых целей:** `desiredArrival` внутри полуинтервала скачка `[arrival(boundary), arrival(boundary)+jump)` недостижим никакой дистанцией. Поведение: вернуть `d = boundary` (ближайшая дистанция, чьё arrival ≥ desiredArrival минус остаток), остаток ≤ `MAX_RESIDUAL_WAIT` → короткий `wait`; иначе → `reject` (FR-5).
- **Термирование** доказуемо: каждая итерация либо решает в регионе, либо строго продвигает `d` за одну границу; регионов ≤ ~15 на 10000 км конверте.

### FR-5. Границы реализма (min/max) и fallback

- **Min (есть, теперь на truck-скорости):** `arrival(база) > desiredArrival` → `HosError(direction:'too_fast', minimumArrival)` → 422.
- **Крюк primary:** до `MAX_DETOUR_RATIO` трак реально едет.
- **Fallback (Q5) = ограниченный wait + ранний reject:** остаточный idle (из недостижимых скачков ИЛИ из упора в детур-кап), не покрытый driving:
  - ≤ `MAX_RESIDUAL_WAIT` → короткий терминальный `wait` (правдоподобно: ожидание окна выгрузки).
  - > `MAX_RESIDUAL_WAIT` → **`reject`** с `HosError(direction:'too_slow', maximumArrival)`, где `maximumArrival` = позднейшее достижимое прибытие (детур на капе + полный HOS + `MAX_RESIDUAL_WAIT`). Зеркало текущего `minimumArrival`.
  - НЕ раздувать сон/`wait` неограниченно (старое поведение `distributeSlack` с 14-ч сном + длинным `wait` — именно то, что устраняем). `distributeSlack` остаётся для **малого** остатка (≤ headroom сна), но его терминальный `wait` теперь ограничен порогом, иначе reject.
- Сохранить `MAX_ARRIVAL_WINDOW_SECONDS` (14 дней) как жёсткий backstop.

### FR-6. Контракт API и схемы (`@delivery/schemas`)

- **Представление ошибки:** расширить `HosError` полями `direction: 'too_fast' | 'too_slow'` и `maximumArrival?: number` (в дополнение к `minimumArrival`). Хендлеры `/trips/preview` и `/trips` в `admin.ts` эмитят 422 с **плоским** телом `{ error, minimumArrival? , maximumArrival? }` (тело крафтится в хендлере — `onValidationError` отвечает за 400/Zod, не за 422; см. §13).
- **Флаг `generated`** (решено сейчас, не «ask first»): добавить `generated?: boolean` в `LatLngSchema` — обратносовместимо (`undefined === false` для старых записей). `GenerateTripInputSchema` на входе **срезает** `generated:true` от клиента (нельзя подделать). Обновить все схемы, встраивающие `LatLngSchema` (`GenerateTripInput`, `TripPreviewInput`, `TripAdmin`).
- **preview→create без re-solve:** preview возвращает trip с уже разрешёнными waypoint'ами (включая `generated:true`). Wizard шлёт их обратно в `POST /trips`; сервер, видя `generated`-точки, **пропускает солвер** и детерминированно ре-роутит весь набор через `getRoute` + `buildTimeline` (один вход Mapbox → один выход = совпадает с preview). Если `generated`-точек нет, а окно требует крюк — create сам запускает солвер (graceful).
- **Waypoint-бюджет:** `.max(10)` относится к **user**-waypoint'ам (вход). Полный внутренний массив (user + авто) ограничен бюджетом Mapbox 25 координат. Либо снизить user-max до 8, либо отдельный внутренний тип без `.max(10)`. Документировать 25 как потолок.
- **Polyline-инвариант:** `trip.polyline` = полная геометрия детур-маршрута; `Σ(distEnd − distStart) по driving-сегментам == totalDistance` (в пределах float-допуска). `totalDistance` из той же геометрии (как в `mapbox.ts`).
- **DB:** миграция НЕ нужна — `waypoints`/`timeline`/`route_geometry` уже `jsonb` (`schema.ts:72,76,77`).

### FR-7. Truck-маршрутизация (известное ограничение, Q6)

- Геометрия — Mapbox `mapbox/driving` (car-профиль). Truck-профиль применяется ТОЛЬКО к скорости/таймлайну (FR-1, HOS, заправки).
- **Документировать ограничение:** геометрия может теоретически проходить по truck-запрещённым дорогам (низкие мосты, вес, hazmat). Для «грубого трекера» (ADR-0002) приемлемо. Зафиксировать в **новом ADR** (дополнение к ADR-0002) и в release-notes.
- Не вводить HERE/TomTom/Nav SDK (вне scope, Q6).

### FR-8. UI wizard и таймлайн-визуализация

- Step «Route»: origin/destination + опц. user-waypoint'ы (ограничения). Step «Time»: departure + desired arrival.
- **`previewError` state** расширить до `{ message: string; minimumArrival?: number; maximumArrival?: number }`. Рендерить карточку по присутствующему полю:
  - too-fast → существующая «Use minimum arrival time» (`fetchPreview(minimumArrival)`).
  - too-slow → зеркальная «Use latest plausible arrival» (`fetchPreview(maximumArrival)`, пишет `toLocalDatetime(new Date(maximumArrival*1000))` в `state.desiredArrival`).
  - `handleSubmit` disabled, пока есть любой error.
- **Drift-фиксы:** возврат на Step 3 **очищает** `preview` и `previewError`; `handleSubmit` шлёт `desiredArrival`, реально использованный в последнем успешном `fetchPreview` (не текстовое поле, которое могли отредактировать без ре-превью) + разрешённые `generated`-waypoint'ы из preview.
- **Таймлайн-разбивка (AC-8):** компонент `TripTimeline.tsx` (обязателен для Step 4) показывает: суммарное driving-время, break-время, sleep-время, число заправок + суммарное refuel-время, наличие/длительность `wait`. Формат — горизонтальная полоса/список с легендой по типам (drive/break/sleep/fuel/wait).
- **Карта:** `TripMap` рендерит полную детур-полилинию (как сейчас, один слой). Визуальное выделение авто-крюк-арки — опционально (отдельный цвет по `generated`-точкам).

---

## 5. Acceptance criteria

- AC-1: При `desiredArrival` строго между `minimumArrival` и максимумом — preview даёт trip, где `Σ driving-дистанций > базовой` (крюк физически есть), последний сегмент кончается на `desiredArrival`, **длительности сна ∈ [SLEEP_DURATION, SLEEP_DURATION_MAX]** (не пост-хок раздуты сверх).
- AC-2: ≥1 `fuel`-сегмент для маршрутов длиннее `FUEL_RANGE`; `fuel` не схлопнут; driving расщеплён в точке заправки.
- AC-3: `minimumArrival(truck) > minimumArrival(88 км/ч)` для репрезентативной дистанции.
- AC-4: too-fast → 422 `{ minimumArrival }` (`direction:'too_fast'`); too-slow сверх `MAX_RESIDUAL_WAIT` → 422 `{ maximumArrival }` (`direction:'too_slow'`); оба — целые секунды, безопасные для повторной подачи.
- AC-5: Геометрический солвер сходится в `DETOUR_TOLERANCE` за ≤ `MAX_DETOUR_ITERATIONS` Mapbox-вызовов ИЛИ логирует деградацию и идёт в fallback (никаких бесконечных циклов, тихих неверных маршрутов, неограниченных Mapbox-расходов).
- AC-6: Временной солвер: недостижимая (in-gap) цель обработана детерминированно (boundary-`d` + ограниченный `wait` или reject), НЕ зацикливается; шаг через границу — прыжком.
- AC-7: Инварианты таймлайна: temporal contiguity (`tStart[i]==tEnd[i-1]`), финальный `tEnd == desiredArrival`, монотонная дистанция, `atDist` rest = предыдущий `distEnd`, последний `distEnd == totalDistance`, каждый сегмент валиден против `SegmentSchema`.
- AC-8: Step 4 показывает разбивку таймлайна по типам с длительностями (см. FR-8).
- AC-9: `origin == destination` (Mapbox distance 0) → 422 с ясной ошибкой **до** генерации (иначе пустой `segments` ломает `TripSchema.min(1)` → 500).
- AC-10: `desiredArrival == minimumArrival` (эхо-значение) → успех с zero-slack таймлайном, `tEnd == desiredArrival`; покрыть off-by-one из `Math.ceil(minArrival)`.
- AC-11: Детур-бисекция детектит non-монотонный/figure-8 результат (длина вне брекета или < базы) и отвергает его, пробуя другой азимут.
- AC-12: Старые trip'ы (плоские-88) валидны без бэкфилла; `interpolate.ts` читает их без изменений.
- AC-13: Share-response JSON ≤ заданного байт-бюджета (напр. 200 KB) с детур-полилинией + всеми сегментами.

---

## 6. Project structure (затрагиваемые файлы)

```
packages/simulation/src/
  hos.ts            # TRUCK_AVG_SPEED_MS, fuel-эмиттер+split, временной солвер (границы/прыжок/in-gap), HosError direction/maximumArrival, ограниченный fallback
  detour.ts (нов.)  # multi-via arc + амплитудная бисекция; alternatives layer-0; снап-валидация; кэш-интерфейс
  mapbox.ts         # getRoute: alternatives=true, exclude=ferry; обработка NoRoute/исчезнувшего routes[0]; (annotations — НЕ здесь, это variable-road-speeds)
  generate.ts       # оркестрация: solve d* → detour → buildTimeline; пропуск солвера при generated-waypoint'ах
  hos.test.ts       # truck-скорость, fuel split, границы/in-gap/прыжок, min/max, инварианты
  detour.test.ts    # (нов.) multi-via arc сходимость/снап-валидация/деградация (Mapbox замокан, детерминизм)
packages/schemas/src/
  trip.ts           # LatLng.generated?; maximumArrival в 422-контракте; waypoint-бюджет
apps/api/src/
  routes/admin.ts                   # 422 в обе стороны; пропуск солвера при generated; origin==dest guard
  routes/admin.trip-validation.test.ts  # HosError mock с maximumArrival; обе ветки 422
  scripts/seed-demo-trip.ts         # удалить дивергентный buildTimeline+AVG_SPEED_MS, звать canonical с flatSpeedProfile-эквивалентом
apps/web/src/
  routes/admin/b.$brandSlug.trips.new.tsx  # previewError обе стороны; clear-on-back; submit previewed; generated-waypoint'ы
  components/TripTimeline.tsx (нов.)        # разбивка сегментов
  components/TripMap.tsx                     # (опц.) выделение крюк-арки
.specs/spikes/
  detour-geometry-spike.mjs (есть)          # feasibility-gate: multi-via arc на реальных коридорах (dependency-free, читает MAPBOX_TOKEN)
```

**DAG:** `schemas → simulation → apps/{api,web}` соблюдён. Детур-солвер — в `@delivery/simulation/generate` (Node/Mapbox), не в браузерном `interpolate`.

---

## 7. Commands (из проекта)

| Задача                   | Команда                                              |
| ------------------------ | ---------------------------------------------------- |
| Тесты simulation         | `pnpm --filter @delivery/simulation test`            |
| Тесты API                | `pnpm --filter @delivery/api test`                   |
| Lint / Typecheck / Build | `pnpm lint` / `pnpm typecheck` / `pnpm build` (`-r`) |
| Dev web (wizard)         | `pnpm dev:web`                                       |
| Postgres dev             | `docker compose up -d`                               |

---

## 8. Code style (из `.claude/rules/` + новое)

- TS strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`), `ES2022`. Zod v4 top-level хелперы. API ESM `.js`-импорты; `import type`.
- Общие схемы — в `@delivery/schemas`, не локально. Drizzle pin `^0.45`.
- Conventional commits, **один коммит — один файл**, маленькие PR (p50 ≈ 118 строк) — резать на тонкие вертикальные срезы.
- **НОВОЕ — доступ к сегментам только type-дискриминированный** (`.find`/`.filter` по `type`/`reason`), не позиционный (`segments[1]`). `tripStatus()` уже так делает (проверено) — закрепить как правило, чтобы вставка `fuel` ничего не сломала.
- Все «магические» числа — именованные константы (§3); ноль inline-литералов скоростей/порогов в логике.

---

## 9. Testing strategy (Vitest 4, `*.test.ts` рядом)

- **simulation:** truck-скорость (медленнее 88); fuel split (`2×FUEL_RANGE` → ровно 2 fuel + 3 driving, `atDist`=FUEL_RANGE/2×); границы (`min(shift,fuel)`), in-gap цель, шаг-прыжок, `MAX_SOLVER_ITERATIONS`; min/max reject; `windowLeft>shiftDriveLeft` с заправкой; инварианты (contiguity/терминус/монотонность).
- **detour.test.ts (Mapbox замокан):** слой-0 alternatives попал; multi-via arc side-выбор по снап-дистанции; bad-snap via отбракована; брекет-предусловие fail → fallback (не итерирует); non-монотонная последовательность → деградация; маршрут < базы отброшен.
- **interpolate.test.ts:** добавить trip с `fuel`-сегментом — маркер статичен на `atDist` во время заправки.
- **API (`admin.trip-validation.test.ts`):** обновить `HosError` mock полем `maximumArrival`; 422 в обе стороны (плоское тело); `origin==destination` → 422 до Mapbox; happy-path создаёт trip с крюком; create с `generated`-waypoint'ами не пере-солвит.
- **web flow:** «Use latest plausible arrival» рендерится и шлёт `maximumArrival`; back-navigation чистит preview.
- **Smoke (обязательно `curl`/`node`):** preview на коридор с большим окном → крюк присутствует, fuel есть, тело 422 при абсурдном окне.
- TDD: каждый срез — сначала падающий тест (`/agent-skills:test`).

---

## 10. Boundaries

### Always

- Инвариант `tEnd == desiredArrival`; контракт `Segment`/`Trip` обратносовместим со старыми trip'ами.
- Truck-скорость и все пороги — именованные константы; type-дискриминированный доступ к сегментам.
- Детур-солвер: жёсткий cap на Mapbox-вызовы, брекет-предусловие, **`log()` деградации** (no silent caps), отброс регрессных маршрутов.
- 422-тело — плоское `{ error, minimumArrival?|maximumArrival? }`, крафтится в хендлере.
- Тесты с замоканным Mapbox (детерминизм, без сети в CI).

### Ask first

- Финальные значения констант §3.
- Новый **ADR** про детур-генерацию + car-geometry-ограничение (дополнение к ADR-0002) — добавить, не переписывая ADR-0002.
- Изменение `docs/architecture/README.md`/`runbook.md`.
- Снижение user waypoint-max (10→8) — затрагивает существующий контракт/UI.

### Never

- GPS/realtime (ADR-0002): крюк и таймлайн считаются **один раз** при создании.
- Rolling 60/70h окно (out of scope).
- Бэкфилл старых trip'ов.
- Параметризация скорости грузом (Q3).
- Truck-routing провайдер HERE/TomTom/Nav SDK (Q6).
- Молчаливое использование несошедшегося детур-маршрута.
- Схлопывать `@delivery/schemas` с Drizzle-схемой; импортировать `apps/*` из `packages/*`.
- Ручная правка `pnpm-lock.yaml`/`routeTree.gen.ts`/`migrations/*`.
- Вызывать Mapbox из браузерного `interpolate`.

---

## 11. Риски и open questions для `/plan`

1. **(Главный, был BINARY → понижен) Детур-геометрия.** Решение **зафиксировано**: multi-via arc + амплитудная бисекция (FR-3). Усреднение по многим via снимает бинарный риск _по построению_ (один плохой снап среди `K` почти не двигает сумму длины — в отличие от единственного offset'а). Остаточный риск **тюнинговый**: % сходимости и число Mapbox-вызовов на сложных коридорах (побережье, каньон, переход через Миссисипи). **Закрывается прогоном `.specs/spikes/detour-geometry-spike.mjs`** с `MAPBOX_TOKEN` до полной реализации — это gate для `/plan`. Если spike даёт ✗/bad-snap/NO-BRACKET на коридоре — `/plan` добавляет multi-side resampling или пересматривает механизм.
2. **Latency/cost preview.** Итеративные Mapbox-вызовы. Митигировано: alternatives-first (часто 0 доп.), кэш, бюджет ≤5 с. Spike печатает фактическое число вызовов на коридор. Подтвердить ценообразование Mapbox-плана.
3. **Fallback-семантика (Q5) корректна, но reject'ит длинные окна.** Принято осознанно: честнее, чем «припаркованный трак». Release-notes: длинные окна теперь отвергаются с `maximumArrival`.
4. **Co-evolution с `variable-road-speeds`.** Зафиксировать интерфейс truck-derate (`GOVERNED_TOP_SPEED × ROAD_CLASS_FACTOR`) так, чтобы per-band приземление не трогало солвер.
5. **Car-geometry ограничение (Q6/FR-7).** Геометрия может проходить по truck-нелегальным дорогам — задокументировано в ADR; не баг, а принятый trade-off.

---

## 12. Out of scope

GPS/realtime; rolling 60/70h; live traffic/`driving-traffic`; бэкфилл; параметризация скорости весом груза; per-segment Mapbox-скорости (`variable-road-speeds-hos` — отдельный таск); настоящая truck-маршрутизация; dwell на погрузке/разгрузке.

---

## 13. Поправки из adversarial-верификации (audit trail)

| Находка                                                                     | Severity     | Разрешение                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f(offset)` не монотонна → бисекция стопорится/тихо врёт                    | blocker      | FR-3 слоистая стратегия + брекет-предусловие + loud-fail                                                                                                                                 |
| Mapbox snap в воду/off-road, car-профиль через truck-нелегальные дороги     | blocker      | FR-3 обработка NoRoute/regress; FR-7 + ADR документируют car-geometry                                                                                                                    |
| `arrival(d)` 10-ч скачки → недостижимые цели не обработаны                  | blocker      | FR-4 in-gap детект + boundary-`d` + reject                                                                                                                                               |
| `fuel`-границы опущены из closed-form                                       | blocker      | FR-4 «следующая граница» = `min(shift,fuel)`                                                                                                                                             |
| `maximumArrival` не специфицирован (HosError/handler/web state)             | blocker      | FR-6 `direction` discriminant + `maximumArrival`; FR-8 web state/кнопка                                                                                                                  |
| Флаг `generated?` оставлен «ask first», но load-bearing                     | blocker      | FR-6 решено: добавить безусловно, вход срезает                                                                                                                                           |
| Шаг через границу +1 м = 880k итераций                                      | major        | FR-4 шаг-прыжок `next_boundary+ε` + `MAX_SOLVER_ITERATIONS`                                                                                                                              |
| Остаточный `wait` до ~6 ч = «припаркованный трак»                           | major        | FR-5 `MAX_RESIDUAL_WAIT` + ранний reject (Q5)                                                                                                                                            |
| preview↔create re-solve divergence                                          | major        | FR-6 эхо `generated`-waypoint'ов, create не пере-солвит                                                                                                                                  |
| Детур-база при user-waypoint'ах не определена                               | major        | FR-3 база = Mapbox через user-waypoint'ы                                                                                                                                                 |
| `interpolate`/payload масштаб при росте сегментов                           | major        | AC-13 байт-бюджет; `interpolate` уже O(log n)                                                                                                                                            |
| **WRONG:** «422 уже нормализован»                                           | major (факт) | Поправлено: `onValidationError`=400/Zod; 422 крафтится в хендлере (§FR-6, проверено в `validate.ts`)                                                                                     |
| **WRONG:** «ESLint no-restricted-imports блокирует Mapbox в браузере»       | major (факт) | Поправлено: конфиг ЕСТЬ в `apps/web`, но без этого правила (граница держалась на `exports`). **Правило добавлено и верифицировано** негативным тестом; ESLint остаётся web-only (решено) |
| `tripStatus` позиционные допущения                                          | major        | Проверено: уже type-safe; §8 закрепляет правило                                                                                                                                          |
| Edge: `origin==dest`, `desiredArrival==minimumArrival` off-by-one, figure-8 | major        | AC-9/10/11                                                                                                                                                                               |
| fuel `atDist` precision, waypoint max(10)+авто, timeline UI поля, тест-гэпы | minor        | FR-2 split / FR-6 бюджет-25 / FR-8 поля / §9                                                                                                                                             |
