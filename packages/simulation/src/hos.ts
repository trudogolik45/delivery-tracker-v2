import type { Segment, DrivingSegment } from '@delivery/schemas'

// Средняя скорость. 50 км/ч — середина допустимого диапазона [40,60]; реалистична
// для гружёного тягача с учётом городских участков и заторов [R5 AC1].
const TRUCK_AVG_SPEED_KMH = 50
// Стартовый guard: при значении вне [40,60] падаем на загрузке модуля. hos.ts
// импортируется через generate.ts на старте API → это эффективно startup-check [R5 AC4].
if (TRUCK_AVG_SPEED_KMH < 40 || TRUCK_AVG_SPEED_KMH > 60) {
  throw new Error(
    `TRUCK_AVG_SPEED_KMH must be within [40,60] km/h for a realistic timeline, got ${TRUCK_AVG_SPEED_KMH}`,
  )
}
export const TRUCK_AVG_SPEED_MS = (TRUCK_AVG_SPEED_KMH * 1000) / 3600 // ≈ 13.889 m/s

export const DRIVING_DAY_SECONDS = 8 * 3600 // 28 800 — бюджет вождения на «день» [R6 AC4]
export const SLEEP_DURATION = 10 * 3600 // 36 000 — фикс. сон после дня, RETAINED [R6 AC7]

// Параметры коротких пауз [R6 AC1/AC2]
export const MIN_PAUSE_SECONDS = 10 * 60 // 600
export const MAX_PAUSE_SECONDS = 20 * 60 // 1200
const FIRST_PAUSE_MIN_OFFSET = 30 * 60 // 1800 — первая пауза не в первые 30 мин вождения
const MIN_DRIVE_BETWEEN_PAUSES = 15 * 60 // ≥1 driving-подсегмент между паузами (не смежные)
const PAUSE_TAIL_MARGIN = 15 * 60 // после последней паузы остаётся вождение (не смежна со сном/концом)

// Бросается ТОЛЬКО при внутренних assertion-сбоях (например, нулевая/невозможная
// геометрия), НЕ при minArrival > desiredArrival и НЕ для удалённого 'too_slow' [R8 AC5].
// `minimumArrival` сохранён в сигнатуре для обратной совместимости читателей; в новой
// модели поздний приезд не бросает ошибку, а ассерт-кейс передаёт minimumArrival = startedAt.
export class HosError extends Error {
  readonly minimumArrival: number
  constructor(message: string, minimumArrival: number) {
    super(message)
    this.name = 'HosError'
    this.minimumArrival = minimumArrival
  }
}

// Одна запланированная короткая пауза: смещение в driving-секундах от начала дня
// и длительность паузы в секундах.
export interface PausePlan {
  offset: number
  duration: number
}

export interface TimelineResult {
  /** Полный таймлайн: driving + break + sleep, плюс хвостовой wait при раннем приезде. */
  segments: Segment[]
  /** Unix-сек, момент прибытия в минимальном таймлайне (tEnd последнего НЕ-wait сегмента),
   *  округлён вверх до целой секунды. Это «earliest reachable arrival». */
  minArrival: number
  /** true ⇔ minArrival > desiredArrival (приедет позже желаемого окна) [R4 AC2]. */
  lateArrival: boolean
}

export function buildTimeline(
  startedAt: number,
  totalDistance: number,
  desiredArrival: number,
  rng: () => number = Math.random, // инъекция RNG; production использует Math.random [R7 AC1]
): TimelineResult {
  if (totalDistance <= 0) {
    // Внутренний assertion-кейс: вырожденная геометрия. Не часть нормального потока [R8 AC5].
    throw new HosError('assertion: non-positive trip distance', startedAt)
  }

  const minimum = simulateMinimum(startedAt, totalDistance, rng)
  const rawMinArrival = minimum[minimum.length - 1]!.tEnd
  // Округляем вверх до целой секунды — значение безопасно отдавать наружу.
  const minArrival = Math.ceil(rawMinArrival)

  if (rawMinArrival > desiredArrival) {
    // Поздно — это не ошибка, а информационный флаг [R4 AC2].
    return { segments: minimum, minArrival, lateArrival: true }
  }

  const slack = desiredArrival - rawMinArrival // >= 0
  // Любой положительный slack целиком уходит в один хвостовой wait [R4 AC1/AC7].
  const segments = slack > 0 ? appendWait(minimum, slack) : minimum
  return { segments, minArrival, lateArrival: false }
}

// Минимальный таймлайн: цикл «рабочий день вождения → сон». Короткие break-паузы
// и сон НЕ вычитаются из driving-бюджета, поэтому суммарное вождение остаётся
// totalDistance / TRUCK_AVG_SPEED_MS независимо от пауз [R6 AC3/AC5].
function simulateMinimum(startedAt: number, totalDistance: number, rng: () => number): Segment[] {
  const segments: Segment[] = []
  let t = startedAt
  let dist = 0
  const EPS = 0.01

  while (dist < totalDistance - EPS) {
    const remainingDriveSec = (totalDistance - dist) / TRUCK_AVG_SPEED_MS
    const dayDriveSec = Math.min(DRIVING_DAY_SECONDS, remainingDriveSec) // бюджет вождения этого дня

    const pausePlan = planDayPauses(dayDriveSec, rng) // отсортированные offset'ы + длительности
    let drivenInDay = 0
    for (const { offset, duration } of pausePlan) {
      const seg = makeDriving(t, dist, totalDistance, offset - drivenInDay) // доедем до точки паузы
      segments.push(seg)
      t = seg.tEnd
      dist = seg.distEnd
      drivenInDay = offset
      segments.push({ type: 'rest', tStart: t, tEnd: t + duration, atDist: dist, reason: 'break' })
      t += duration // пауза НЕ бьётся по driving-бюджету [R6 AC3]
    }

    // Доезжаем остаток дневного бюджета.
    const seg = makeDriving(t, dist, totalDistance, dayDriveSec - drivenInDay)
    segments.push(seg)
    t = seg.tEnd
    dist = seg.distEnd

    if (dist >= totalDistance - EPS) break // доехали в этот день → сна нет [R6 AC8]

    // Сон после каждого не-последнего дня [R6 AC4/AC5].
    segments.push({
      type: 'rest',
      tStart: t,
      tEnd: t + SLEEP_DURATION,
      atDist: dist,
      reason: 'sleep',
    })
    t += SLEEP_DURATION
  }

  return segments
}

// Планирует короткие паузы на один день вождения. Размещение через равномерные
// «интервалы» с рандом-сдвигом даёт 3–4 паузы на полный день и плавное прореживание
// на коротком последнем дне [R6 AC1/AC2].
export function planDayPauses(dayDriveSec: number, rng: () => number): PausePlan[] {
  if (dayDriveSec <= FIRST_PAUSE_MIN_OFFSET) return [] // слишком короткий день — без пауз

  const N = 3 + Math.floor(rng() * 2) // 3 или 4 [R6 AC1]
  const interval = DRIVING_DAY_SECONDS / (N + 1) // шаг привязан к ПОЛНОМУ дню
  const jitter = interval * 0.4 // «примерно равномерно с рандом-сдвигом» [R6 AC2]

  const result: PausePlan[] = []
  let prevOffset = 0
  let k = 1
  while (k * interval <= dayDriveSec - PAUSE_TAIL_MARGIN) {
    const nominal = k * interval
    let offset = nominal + (rng() * 2 - 1) * jitter
    // инварианты: первая не в первые 30 мин; не смежные; есть вождение после последней
    offset = clamp(
      offset,
      Math.max(FIRST_PAUSE_MIN_OFFSET, prevOffset + MIN_DRIVE_BETWEEN_PAUSES),
      dayDriveSec - PAUSE_TAIL_MARGIN,
    )
    if (offset <= prevOffset) break // места не осталось
    const durMinutes = 10 + Math.floor(rng() * 11) // uniform int [10..20] мин [R6 AC1]
    result.push({ offset, duration: durMinutes * 60 })
    prevOffset = offset
    k += 1
  }

  return result
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Хвостовой wait у точки выгрузки: доводит конец таймлайна ровно до desiredArrival
// (last.tEnd + slack === desiredArrival) [R4 AC1/AC7].
function appendWait(segments: Segment[], slack: number): Segment[] {
  const last = segments[segments.length - 1]!
  const atDist = last.type === 'driving' ? last.distEnd : last.atDist
  const wait: Segment = {
    type: 'rest',
    tStart: last.tEnd,
    tEnd: last.tEnd + slack,
    atDist,
    reason: 'wait',
  }
  return [...segments, wait]
}

// Линейный driving-сегмент по TRUCK_AVG_SPEED_MS с clamp по totalDistance.
function makeDriving(
  tStart: number,
  distStart: number,
  totalDistance: number,
  maxSeconds: number,
): DrivingSegment {
  const remaining = totalDistance - distStart
  const drivingSeconds = Math.min(maxSeconds, remaining / TRUCK_AVG_SPEED_MS)
  return {
    type: 'driving',
    tStart,
    tEnd: tStart + drivingSeconds,
    distStart,
    distEnd: Math.min(totalDistance, distStart + drivingSeconds * TRUCK_AVG_SPEED_MS),
  }
}
