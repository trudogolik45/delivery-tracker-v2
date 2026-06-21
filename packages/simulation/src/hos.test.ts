import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  planDayPauses,
  HosError,
  TRUCK_AVG_SPEED_MS,
  DRIVING_DAY_SECONDS,
  SLEEP_DURATION,
  MIN_PAUSE_SECONDS,
  MAX_PAUSE_SECONDS,
} from './hos.js'
import { WAYPOINT_STOP_SECONDS } from '@delivery/schemas'

const T0 = 1_000_000 // произвольный unix-старт

// Детерминированный LCG: два свежих генератора с одним seed дают одинаковую
// последовательность, поэтому им можно проверять воспроизводимость таймлайна.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// Геометрия задаётся через TRUCK_AVG_SPEED_MS, чтобы структурные утверждения
// («8 ч вождения», «17 ч рейс») оставались валидными при любой точной скорости.
function distForDriveSeconds(seconds: number): number {
  return seconds * TRUCK_AVG_SPEED_MS
}

function drivingSeconds(segments: ReturnType<typeof buildTimeline>['segments']): number {
  return segments
    .filter((s) => s.type === 'driving')
    .reduce((sum, s) => sum + (s.tEnd - s.tStart), 0)
}

describe('buildTimeline — скорость [R5]', () => {
  it('едет на расчётной скорости (~50 км/ч), строго медленнее старых 80 км/ч', () => {
    const dist = 100_000 // 100 км
    // desiredArrival недостижимо рано → минимальный таймлайн без хвостового wait
    const { segments } = buildTimeline(T0, dist, T0 + 1, () => 0)
    const driveTime = drivingSeconds(segments)
    expect(driveTime).toBeCloseTo(dist / TRUCK_AVG_SPEED_MS, 3)
    // строго медленнее прежнего 80 км/ч
    expect(driveTime).toBeGreaterThan(dist / (80_000 / 3600))
  })
})

describe('buildTimeline — контракт возврата', () => {
  it('возвращает TimelineResult { segments, minArrival, lateArrival }, а не Segment[]', () => {
    const res = buildTimeline(T0, 100_000, T0 + 100 * 3600, () => 0)
    expect(Array.isArray(res)).toBe(false)
    expect(Array.isArray(res.segments)).toBe(true)
    expect(typeof res.minArrival).toBe('number')
    expect(typeof res.lateArrival).toBe('boolean')
  })
})

describe('planDayPauses — короткие паузы [R6 AC1/AC2]', () => {
  it('ровно 3 паузы на полный день при rng→N=3', () => {
    expect(planDayPauses(DRIVING_DAY_SECONDS, () => 0)).toHaveLength(3)
  })

  it('ровно 4 паузы на полный день при rng→N=4', () => {
    expect(planDayPauses(DRIVING_DAY_SECONDS, () => 0.5)).toHaveLength(4)
  })

  it('первая пауза не раньше 30 мин вождения', () => {
    for (const rng of [() => 0, () => 0.5, makeLcg(1), makeLcg(2), makeLcg(3)]) {
      const pauses = planDayPauses(DRIVING_DAY_SECONDS, rng)
      expect(pauses.length).toBeGreaterThan(0)
      expect(pauses[0]!.offset).toBeGreaterThanOrEqual(30 * 60)
    }
  })

  it('паузы не смежные — между соседними ≥ 15 мин вождения', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const pauses = planDayPauses(DRIVING_DAY_SECONDS, makeLcg(seed))
      for (let i = 1; i < pauses.length; i++) {
        expect(pauses[i]!.offset - pauses[i - 1]!.offset).toBeGreaterThanOrEqual(15 * 60)
      }
    }
  })

  it('после последней паузы остаётся вождение (не примыкает к концу/сну)', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const pauses = planDayPauses(DRIVING_DAY_SECONDS, makeLcg(seed))
      const last = pauses[pauses.length - 1]!
      expect(last.offset).toBeLessThanOrEqual(DRIVING_DAY_SECONDS - 15 * 60)
    }
  })

  it('длительность каждой паузы — целое число минут [10..20] (шаг 60 с)', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const pauses = planDayPauses(DRIVING_DAY_SECONDS, makeLcg(seed))
      for (const p of pauses) {
        expect(p.duration).toBeGreaterThanOrEqual(MIN_PAUSE_SECONDS)
        expect(p.duration).toBeLessThanOrEqual(MAX_PAUSE_SECONDS)
        expect(p.duration % 60).toBe(0)
      }
    }
  })

  it('слишком короткий день (≤ 30 мин) — без пауз', () => {
    expect(planDayPauses(30 * 60, () => 0.5)).toEqual([])
    expect(planDayPauses(20 * 60, makeLcg(5))).toEqual([])
  })
})

describe('buildTimeline — driving-бюджет не затрагивается паузами [R6 AC3]', () => {
  it('короткие паузы не вычитаются из бюджета: суммарное вождение = dist/speed', () => {
    const dist = distForDriveSeconds(DRIVING_DAY_SECONDS) // ровно 8 ч вождения
    const { segments } = buildTimeline(T0, dist, T0 + 1, makeLcg(3)) // late → минимум без wait
    expect(drivingSeconds(segments)).toBeCloseTo(DRIVING_DAY_SECONDS, 3)
    const breaks = segments.filter((s) => s.type === 'rest' && s.reason === 'break')
    expect(breaks.length).toBeGreaterThanOrEqual(3) // на полный день вставлены паузы
    // одиночный 8-ч день завершается в пункте назначения → сна нет [R6 AC8]
    expect(segments.some((s) => s.type === 'rest' && s.reason === 'sleep')).toBe(false)
  })
})

describe('buildTimeline — сон-цикл [R6 AC4/AC5/AC6]', () => {
  it('вставляет сон 10 ч после каждого не-последнего дня многодневного рейса', () => {
    const dist = distForDriveSeconds(17 * 3600) // 17 ч вождения → дни 8+8+1 → 2 сна
    const { segments } = buildTimeline(T0, dist, T0 + 1, makeLcg(5))
    const sleeps = segments.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    expect(sleeps).toHaveLength(2)
    for (const s of sleeps) {
      expect(s.tEnd - s.tStart).toBe(SLEEP_DURATION)
    }
  })

  it('не использует обязательный 30-мин break — все break это короткие паузы 10–20 мин', () => {
    const dist = distForDriveSeconds(17 * 3600)
    const { segments } = buildTimeline(T0, dist, T0 + 1, makeLcg(5))
    const breaks = segments.filter((s) => s.type === 'rest' && s.reason === 'break')
    expect(breaks.length).toBeGreaterThan(0)
    for (const b of breaks) {
      const dur = b.tEnd - b.tStart
      expect(dur).toBeGreaterThanOrEqual(MIN_PAUSE_SECONDS)
      expect(dur).toBeLessThanOrEqual(MAX_PAUSE_SECONDS)
    }
  })

  it('сегменты непрерывны (без щелей и перекрытий)', () => {
    const dist = distForDriveSeconds(20 * 3600)
    const { segments } = buildTimeline(T0, dist, T0 + 60 * 3600, makeLcg(8))
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.tStart).toBeCloseTo(segments[i - 1]!.tEnd, 6)
    }
  })
})

describe('buildTimeline — нет fuel/нет direction [R6 AC7/AC8]', () => {
  it('не генерирует fuel-сегмент для новой поездки', () => {
    const dist = distForDriveSeconds(30 * 3600) // длинный многодневный рейс
    const { segments } = buildTimeline(T0, dist, T0 + 1, makeLcg(9))
    expect(segments.some((s) => s.type === 'rest' && s.reason === 'fuel')).toBe(false)
  })

  it('HosError больше не имеет direction/maximumArrival', () => {
    const err = new HosError('assertion', T0)
    expect(err).toBeInstanceOf(HosError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HosError')
    expect(err.minimumArrival).toBe(T0)
    expect('direction' in err).toBe(false)
    expect('maximumArrival' in err).toBe(false)
  })
})

describe('buildTimeline — поздний приезд [R4 AC2]', () => {
  it('lateArrival:true без wait и без throw, когда minArrival > desiredArrival', () => {
    const dist = distForDriveSeconds(5 * 3600) // ~5 ч вождения
    const desired = T0 + 3600 // недостижимо рано
    const res = buildTimeline(T0, dist, desired, () => 0)
    expect(res.lateArrival).toBe(true)
    expect(res.minArrival).toBeGreaterThan(desired)
    expect(res.segments.some((s) => s.type === 'rest' && s.reason === 'wait')).toBe(false)
    const last = res.segments[res.segments.length - 1]!
    expect(res.minArrival).toBe(Math.ceil(last.tEnd))
  })
})

describe('buildTimeline — ранний приезд / wait [R4 AC1/AC7]', () => {
  it('весь положительный slack уходит в ровно один хвостовой wait до desiredArrival', () => {
    const dist = distForDriveSeconds(5 * 3600)
    const desired = T0 + 100 * 3600 // щедрое окно
    const res = buildTimeline(T0, dist, desired, makeLcg(2))
    expect(res.lateArrival).toBe(false)
    const waits = res.segments.filter((s) => s.type === 'rest' && s.reason === 'wait')
    expect(waits).toHaveLength(1)
    const last = res.segments[res.segments.length - 1]!
    expect(last.type).toBe('rest')
    expect(last.tEnd).toBeCloseTo(desired, 6)
  })

  it('slack добавляет wait даже для одно-сегментной поездки (старый short-trip контракт отменён)', () => {
    const dist = 50_000 // < 1 ч вождения: один driving-сегмент, без пауз и сна
    const desired = T0 + 100 * 3600
    const res = buildTimeline(T0, dist, desired, () => 0)
    const driving = res.segments.filter((s) => s.type === 'driving')
    expect(driving).toHaveLength(1)
    const waits = res.segments.filter((s) => s.type === 'rest' && s.reason === 'wait')
    expect(waits).toHaveLength(1)
    expect(res.lateArrival).toBe(false)
    // для целочисленных входов конец таймлайна ровно равен desiredArrival
    expect(res.segments[res.segments.length - 1]!.tEnd).toBe(desired)
  })
})

describe('buildTimeline — детерминизм при фиксированном rng [NFR-1]', () => {
  it('одинаковый seed → идентичные segments/minArrival/lateArrival', () => {
    const dist = distForDriveSeconds(20 * 3600)
    const desired = T0 + 50 * 3600
    const a = buildTimeline(T0, dist, desired, makeLcg(42))
    const b = buildTimeline(T0, dist, desired, makeLcg(42))
    expect(a.segments).toEqual(b.segments)
    expect(a.minArrival).toBe(b.minArrival)
    expect(a.lateArrival).toBe(b.lateArrival)
  })
})

describe('buildTimeline — assertion [R8 AC5]', () => {
  it('totalDistance <= 0 → HosError', () => {
    expect(() => buildTimeline(T0, 0, T0 + 3600)).toThrow(HosError)
    expect(() => buildTimeline(T0, -100, T0 + 3600)).toThrow(HosError)
    try {
      buildTimeline(T0, 0, T0 + 3600)
      throw new Error('expected HosError')
    } catch (err) {
      expect(err).toBeInstanceOf(HosError)
      expect((err as HosError).minimumArrival).toBe(T0)
    }
  })
})

// ────────────────────────────────────────────────────────────────
// Ф3: service_stop на waypoint-офсетах
// ────────────────────────────────────────────────────────────────

describe('buildTimeline — service_stop (waypointDistances)', () => {
  // TC-1: один waypoint → ровно один service_stop, driving разрезан чисто
  it('1 waypoint: один service_stop с верным atDist и длительностью WAYPOINT_STOP_SECONDS', () => {
    const totalDist = distForDriveSeconds(3 * 3600) // 3 ч вождения, влезает в 1 день
    const waypointDist = totalDist * 0.4 // 40% маршрута
    const desired = T0 + 100 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(1), [waypointDist])
    const stops = segments.filter(
      (s): s is Extract<(typeof segments)[number], { type: 'rest' }> =>
        s.type === 'rest' && s.reason === 'service_stop',
    )
    expect(stops).toHaveLength(1)
    expect(stops[0]!.atDist).toBeCloseTo(waypointDist, 3)
    expect(stops[0]!.tEnd - stops[0]!.tStart).toBe(WAYPOINT_STOP_SECONDS)
  })

  it('1 waypoint: нет нулевых driving-сегментов', () => {
    const totalDist = distForDriveSeconds(3 * 3600)
    const waypointDist = totalDist * 0.4
    const desired = T0 + 100 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(1), [waypointDist])
    const drivings = segments.filter((s) => s.type === 'driving')
    for (const d of drivings) {
      expect(d.tEnd - d.tStart).toBeGreaterThan(0)
      if (d.type === 'driving') expect(d.distEnd - d.distStart).toBeGreaterThan(0)
    }
  })

  it('waypoint ровно на границе дневного бюджета: нет нулевых driving-сегментов', () => {
    // wp совпадает с концом 1-го дня вождения → хвостовой driving был бы нулевым
    const totalDist = distForDriveSeconds(DRIVING_DAY_SECONDS * 2)
    const waypointDist = distForDriveSeconds(DRIVING_DAY_SECONDS)
    const desired = T0 + 300 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(7), [waypointDist])
    const drivings = segments.filter((s) => s.type === 'driving')
    for (const d of drivings) {
      expect(d.tEnd - d.tStart).toBeGreaterThan(0)
      if (d.type === 'driving') expect(d.distEnd - d.distStart).toBeGreaterThan(0)
    }
    const stops = segments.filter(
      (s): s is Extract<(typeof segments)[number], { type: 'rest' }> =>
        s.type === 'rest' && s.reason === 'service_stop',
    )
    expect(stops).toHaveLength(1)
  })

  it('1 waypoint: сегменты непрерывны (без щелей и перекрытий)', () => {
    const totalDist = distForDriveSeconds(3 * 3600)
    const waypointDist = totalDist * 0.4
    const desired = T0 + 100 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(1), [waypointDist])
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.tStart).toBeCloseTo(segments[i - 1]!.tEnd, 6)
    }
  })

  // TC-2: N waypoints → N service_stop в порядке маршрута
  it('N waypoints: N service_stop в порядке возрастания atDist', () => {
    const totalDist = distForDriveSeconds(5 * 3600)
    const wp1 = totalDist * 0.25
    const wp2 = totalDist * 0.5
    const wp3 = totalDist * 0.75
    const desired = T0 + 200 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(2), [wp1, wp2, wp3])
    const stops = segments.filter(
      (s): s is Extract<(typeof segments)[number], { type: 'rest' }> =>
        s.type === 'rest' && s.reason === 'service_stop',
    )
    expect(stops).toHaveLength(3)
    expect(stops[0]!.atDist).toBeCloseTo(wp1, 3)
    expect(stops[1]!.atDist).toBeCloseTo(wp2, 3)
    expect(stops[2]!.atDist).toBeCloseTo(wp3, 3)
  })

  // TC-3: суммарное время driving не меняется от стопов
  it('суммарное время driving = totalDistance / TRUCK_AVG_SPEED_MS (стопы не влияют)', () => {
    const totalDist = distForDriveSeconds(5 * 3600)
    const waypointDist = totalDist * 0.5
    const desired = T0 + 200 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(3), [waypointDist])
    // суммарное вождение должно быть totalDist / TRUCK_AVG_SPEED_MS
    const totalDriveSec = drivingSeconds(segments)
    expect(totalDriveSec).toBeCloseTo(totalDist / TRUCK_AVG_SPEED_MS, 3)
  })

  // TC-4: стоп не тратит дневной бюджет — multi-day маршрут, sleep корректен
  it('service_stop не тратит дневной бюджет — sleep по-прежнему корректен на multi-day', () => {
    // 17 ч вождения → 2 дня + хвост (без стопов: 8+8+1). Со стопами: сны должны совпадать
    const totalDist = distForDriveSeconds(17 * 3600)
    const wp = totalDist * 0.3
    const desired = T0 + 1 // late → минимальный путь
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(5), [wp])
    const sleeps = segments.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    // Количество снов должно совпадать с версией без waypoints (2 сна для 17-ч маршрута)
    const { segments: segNoWp } = buildTimeline(T0, totalDist, desired, makeLcg(5), [])
    const sleepsNoWp = segNoWp.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    expect(sleeps).toHaveLength(sleepsNoWp.length)
  })

  // TC-5: lateArrival=true, когда одни лишь стопы выводят за desiredArrival
  it('lateArrival=true когда стопы одни выводят за desiredArrival', () => {
    const totalDist = distForDriveSeconds(2 * 3600) // 2 ч вождения
    // без стопов хватает времени, но 3 стопа добавляют 3*5=15 ч
    const wp1 = totalDist * 0.25
    const wp2 = totalDist * 0.5
    const wp3 = totalDist * 0.75
    // desiredArrival = start + 3 ч (до добавления стопов было бы ок, но 15 ч стопов — нет)
    const desired = T0 + 3 * 3600
    const res = buildTimeline(T0, totalDist, desired, makeLcg(1), [wp1, wp2, wp3])
    expect(res.lateArrival).toBe(true)
  })

  // TC-6: 0 waypoints → вывод byte-in-byte с версией без параметра (регрессионный страж)
  it('0 waypoints → те же сегменты, что и без параметра waypointDistances (регрессия)', () => {
    const totalDist = distForDriveSeconds(20 * 3600)
    const desired = T0 + 50 * 3600
    const a = buildTimeline(T0, totalDist, desired, makeLcg(42))
    const b = buildTimeline(T0, totalDist, desired, makeLcg(42), [])
    expect(b.segments).toEqual(a.segments)
    expect(b.minArrival).toBe(a.minArrival)
    expect(b.lateArrival).toBe(a.lateArrival)
  })

  // TC-7: офсет ровно на 0 или totalDistance игнорируется
  it('офсеты на 0 и totalDistance игнорируются', () => {
    const totalDist = distForDriveSeconds(3 * 3600)
    const desired = T0 + 100 * 3600
    const { segments } = buildTimeline(T0, totalDist, desired, makeLcg(1), [0, totalDist])
    const stops = segments.filter(
      (s): s is Extract<(typeof segments)[number], { type: 'rest' }> =>
        s.type === 'rest' && s.reason === 'service_stop',
    )
    expect(stops).toHaveLength(0)
  })
})
