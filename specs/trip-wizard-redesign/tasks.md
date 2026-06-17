# Implementation Plan

> Эпик beads: `delivery-tracker-v2-ym6`. Источники истины: `specs/trip-wizard-redesign/requirements.md` (R1–R8, NFR-1..3, OQ-A..E) и `specs/trip-wizard-redesign/design.md` (§1–§7).
>
> **Порядок уважает DAG монорепы:** `schemas → simulation → {api, web}`. Команды тестов: `pnpm --filter <pkg> test`, где `<pkg>` ∈ `@delivery/schemas | @delivery/simulation | @delivery/api | @delivery/web`. Финальные гейты: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`.
>
> **Принцип «зелёного состояния».** Большинство задач возвращают свой пакет в зелёное состояние сразу. Два места — намеренные исключения, потому что меняют общий контракт между пакетами: (1) пакет `@delivery/simulation` снова зелёный только после задачи 2.3 (rewrite `hos.ts` + `hos.test.ts` неразделимы); (2) типчек `@delivery/api` ломается на задаче 3 (смена контракта `generateTrip`) и восстанавливается на задаче 4, а тесты api — на задачах 5–6. Внутри этих окон делайте подзадачи подряд, без коммита промежуточного красного состояния. **`interpolate.ts` и `interpolate.test.ts` НЕ трогаются** ни в одной задаче (регресс-гарантия детерминизма [NFR-1], [R7 AC3]).

## Progress Summary
- **Total Tasks**: 19
- **Completed**: 0
- **Remaining**: 19
- **Progress**: 0%

---

## Completed Tasks ✓

_No tasks completed yet. Tasks will be moved here as they are implemented._

---

## Pending Tasks

### Phase 1: Schemas (контракт)

- [ ] 1. Добавить порог простоя и схемы ответов preview/create
  - В `packages/schemas/src/trip.ts` добавить `export const WAIT_WARN_THRESHOLD_SECONDS = 5400` (1.5 ч) [design §4.2] [R3 AC11] [OQ-E]
  - Добавить `TripPreviewResponseSchema = z.discriminatedUnion('lateArrival', [...])` (false → `{ trip }`; true → `{ trip, minimumArrival: z.number().int() }`) + тип `TripPreviewResponse` [design §4.3] [R4 AC3] [R4 AC4] [R8 AC1] [R8 AC2]
  - Добавить `TripCreateResponseSchema = z.discriminatedUnion('lateArrival', [...])` (false → `{ tripId, shareHash }`; true → `{ tripId, shareHash, minimumArrival }`) + тип `TripCreateResponse` [design §4.4] [R4 AC5] [R8]
  - НЕ менять `RestSegmentSchema` (enum `['sleep','break','fuel','wait']` уже корректен), `GenerateTripInputSchema`, `TripPreviewInputSchema`, `withinArrivalWindow`, `TripSchema`, `TripAdminSchema` [design §4.1] [design §4.5] [R8 AC3] [R8 AC4]
  - Тесты в `packages/schemas/src/trip.test.ts`: `WAIT_WARN_THRESHOLD_SECONDS === 5400`; `lateArrival:true` требует `minimumArrival`, `lateArrival:false` его не принимает/опускает (preview и create); `RestSegmentSchema` парсит все 4 значения reason [design §Testing «trip.test.ts»]
  - Файлы: `packages/schemas/src/trip.ts`, `packages/schemas/src/trip.test.ts`
  - Тест: `pnpm --filter @delivery/schemas test`
  - Зависимости: нет
  - Requirements: [R3 AC11], [R4 AC3], [R4 AC4], [R4 AC5], [R8 AC1], [R8 AC2], [R8 AC3], [OQ-E]

### Phase 2: Ядро симуляции

- [ ] 2. Переписать ядро HOS-симуляции `packages/simulation/src/hos.ts` под упрощённую модель «рабочий день → сон» (подзадачи 2.1→2.2→2.3 выполняются подряд; пакет зелёный только после 2.3)

- [ ] 2.1 Заменить константы и `HosError`, удалить FMCSA/fuel/solver-код
  - Задать `const TRUCK_AVG_SPEED_KMH = 50` + startup-guard (`throw` при значении вне `[40,60]`); экспортировать производную `TRUCK_AVG_SPEED_MS` [design §1.1] [R5 AC1] [R5 AC4]
  - Добавить `DRIVING_DAY_SECONDS = 8*3600`; сохранить `SLEEP_DURATION = 10*3600`; добавить `MIN_PAUSE_SECONDS`, `MAX_PAUSE_SECONDS`, `FIRST_PAUSE_MIN_OFFSET`, `MIN_DRIVE_BETWEEN_PAUSES`, `PAUSE_TAIL_MARGIN` [design §1.1] [R6 AC1] [R6 AC2] [R6 AC4]
  - Удалить полностью: `GOVERNED_TOP_SPEED`, `ROAD_CLASS_FACTOR`, `MAX_DRIVE_BEFORE_BREAK`, `BREAK_DURATION`, `MAX_DRIVE_PER_SHIFT`, `MAX_ONDUTY_WINDOW`, `SLEEP_DURATION_MAX`, `FUEL_RANGE`, `FUEL_STOP_DURATION`, `MAX_SOLVER_ITERATIONS`; функции `solveMaxDistance`, `driveWithFuel`, `distributeSlack` [design §1.1] [R6 AC7]
  - Упростить `HosError` до `(message, minimumArrival)`: убрать поля `direction`/`maximumArrival` и ветку `'too_slow'` [design §1.2] [R8 AC5]
  - Файл: `packages/simulation/src/hos.ts`
  - Зависимости: задача 1 (тип `Segment` из `@delivery/schemas` уже доступен)
  - Requirements: [R5 AC1], [R5 AC4], [R6 AC7], [R8 AC5]

- [ ] 2.2 Реализовать новые функции генерации таймлайна
  - Сохранить `makeDriving` как есть (линейный driving-сегмент по `TRUCK_AVG_SPEED_MS`, clamp по `totalDistance`) [design §1.4]
  - `planDayPauses(dayDriveSec, rng)`: `N = 3+floor(rng()*2)`; равномерные интервалы с jitter; первая пауза ≥ `FIRST_PAUSE_MIN_OFFSET`; соседние не смежны (≥ `MIN_DRIVE_BETWEEN_PAUSES`); после последней есть вождение (`PAUSE_TAIL_MARGIN`); длительность — uniform int [10..20] мин [design §1.5] [R6 AC1] [R6 AC2]
  - `simulateMinimum(startedAt, totalDistance, rng)`: цикл «день вождения → сон»; короткие `break`-паузы НЕ вычитаются из driving-бюджета; `sleep` (`SLEEP_DURATION`) после каждого не-последнего дня; без 11/14-ч лимитов, обязательного break и fuel [design §1.4] [R6 AC3] [R6 AC4] [R6 AC5] [R6 AC6] [R6 AC8]
  - `appendWait(segments, slack)`: один хвостовой `wait`-сегмент, чтобы `last.tEnd === desiredArrival` [design §1.3] [R4 AC1] [R4 AC7]
  - Экспортировать `interface TimelineResult { segments, minArrival, lateArrival }`; `buildTimeline(startedAt, totalDistance, desiredArrival, rng = Math.random): TimelineResult` — `HosError` только при `totalDistance <= 0`; `minArrival = ceil(rawMinArrival)`; `lateArrival` при `rawMinArrival > desiredArrival` (без `wait`, без throw); иначе любой положительный slack → один `wait` [design §1.3] [design §1.6] [R4 AC1] [R4 AC2] [R4 AC7] [R7 AC1] [R8 AC5] [NFR-1]
  - Файл: `packages/simulation/src/hos.ts`
  - Зависимости: 2.1
  - Requirements: [R4 AC1], [R4 AC2], [R4 AC7], [R6 AC1], [R6 AC2], [R6 AC3], [R6 AC4], [R6 AC5], [R6 AC6], [R6 AC8], [R7 AC1], [R8 AC5], [NFR-1]

- [ ] 2.3 Переписать `packages/simulation/src/hos.test.ts` под новую модель
  - Удалить блоки `solveMaxDistance` (S4), fuel-стопов (S3), `MAX_ONDUTY_WINDOW`, `SLEEP_DURATION_MAX`/cap-slack, `HosError.direction/maximumArrival`, хелпер `minimumArrival` через throw [design §Testing «hos.test.ts»]
  - Использовать инъекцию детерминированного `rng`; фикстуры от нового `TRUCK_AVG_SPEED_MS`
  - Добавить тесты: скорость (arrival ≈ `dist/TRUCK_AVG_SPEED_MS`, строго медленнее 80 км/ч) [R5]; `buildTimeline` возвращает `TimelineResult` (а не `Segment[]`); короткие паузы (3 или 4 на полный день; первая после ≥30 мин; не смежные; после последней есть driving; длительности ∈ {600..1200} шаг 60; driving-бюджет не затронут) [R6 AC1] [R6 AC2] [R6 AC3]; сон-цикл (36000 с после каждого не-последнего дня; многодневный рейс повторяет цикл; нет 11/14-ч лимитов) [R6 AC4] [R6 AC5] [R6 AC6]; нет `fuel`/нет `direction` [R6 AC7] [R6 AC8]; поздний приезд (`lateArrival:true`, без `wait`, без throw) [R4 AC2]; ранний/wait (ровно один хвостовой `wait`, `last.tEnd === desiredArrival`, `lateArrival:false`, в т.ч. для одно-сегментной поездки) [R4 AC1] [R4 AC7]; детерминизм при фиксированном `rng` [NFR-1]; assertion `totalDistance <= 0` → `HosError` [R8 AC5]
  - НЕ трогать `interpolate.ts`/`interpolate.test.ts` [design §Testing «interpolate.test.ts»] [R7 AC3]
  - Файл: `packages/simulation/src/hos.test.ts`
  - Тест: `pnpm --filter @delivery/simulation test` (зелёный после этой подзадачи)
  - Зависимости: 2.1, 2.2
  - Requirements: [R4 AC1], [R4 AC2], [R4 AC7], [R5 AC3], [R6 AC1]–[R6 AC8], [R8 AC5], [NFR-1]

### Phase 3: Генерация и контракт API

- [ ] 3. Обновить `generateTrip` до `GenerateResult`
  - В `packages/simulation/src/generate.ts` объявить `export interface GenerateResult { trip: Trip; minArrival: number; lateArrival: boolean }` [design §3]
  - `generateTrip(input: GenerateTripInput | TripPreviewInput, opts): Promise<GenerateResult>`: после `getRoute` деструктурировать `TimelineResult` из `buildTimeline` (rng по умолчанию `Math.random`); вернуть `{ trip: { startedAt, polyline, totalDistance, segments, pauses: [] }, minArrival, lateArrival }`; сохранить реэкспорт `HosError` [design §3] [R4 AC3] [R4 AC5] [R7 AC1] [OQ-A]
  - Файл: `packages/simulation/src/generate.ts`
  - Тесты: отдельного теста нет — контракт покрывают api-тесты (задачи 5–6); убедиться, что `pnpm --filter @delivery/simulation typecheck` зелёный
  - Зависимости: задача 2 (новый контракт `buildTimeline`)
  - Примечание: типчек `@delivery/api` ломается до задачи 4
  - Requirements: [R4 AC3], [R4 AC5], [R7 AC1], [OQ-A]

- [ ] 4. Перевести эндпоинты trips на новый контракт в `apps/api/src/routes/admin.ts`
  - `POST /trips/preview`: убрать `try/catch` с 422 на `HosError`; деструктурировать `{ trip, minArrival, lateArrival }` из `generateTrip`; вернуть `200 { trip, lateArrival:true, minimumArrival: minArrival }` либо `200 { trip, lateArrival:false }` (без `minimumArrival`); опц. валидировать ответ `TripPreviewResponseSchema.parse` [design §5.1] [R4 AC3] [R4 AC4] [R8 AC1] [R8 AC2]
  - `POST /trips`: убрать 422-ветку `HosError`; деструктурировать `generateTrip`; `INSERT` с `routeGeometry: trip.polyline`, `timeline: trip.segments` (явные `Segment`-объекты до commit), `totalDistanceMeters: round(trip.totalDistance)`; вернуть `201 { tripId, shareHash, lateArrival:true, minimumArrival }` либо `201 { tripId, shareHash, lateArrival:false }`; опц. `TripCreateResponseSchema.parse` [design §5.2] [R4 AC5] [R6 AC9] [R7 AC2]
  - `HosError` больше не ловится как «поздно» (внутренний assertion → 500 общим обработчиком); подчистить импорт `HosError`, если не используется [design §5.1] [design §Error Handling] [R8 AC5]
  - НЕ менять `GET /trips`, `GET /trips/:id` (парсинг `timeline` через `TripSchema.shape.segments` остаётся) [design §5.3] [R7 AC4]
  - Файл: `apps/api/src/routes/admin.ts`
  - Зависимости: задача 3 (`GenerateResult`), задача 1 (схемы ответов)
  - Примечание: тесты api красные до задач 5–6
  - Requirements: [R4 AC3], [R4 AC4], [R4 AC5], [R6 AC9], [R7 AC2], [R8 AC1], [R8 AC2], [R8 AC5]

- [ ] 5. Обновить `apps/api/src/routes/admin.trips.test.ts`
  - Мок `generateTrip` → `GenerateResult` (`{ trip: { startedAt, polyline, totalDistance, segments, pauses }, minArrival, lateArrival }`); мок `HosError` → 2-арг форма (убрать `direction`/`maximumArrival`)
  - Удалить кейс «returns 422 when generateTrip throws HosError» для позднего приезда (теперь это 200/201, `HosError` — только внутренний assertion)
  - Новые кейсы: preview поздно → `200 { trip, lateArrival:true, minimumArrival }` [R4 AC3] [R8 AC1]; preview рано/вовремя → `200 { trip, lateArrival:false }` без `minimumArrival`, при slack>0 `trip.segments` оканчивается `wait` [R4 AC4] [R8 AC2]; create поздно → `201 { tripId, shareHash, lateArrival:true, minimumArrival }` [R4 AC5]; create рано → `201 { ..., lateArrival:false }`
  - Сохранить регрессы: 404 cargo not found, 503 без токена, pause/resume/delete/list
  - Файл: `apps/api/src/routes/admin.trips.test.ts`
  - Тест: `pnpm --filter @delivery/api test`
  - Зависимости: задача 4
  - Requirements: [R4 AC3], [R4 AC4], [R4 AC5], [R8 AC1], [R8 AC2]

- [ ] 6. Обновить `apps/api/src/routes/admin.trip-validation.test.ts`
  - Привести мок `generateTrip` к форме `GenerateResult`, чтобы positive-control preview возвращал `{ trip, lateArrival:false }` (хендлер теперь деструктурирует `trip` из результата) [design §Testing «admin.trip-validation.test.ts»]
  - Сохранить регрессы окна прибытия: 400 для preview/create при `desiredArrival ≤ startedAt` и `> 14 дней`; positive-control 200 на валидном окне [R4 AC6] [R8 AC4]
  - Файл: `apps/api/src/routes/admin.trip-validation.test.ts`
  - Тест: `pnpm --filter @delivery/api test` (зелёный после этой задачи)
  - Зависимости: задача 4
  - Requirements: [R4 AC6], [R8 AC4]

### Phase 4: Веб — общий стиль и компоненты

- [ ] 7. Вынести стиль карты в `apps/web/src/lib/map-style.ts`
  - Создать модуль, экспортирующий `MAP_STYLE`, `TILE_URL`, `TILE_ATTRIBUTION` (перенос из `TripMap.tsx`) [design §6.4 «DRY map-style»]
  - Отрефакторить `TripMap.tsx` на импорт из нового модуля (без изменения поведения) [R3 AC6]
  - Файлы: `apps/web/src/lib/map-style.ts`, `apps/web/src/components/TripMap.tsx`
  - Тесты: новых нет; убедиться `pnpm --filter @delivery/web typecheck` и `lint` зелёные
  - Зависимости: нет (можно начинать параллельно с Phase 1–3)
  - Requirements: [R3 AC6]

- [ ] 8. Создать компонент `RoutePreviewMap` (lazy)
  - Создать `apps/web/src/components/RoutePreviewMap.tsx` с `default`-экспортом (для `React.lazy`): рисует `trip.polyline` (line layer) + `fitBounds` [R3 AC6]; маркеры origin/destination и разрешённых waypoints, обновляются при add/remove [R3 AC7]; overlay со спиннером при `loading` [R3 AC5]; без тикающего маркера и status-футера; импортирует `MAP_STYLE` из `lib/map-style.ts`
  - Props: `{ trip: Trip | null, origin, destination, waypoints, loading: boolean }`
  - `React.lazy`, чтобы не блокировать первичный рендер визарда [NFR-3]
  - Файл: `apps/web/src/components/RoutePreviewMap.tsx`
  - Тесты: новых юнитов нет (DOM/maplibre); проверить typecheck/lint
  - Зависимости: задача 7
  - Requirements: [R3 AC1], [R3 AC5], [R3 AC6], [R3 AC7], [NFR-3]

- [ ] 9. Создать компонент `TimelineSummary`
  - Создать `apps/web/src/components/TimelineSummary.tsx`: число сегментов, общая дистанция (`formatMiles`), расчётное прибытие = `lastSegment.tEnd` (`formatDateTime`), маркеры пауз `break`/`sleep`; хвостовой `wait` — отдельный блок «Ожидание у точки выгрузки: <длительность>» (длительность из последнего сегмента `reason:'wait'`); skeleton-плейсхолдеры при `loading` (анти-layout-shift) [design §6.4 «TimelineSummary»] [R3 AC6] [R3 AC10] [NFR-3]
  - Файл: `apps/web/src/components/TimelineSummary.tsx`
  - Тесты: опц. — вынести и протестировать чистый хелпер форматирования длительности; иначе только typecheck/lint
  - Зависимости: задача 1 (тип `Trip`/сегменты), может идти параллельно с 8
  - Requirements: [R3 AC6], [R3 AC10], [NFR-3]

- [ ] 10. Создать хук `useLivePreview` (debounce + AbortController)
  - Создать `apps/web/src/hooks/useLivePreview.ts`, возвращающий `{ data: TripPreviewResponse | null, loading, error }`
  - Логика: при отсутствии origin/destination — очистка data/error и выход [R3 AC8]; debounce ≥600 мс после последней правки [R3 AC3] [NFR-2]; запрос только если origin+destination разрешены; неразрешённые waypoints исключаются из тела [R3 AC4] [NFR-2] [OQ-C]; `AbortController.abort()` для in-flight при смене ключа; парсинг `TripPreviewResponseSchema.parse`; `setError` для не-late ошибок, игнор `AbortError` [R3 AC12]; `serializedKey` из координат + timing
  - Вынести чистый билдер тела/`serializedKey` отдельной функцией для юнит-теста (опц.)
  - Файл: `apps/web/src/hooks/useLivePreview.ts`
  - Тесты: опц. — debounce/abort требуют hook-renderer (нет в зависимостях web); как минимум юнит на чистый билдер тела (исключение неразрешённых waypoints) [design §Testing «Web»]
  - Зависимости: задача 1 (`TripPreviewResponseSchema`)
  - Requirements: [R3 AC2], [R3 AC3], [R3 AC4], [R3 AC8], [R3 AC12], [NFR-2], [OQ-C]

### Phase 5: Веб — визард и детальная страница

- [ ] 11. Переписать визард создания поездки на 3 шага (`apps/web/src/routes/admin/b.$brandSlug.trips.new.tsx`)

- [ ] 11.1 Модель состояния, stepper и шаги Cargo/Timing
  - `type Step = 1 | 2 | 3`; stepper-хедер ровно с тремя метками `['Cargo','Timing','Route']` [R1 AC1]
  - Инициализация: `startedAt = now`, `desiredArrival = now + 48ч` [R2 AC2]; состояние живёт в одном `useState` верхнего уровня, шаги — условный рендер; `Back` сохраняет значения [R1 AC5] [R1 AC8]
  - Шаг 1 (Cargo): перенос без изменений, `Next` дизейблен при `!cargoId` [R1 AC2] [R1 AC3]
  - Шаг 2 (Timing): поля `Departure` и `Earliest arrival — cargo must not arrive before this time` (datetime-local) [R2 AC1] [R2 AC5]; derived `timingError` (пустые → null; `gap<=0` → ошибка; `gap > MAX_ARRIVAL_WINDOW_SECONDS` → ошибка) + inline-ошибка; `Next` дизейблен при `!canNext2` [R2 AC3] [R2 AC4] [R2 AC5]
  - Добавить минимальную заглушку Шага 3, чтобы файл компилировался (полную логику добавит 11.2)
  - Вынести чистый хелпер `timingError`/`canNext2` для теста (опц.)
  - Файл: `apps/web/src/routes/admin/b.$brandSlug.trips.new.tsx`
  - Зависимости: нет жёстких для компиляции (логически до 11.2)
  - Requirements: [R1 AC1], [R1 AC2], [R1 AC3], [R1 AC4], [R1 AC5], [R1 AC8], [R2 AC1], [R2 AC2], [R2 AC3], [R2 AC4], [R2 AC5]

- [ ] 11.2 Шаг 3 (Route) с живым preview, derived-состоянием и созданием
  - Двухколоночный layout: слева форма (origin, destination, waypoints), справа панель карты [R1 AC6] [R3 AC1]
  - Подключить `useLivePreview` (задача 10), `RoutePreviewMap` через `Suspense`+`React.lazy` (задача 8), `TimelineSummary` (задача 9)
  - Derived: `trip`, `lateArrival`, `minimumArrival`, `trailingWait` (последний сегмент `reason:'wait'`), `idleSeconds`, `waitLevel` (`none`/`notice`/`red` по `WAIT_WARN_THRESHOLD_SECONDS`), `canCreate` (`!!trip && !loading && error===null`) [design §6.4] [R3 AC10] [R3 AC11]
  - Предупреждения (не блокируют): `EarlyArrivalWarning` при `idleSeconds>0` (красное при `waitLevel==='red'`, иначе обычное явное); `LateArrivalAdvisory` при `lateArrival` («The truck will arrive after your desired earliest window — you may still create the trip.»); взаимоисключение гарантировано сервером [R3 AC9] [R3 AC10] [R3 AC11] [OQ-B] [OQ-E]
  - Кнопки: `Add waypoint` дизейблится при 10 waypoints [R3 AC14]; `Create trip` дизейблится при `!canCreate` [R3 AC5] [R3 AC8] [R3 AC13]; `Create trip` → `POST /trips`, парс `TripCreateResponseSchema`, redirect на `/trips/:tripId` [R3 AC13]
  - Удалить старый 4-й шаг Preview, кнопку «Preview», блок `previewError`/«Use minimum arrival time», все `alert(...)` (ошибки идут в панель карты) [design §6.5] [R3 AC12]
  - Файл: `apps/web/src/routes/admin/b.$brandSlug.trips.new.tsx`
  - Тесты: опц. — чистые хелперы `waitLevel`/`canCreate` (см. задачу 13)
  - Зависимости: 1, 8, 9, 10, 11.1
  - Requirements: [R1 AC6], [R1 AC7], [R3 AC1], [R3 AC5], [R3 AC6], [R3 AC7], [R3 AC8], [R3 AC9], [R3 AC10], [R3 AC11], [R3 AC12], [R3 AC13], [R3 AC14], [R4 AC1], [R4 AC2], [OQ-B], [OQ-E]

- [ ] 12. Баннер позднего приезда на детальной странице (`apps/web/src/routes/admin/b.$brandSlug.trips.$tripId.tsx`)
  - Вывести `lateArrival` из сохранённых данных без расширения `TripAdmin`: `desiredUnix` из `data.desiredArrival`; `hasTrailingWait` = последний сегмент `rest && reason==='wait'`; `lateArrival = !!last && !hasTrailingWait && last.tEnd > desiredUnix + 1` [design §7] [R8 AC6] [R7 AC5] [OQ-B]
  - При `lateArrival` — ненавязчивый баннер «Прибудет после желаемого окна» над картой
  - НЕ менять `SegmentRow`/`describeStatus` (уже отображают `wait`/`fuel`) [design §7]
  - Вынести чистый хелпер деривации `lateArrival` для теста (опц.)
  - Файл: `apps/web/src/routes/admin/b.$brandSlug.trips.$tripId.tsx`
  - Зависимости: нет жёстких (читает существующий `TripAdmin`), можно параллельно
  - Requirements: [R7 AC5], [R8 AC6], [OQ-B]

- [ ] 13. Юнит-тесты веб-логики (где выполнимо без hook-renderer)
  - Добавить vitest-тесты на чистые хелперы, вынесенные в 11.1/11.2/12: `timingError` (gap≤0, gap>14д, пустые) [R2]; `waitLevel` (`none`/`notice`/`red` по `idleSeconds` и порогу) и `canCreate` (остаётся true при late/wait) [R3 AC11]; деривация `lateArrival` на детальной странице [R8 AC6]; чистый билдер тела `useLivePreview` (исключение неразрешённых waypoints) [R3 AC4]
  - Паттерн — как в `apps/web/src/lib/*.test.ts`
  - Примечание: полноценный интеграционный тест `useLivePreview` (фейковые таймеры + мок fetch + abort) требует React hook-renderer, которого нет в зависимостях `@delivery/web`; покрывать его не обязательно — фокус на чистых хелперах
  - Файлы: `apps/web/src/lib/*.test.ts` (или co-located `*.test.ts` рядом с хелперами)
  - Тест: `pnpm --filter @delivery/web test`
  - Зависимости: 10, 11, 12
  - Requirements: [R2], [R3 AC4], [R3 AC11], [R8 AC6]

### Phase 6: Финальная интеграция

- [ ] 14. Прогнать монорепо-гейты и устранить кросс-пакетный fallout
  - Выполнить `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`; починить любые остаточные ошибки [design §all]
  - Подтвердить, что `interpolate.ts`/`interpolate.test.ts` не менялись и зелёные (регресс детерминизма) [R7 AC3] [NFR-1]
  - Файлы: только точечные правки по результатам гейтов
  - Зависимости: все предыдущие задачи
  - Примечание: ручная проверка визарда с реальным Mapbox — в чеклисте Definition of Done (некодовая активность)
  - Requirements: [NFR-1], [R7 AC3]

---

## Definition of Done (вся фича)

- [ ] Все требования покрыты задачами: R1 (11.1/11.2), R2 (11.1), R3 (8/9/10/11.2), R4 (2.2/4/11.2), R5 (2.1), R6 (2.1/2.2), R7 (2.2/3/12 + неизменный `interpolate.ts`), R8 (1/4/12), NFR-1 (2.2/3 + `interpolate.ts`), NFR-2 (10), NFR-3 (8/9), OQ-A..E (3/4/10/11.2/12).
- [ ] `pnpm -r typecheck` — чисто.
- [ ] `pnpm -r lint` — чисто.
- [ ] `pnpm -r test` — все пакеты зелёные (`@delivery/schemas`, `@delivery/simulation`, `@delivery/api`, `@delivery/web`).
- [ ] `interpolate.ts` и `interpolate.test.ts` не изменены; их тесты (включая static-маркер на `fuel`) зелёные.
- [ ] БД-миграции нет; `RestSegmentSchema.reason` сохраняет `'fuel'` — старые записи валидны и интерполируются.
- [ ] Ручная проверка визарда (некодовая, скилл `run-delivery-tracker`, реальный `MAPBOX_TOKEN`): 3 шага Cargo→Timing→Route; живой пересчёт маршрута/timeline с debounce; ранний приезд показывает предупреждение о простое (обычное/красное по порогу); поздний приезд — advisory, кнопка «Create trip» активна; создание поездки и баннер позднего приезда на детальной странице.

---

## Review

Do the tasks look good? Если да — задачи можно заводить дочерними бедами под эпик `delivery-tracker-v2-ym6`. Если нужно иначе разбить (например, объединить 2.1+2.2 в одну атомарную правку `hos.ts` или вынести предупреждения визарда в отдельные компоненты) — скажи, поправлю до утверждения.
