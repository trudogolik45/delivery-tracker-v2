# Requirements Document

## Introduction

Delivery Tracker — многопользовательская система трекинга грузов: диспетчеры создают поездки через административный визард, водители выезжают, а получатели отслеживают движение груза через share-страницы на брендовых доменах. Центральная сущность — **timeline**: массив сегментов (`driving` / `rest`), рассчитываемый один раз при создании поездки и хранящийся в базе данных; позиция водителя вычисляется как чистая функция `interpolatePosition(trip, t)` от сохранённых сегментов без обращения к внешним сервисам в реальном времени.

Данный документ описывает требования к двум взаимосвязанным изменениям. **UX-часть**: действующий четырёхшаговый визард (`Cargo → Route → Time → Preview`) преобразуется в трёхшаговый (`Cargo → Timing → Route`), в котором превью маршрута и timeline отображаются в реальном времени прямо на третьем шаге — без отдельного шага подтверждения. **Расчётная часть**: FMCSA-каркас симуляции упрощается — упраздняются смены (11-часовой лимит вождения и 14-часовое on-duty окно), обязательные 30-минутные перерывы и учёт топлива. Новая модель — «рабочий день» ~8 часов вождения с 3–4 случайными короткими паузами «Отдых» (10–20 мин); после каждых ~8 часов вождения, если маршрут ещё не пройден, вставляется сон 10 ч, и цикл повторяется до прибытия. Сон 10 ч **сохраняется** (водитель не может ехать сутки напролёт на одних коротких паузах), но без остального FMCSA-каркаса. Средняя скорость движения снижается с 80 км/ч до реалистичного диапазона 40–60 км/ч. Семантика `desiredArrival` меняется с «прибыть НЕ ПОЗЖЕ» на «прибыть НЕ РАНЬШЕ» (earliest acceptable arrival): если минимальное время прибытия оказывается раньше `desiredArrival`, в конец timeline вставляется сегмент ожидания; если позже — это информационное предупреждение, не ошибка.

Изменения затрагивают: клиентский визард (`apps/web/src/routes/admin/b.$brandSlug.trips.new.tsx`), ядро симуляции timeline (`packages/simulation/src/hos.ts` — `buildTimeline`, `simulateMinimum`, `distributeSlack` и константы скорости), схемы данных (`packages/schemas/src/trip.ts`), API-эндпоинты (`apps/api/src/routes/admin.ts`, `POST /trips/preview` и `POST /trips`). `interpolate.ts` не меняется — детерминированный расчёт позиции остаётся неизменным при условии, что случайные паузы записываются в `segments` при создании поездки.

---

## Requirements

### Requirement 1: Трёхшаговая структура визарда

**User Story:** As a dispatch manager, I want to create a new trip in three sequential steps — Cargo, Timing, Route — so that I can complete the full setup without navigating to a separate preview screen, reducing the time and context-switching required to dispatch a trip.

#### Acceptance Criteria

1. WHEN a dispatch manager navigates to the new trip page THEN the system SHALL display a stepper header with exactly three steps labelled "Cargo", "Timing", and "Route".
2. WHEN the dispatch manager is on Step 1 (Cargo) and has not yet selected a cargo item THEN the system SHALL disable the "Next" button.
3. WHEN the dispatch manager selects a cargo item on Step 1 THEN the system SHALL enable the "Next" button and allow progression to Step 2.
4. WHEN the dispatch manager is on Step 2 (Timing) and has not yet entered both departure and desired-arrival times THEN the system SHALL disable the "Next" button.
5. WHEN the dispatch manager advances from Step 2 to Step 3 THEN the system SHALL carry the cargo selection and timing values forward without resetting them.
6. WHEN the dispatch manager is on Step 3 (Route) THEN the system SHALL present the route entry form on the left and a map panel on the right of a two-column layout.
7. WHEN all required route fields are valid on Step 3 THEN the system SHALL display a "Create trip" button that, when clicked, persists the trip to the database and navigates to the trip detail page.
8. IF the dispatch manager clicks "Back" on any step THEN the system SHALL return to the previous step and preserve all previously entered values.

---

### Requirement 2: Шаг 2 — Настройка тайминга

**User Story:** As a dispatch manager, I want to set the departure time and the earliest acceptable arrival time ("not earlier than") in a dedicated Timing step, so that the system can build a timeline that prevents cargo from arriving before the delivery window opens.

#### Acceptance Criteria

1. WHEN the dispatch manager is on Step 2 (Timing) THEN the system SHALL display a "Departure" datetime-local input and an "Earliest arrival (cargo must not arrive before this time)" datetime-local input.
2. WHEN the page is first loaded THEN the system SHALL pre-populate "Departure" with the current local date-time and "Earliest arrival" with a default offset of +48 hours.
3. WHEN the dispatch manager sets an earliest arrival value that is not strictly after the departure time THEN the system SHALL display an inline validation error and disable the "Next" button.
4. WHEN the dispatch manager sets an earliest arrival value more than 14 days after departure THEN the system SHALL display an inline validation error message stating the 14-day limit and disable the "Next" button.
5. WHEN valid departure and earliest arrival values are entered THEN the system SHALL enable the "Next" button; the field label SHALL clearly communicate "not earlier than" semantics (e.g. "Earliest arrival — cargo must not arrive before this time").

---

### Requirement 3: Шаг 3 — Маршрут с живой картой и пересчётом timeline

**User Story:** As a dispatch manager, I want to enter origin, destination, and optional waypoints on the Route step while seeing the route drawn on a map and a computed timeline displayed alongside it, so that I can immediately evaluate the impact of each change without a separate preview step.

#### Acceptance Criteria

1. WHEN the dispatch manager is on Step 3 (Route) THEN the system SHALL display a two-column layout: the left column contains origin, destination, and waypoints inputs; the right column contains an embedded map component.
2. WHEN both origin and destination have been resolved to geocoding points THEN the system SHALL automatically trigger a route and timeline calculation without requiring a manual "Preview" button click.
3. WHEN a route and timeline calculation is triggered THEN the system SHALL initiate a debounced request to `POST /admin/b/:slug/trips/preview` no sooner than 600 ms after the last change to origin, destination, or any waypoint; any in-flight request SHALL be cancelled via `AbortController` before the new one is sent.
4. WHEN the preview request is sent THEN waypoints that have not been resolved to a geocoding point SHALL be excluded from the request body; the request SHALL proceed using origin, destination, and any already-resolved waypoints only.
5. WHILE a route calculation is in progress THEN the system SHALL display a loading indicator on the map panel and disable the "Create trip" button.
6. WHEN the API returns a successful preview response THEN the system SHALL render the computed route polyline on the map, fit the map bounds to the route, and display a compact timeline summary (number of segments, total distance, computed arrival time, and rest-pause markers).
7. WHEN the dispatch manager adds or removes a waypoint THEN the system SHALL update the waypoint markers on the map and re-trigger the debounced calculation.
8. IF the origin or destination field is cleared THEN the system SHALL remove the route polyline and timeline summary from the map panel and disable the "Create trip" button.
9. IF the preview API returns HTTP 200 with `lateArrival: true` THEN the system SHALL display a non-blocking advisory: "The truck will arrive after your desired earliest window — you may still create the trip." The "Create trip" button SHALL remain enabled.
10. WHEN the preview timeline contains a trailing `wait` segment at the destination (the minimum arrival is **earlier** than `desiredArrival`, i.e. the `wait` padding produced by Requirement 4 AC1/AC7) THEN the system SHALL display an explicit early-arrival warning on the Route step AND SHALL render the idle period at the destination in the timeline summary as a distinct block/marker (e.g. "Ожидание у точки выгрузки: <длительность>"); the "Create trip" button SHALL remain enabled. The client SHALL derive the idle duration directly from the last segment with `reason: 'wait'` in `trip.segments`. This early-arrival case is mutually exclusive with the late-arrival advisory of AC9: when a trailing `wait` segment is present the preview returns `lateArrival: false`, so the AC9 advisory SHALL NOT be shown at the same time.
11. WHEN the trailing `wait` segment duration is at or above `WAIT_WARN_THRESHOLD_SECONDS` (5400 seconds / 1.5 hours) THEN the warning of AC10 SHALL be rendered as a prominent red advisory (e.g. "Водитель прибудет за <X> ч до желаемого окна и будет простаивать у точки выгрузки"); WHILE the trailing `wait` duration is greater than 0 but below `WAIT_WARN_THRESHOLD_SECONDS` THEN the warning SHALL be rendered as an ordinary (non-red) explicit notice. In both gradations the "Create trip" button SHALL remain enabled.
12. IF the preview API returns an error other than a late-arrival advisory THEN the system SHALL display an error message on the map panel and allow the manager to correct inputs.
13. WHEN the dispatch manager clicks "Create trip" THEN the system SHALL submit `POST /admin/b/:slug/trips` and, upon success, redirect to the trip detail page.
14. WHEN the dispatch manager adds waypoints THEN the system SHALL allow a maximum of 10 waypoints and disable the "Add waypoint" control when this limit is reached.

---

### Requirement 4: Семантика desiredArrival — «не раньше»

**User Story:** As a dispatch manager, I want the system to treat `desiredArrival` as the earliest time cargo may be delivered ("not earlier than"), so that the timeline delays arrival at the destination when the truck would otherwise arrive before the delivery window opens.

#### Acceptance Criteria

1. WHEN `buildTimeline` computes a minimum-arrival time that is **earlier** than `desiredArrival` THEN the system SHALL append a `wait` rest segment at the destination of sufficient duration to bring the final timeline end-time to exactly `desiredArrival`.
2. WHEN `buildTimeline` computes a minimum-arrival time that is **later** than `desiredArrival` (truck arrives after the window opens) THEN the system SHALL build the timeline at minimum time and SHALL NOT throw an error; the condition is informational only.
3. WHEN the preview API is called and the minimum arrival exceeds `desiredArrival` THEN the API SHALL return HTTP 200 with `{ trip: Trip, lateArrival: true, minimumArrival: <unix> }`; no `422` SHALL be returned for this case.
4. WHEN the preview API is called and the minimum arrival is at or before `desiredArrival` THEN the API SHALL return HTTP 200 with `{ trip: Trip, lateArrival: false }` and SHALL NOT include `minimumArrival`.
5. WHEN a trip is created via `POST /trips` and the minimum arrival exceeds `desiredArrival` THEN the system SHALL store the trip and include `{ tripId, shareHash, lateArrival: true, minimumArrival: <unix> }` in the creation response.
6. IF `desiredArrival` is not strictly after `startedAt` OR the gap exceeds 14 days THEN the system SHALL reject the request with HTTP 422 (the existing `withinArrivalWindow` validation remains unchanged).
7. WHEN `buildTimeline` computes positive slack (minArrival < desiredArrival) for any trip — regardless of trip duration or number of rest segments — THEN the system SHALL append a `wait` segment at the destination to consume the full slack, so the final segment always ends at exactly `desiredArrival`.

---

### Requirement 5: Снижение расчётной скорости движения

**User Story:** As a dispatch manager, I want the timeline to reflect a realistic average driving speed of 40–60 km/h, so that estimated arrival times account for actual road conditions including urban congestion and rural highway segments rather than an optimistic highway-only speed.

#### Acceptance Criteria

1. WHEN the simulation builds a driving segment THEN the system SHALL compute travel time using an average speed in the range 40–60 km/h (11.1–16.7 m/s), replacing the current 80 km/h baseline.
2. WHEN the speed constant is updated THEN all downstream calculations — segment durations and position interpolation — SHALL use the new value consistently; `solveMaxDistance` and FMCSA shift-boundary arithmetic are removed as part of R6 and do not need to be updated.
3. WHEN the average speed changes THEN existing tests for `buildTimeline` and the minimum-time simulator SHALL be updated to reflect new expected durations and distances.
4. IF the configured speed is outside the 40–60 km/h range THEN the system SHALL fail at startup with a descriptive error, preventing deployment of an incorrectly configured simulation.

---

### Requirement 6: Упрощённая модель непрерывной езды с короткими паузами

**User Story:** As a dispatch manager, I want the timeline to reflect a simplified driving model — an ~8-hour driving day with 3–4 short random rest pauses (10–20 minutes each), followed by a fixed 10-hour sleep before the next driving day — so that the schedule stays realistic on multi-day routes without the full FMCSA shift-rule complexity (11-hour caps, 14-hour on-duty windows, mandatory 30-minute breaks) or fuel tracking.

#### Acceptance Criteria

1. WHEN `buildTimeline` generates the driving portion of a trip THEN the system SHALL insert 3 or 4 `rest` segments with `reason: 'break'` per `DRIVING_DAY_SECONDS` (8 × 3600 = 28800 seconds) of cumulative driving time, with individual pause durations randomly drawn from the uniform integer range [10, 20] minutes.
2. WHEN short `break` pauses are inserted THEN the system SHALL distribute them such that no two pauses are adjacent (at minimum one driving sub-segment separates each pair), the first pause does not occur within the first 30 minutes of driving, and pauses are approximately evenly spaced across the `DRIVING_DAY_SECONDS` window with randomised offsets.
3. WHEN a short `break` pause is inserted mid-trip THEN the system SHALL advance the wall clock by the pause duration WITHOUT counting pause time against the driving-time budget, so the total accumulated driving time is unaffected by short pauses.
4. WHEN cumulative driving time reaches `DRIVING_DAY_SECONDS` (8 hours) AND the route distance has not yet been fully covered THEN the system SHALL insert a `rest` segment with `reason: 'sleep'` of fixed duration `SLEEP_DURATION` (10 × 3600 = 36000 seconds) before resuming driving, and SHALL repeat the driving-day-then-sleep cycle until the destination is reached.
5. WHEN a `sleep` segment is inserted THEN the system SHALL advance the wall clock by `SLEEP_DURATION` WITHOUT counting it against the driving-time budget, and the next driving day SHALL again allow up to `DRIVING_DAY_SECONDS` of driving with its own 3–4 short `break` pauses.
6. WHEN the trip's total driving time exceeds `DRIVING_DAY_SECONDS` THEN the system SHALL apply this model uniformly for the entire trip duration — repeating the (~8 h driving with 3–4 short pauses) + (10 h sleep) cycle — WITHOUT any 11-hour driving cap, 14-hour on-duty window, mandatory 30-minute break, or fuel stop.
7. WHEN the simulation model is updated THEN the following FMCSA HOS elements SHALL remain deleted: `MAX_DRIVE_PER_SHIFT` (11 h), `MAX_ONDUTY_WINDOW` (14 h), mandatory `BREAK_DURATION` (30-min break), `SLEEP_DURATION_MAX` (randomised sleep range), `FUEL_RANGE`, and `FUEL_STOP_DURATION`; `solveMaxDistance` and the `'too_slow'` direction of `HosError` SHALL also be removed. The `SLEEP_DURATION` constant (10 h) is RETAINED and reused as the fixed post-8-hour sleep duration.
8. WHEN the simulation model is updated THEN no new `reason: 'fuel'` segments SHALL be generated for any trip; the segment kinds produced for a new trip are `'driving'` segments, `'break'` rest segments, `'sleep'` rest segments (one after each ~8-hour driving day that is not the last), and `'wait'` rest segments (for `desiredArrival` padding).
9. WHEN all segments for a trip have been generated THEN the system SHALL store them — short random pauses and deterministic sleep alike — as explicit `Segment` objects within the `segments` array in the database before the create-trip transaction commits.

---

### Requirement 7: Детерминизм таймлайна при случайных паузах

**User Story:** As a system architect, I want the random short rest pauses to be generated exactly once at trip-creation time and stored in the persisted `segments` array (the 10-hour sleep segments being deterministic), so that `interpolatePosition(trip, t)` remains a pure, side-effect-free function that produces the same result on every call.

#### Acceptance Criteria

1. WHEN a trip is created THEN the system SHALL generate the random short-pause positions and durations using `Math.random()` exactly once during trip-creation execution; the results SHALL be encoded as explicit `Segment` objects in the `segments` array and written to the database before any read path can access them. Randomness applies ONLY to the short `break` pauses; the `sleep` segments are deterministic (fixed `SLEEP_DURATION` after each `DRIVING_DAY_SECONDS` of driving). `buildTimeline` is NOT required to produce identical output on repeated invocations; the determinism invariant applies to reading from already-stored segments, not to re-running the generator.
2. WHEN the generated timeline is stored in the database THEN all segments — randomly placed `break` pauses and deterministic `sleep` segments alike — SHALL be stored as explicit `Segment` objects in the `timeline` column; no pause positions or durations SHALL be reconstructed at read time.
3. WHEN `interpolatePosition` is called at any time `t` THEN the system SHALL compute the driver's position solely from the stored `segments` array without calling any random number generator or external service.
4. WHEN the stored `segments` are retrieved and parsed THEN the system SHALL validate them against `TripSchema.shape.segments` before use; a validation failure SHALL cause a 500 error with a descriptive message rather than silently producing incorrect position data.
5. WHEN an administrator views a trip THEN the timeline displayed to them SHALL be identical to the timeline visible on the share page, derived from the same stored segments.

---

### Requirement 8: Выравнивание контракта API и схем данных

**User Story:** As a backend developer, I want all API responses and Zod schemas to be updated consistently to reflect the new `desiredArrival` semantics and the simplified pause model, so that clients can rely on stable, self-documenting contracts.

#### Acceptance Criteria

1. WHEN the API returns a preview response for a trip that arrives after `desiredArrival` THEN the JSON body SHALL be `{ trip: Trip, lateArrival: true, minimumArrival: number }` with HTTP 200; the previous HTTP 422 response for this case SHALL be removed.
2. WHEN the API returns a preview response for a trip that arrives at or before `desiredArrival` THEN the JSON body SHALL be `{ trip: Trip, lateArrival: false }` with HTTP 200; the `minimumArrival` field SHALL be absent.
3. WHEN the `RestSegmentSchema` is updated THEN the `reason` enum SHALL retain `'sleep'`, `'fuel'`, and `'wait'` values; for newly-created trips the simulation SHALL generate `'break'` reasons for the short random pauses and `'sleep'` reasons for the fixed 10-hour rest after each ~8-hour driving day; `'fuel'` SHALL NOT be generated for new trips.
4. WHEN `GenerateTripInputSchema` and `TripPreviewInputSchema` are parsed THEN the `withinArrivalWindow` refine SHALL remain unchanged: `desiredArrival` must be strictly after `startedAt` and within 14 days.
5. WHEN `HosError` is thrown THEN it SHALL only occur for internal assertion failures (e.g. impossible or zero-length geometry); it SHALL NOT be thrown for `minArrival > desiredArrival` (late arrival is informational, not an error) and SHALL NOT be thrown for the removed `'too_slow'` direction.
6. WHEN a trip is created via `POST /trips` and `lateArrival` is `true` THEN the trip detail page SHALL display a non-blocking advisory banner indicating the truck is scheduled to arrive after the desired earliest window.

---

## Non-Functional Requirements

### NFR-1: Детерминизм

The `segments` array stored in the database is the sole authoritative source of truth for driver position. **The system shall guarantee that `interpolatePosition(trip, t)` returns the same result on every call for a given stored `trip.segments` — it SHALL NOT invoke any random number generator or external service.** `Math.random()` is used at trip-creation time only and ONLY for the short `break` pauses; the 10-hour `sleep` segments are deterministic (fixed `SLEEP_DURATION` after each `DRIVING_DAY_SECONDS` of driving). The output of both is immediately encoded as explicit `Segment` objects and committed to the database. `buildTimeline` is not required to produce identical output on repeated invocations; the determinism invariant is about reading, not regenerating. Any database migration that modifies the structure of stored `segments` must treat existing rows as authoritative and must not re-generate their pause data from scratch.

### NFR-2: Контроль стоимости Mapbox API

Reactive timeline recalculation on Step 3 (Route) calls `POST /trips/preview` which internally calls the Mapbox Directions API. **The system shall debounce preview requests with a minimum 600 ms quiet period after the last user input change (origin, destination, or any waypoint field).** A preview request SHALL be initiated only when both origin and destination are resolved geocoding points; partially typed text that has not been confirmed via a suggestion selection SHALL NOT trigger a request. Waypoints not yet resolved to geocoding points SHALL be excluded from the request body; the request proceeds with origin, destination, and any already-resolved waypoints. The system SHALL cancel any in-flight request via `AbortController` before initiating a new one, ensuring at most one concurrent Mapbox Directions call per wizard session. Drag-and-drop waypoint reordering is out of scope and need not be handled specially.

### NFR-3: Скорость отклика живого превью

**WHEN a preview request completes successfully THEN the map polyline and timeline summary SHALL appear within 500 ms of receiving the API response**, assuming normal network conditions. The map component SHALL be lazy-loaded (`React.lazy`) to avoid blocking the initial wizard render. The timeline summary panel SHALL render skeleton placeholders during loading to prevent layout shift.

---

## Resolved Decisions

The following decisions close the open questions identified during initial requirements review.

**OQ-A — Детерминизм (seeded PRNG vs. однократная генерация):** Выбран вариант «генерировать один раз, хранить в `segments`». Паузы создаются через `Math.random()` ровно один раз в момент создания поездки и записываются явными `Segment`-объектами. Seeded PRNG не требуется. Инвариант детерминизма применяется к чтению из сохранённого timeline, а не к повторному запуску генератора.

**OQ-B — Поведение при minArrival > desiredArrival:** Ненавязчивое информационное предупреждение, кнопка «Create trip» не блокируется. Кнопка «подогнать desiredArrival к minArrival» не добавляется. API возвращает HTTP 200 с `lateArrival: true`; клиент отображает advisory-баннер. На share-странице ETA определяется как `lastSegment.tEnd` из сохранённого timeline (без изменений).

**OQ-C — Дебаунс и неразрешённые waypoints:** Любое изменение origin, destination или waypoints сбрасывает таймер дебаунса (600 мс). Неразрешённые (не выбранные из геокодинга) waypoints исключаются из тела запроса; пересчёт идёт по origin + destination + уже разрешённым waypoints. Drag-and-drop переупорядочивание — вне scope.

**OQ-D — Многодневные рейсы и сон (пересмотрено):** По решению пользователя СОН 10 ч **возвращён** в модель: водитель не может ехать ~28 ч на одних коротких паузах. Модель такова: «рабочий день» = ~8 ч вождения (`DRIVING_DAY_SECONDS = 8 × 3600`) с 3–4 случайными короткими паузами (10–20 мин, `reason:'break'`); после каждых 8 ч вождения, если маршрут ещё не пройден, вставляется **детерминированный** сон `SLEEP_DURATION = 10 × 3600` (`reason:'sleep'`); цикл повторяется до прибытия. Скорость 40–60 км/ч без изменений. Остальной FMCSA-каркас остаётся **упразднённым**: MAX_DRIVE_PER_SHIFT (11 ч), MAX_ONDUTY_WINDOW (14 ч), обязательный 30-мин break, `SLEEP_DURATION_MAX`, FUEL_RANGE, FUEL_STOP_DURATION, `solveMaxDistance` и `'too_slow'`-ветка `HosError` удаляются. Случайны только короткие паузы; сон детерминирован. И паузы, и сон хранятся явными `Segment`-объектами в `segments`.

**OQ-E — Градации предупреждения о простое (хвостовой `wait`-сегмент):** При раннем прибытии (`minArrival < desiredArrival`) в конец timeline добавляется `wait`-сегмент (Requirement 4 AC1/AC7), и UI всегда показывает явное предупреждение о простое у точки выгрузки с отрисовкой сегмента ожидания в timeline-summary (Requirement 3 AC10). Введён именованный порог `WAIT_WARN_THRESHOLD_SECONDS = 5400` (1.5 ч): `0 < wait < порога` → обычное явное (не-красное) предупреждение; `wait >= порога` → красное/prominent (Requirement 3 AC11). Обе градации не блокируют создание поездки — кнопка «Create trip» остаётся активной. Длительность простоя клиент берёт напрямую из последнего сегмента с `reason: 'wait'` в `trip.segments`; отдельное поле в API не обязательно (при желании можно добавить минимальное `earlyBySeconds` в preview-ответ). Ранний (`wait`) и поздний (`lateArrival`) случаи взаимоисключающие: наличие хвостового `wait` означает `lateArrival: false`, поэтому advisory из OQ-B и предупреждение о простое одновременно не показываются.
