import { describe, it, expect } from 'vitest'
import { buildTimeline, HosError } from './hos.js'

// 88 km/h in m/s
const AVG_SPEED_MS = 88_000 / 3600

function driveSeconds(meters: number) {
  return meters / AVG_SPEED_MS
}

const T0 = 1_000_000 // arbitrary unix start

describe('buildTimeline', () => {
  it('single driving segment for a very short trip', () => {
    const dist = 100_000 // 100 km ~ 1h driving
    const minDriving = driveSeconds(dist)
    const desiredArrival = T0 + minDriving + 3600 // 1h slack

    const segs = buildTimeline(T0, dist, desiredArrival)

    expect(segs.length).toBe(1)
    expect(segs[0]!.type).toBe('driving')
    // with slack but no sleep segments, timeline stays at minimum
    expect(segs[0]!.tEnd).toBeCloseTo(T0 + minDriving, 0)
  })

  it('adds a 30-min break after exactly 8 h of driving', () => {
    // distance that takes exactly 8h to drive
    const dist8h = AVG_SPEED_MS * 8 * 3600
    const desiredArrival = T0 + 8 * 3600 + 100 * 3600 // plenty of slack

    const segs = buildTimeline(T0, dist8h, desiredArrival)

    // only one driving segment reaching the destination — no break needed
    expect(segs.length).toBe(1)
    expect(segs[0]!.type).toBe('driving')
  })

  it('adds break + second drive for a trip requiring >8 h driving', () => {
    // distance that takes 9h to drive
    const dist = AVG_SPEED_MS * 9 * 3600
    const desiredArrival = T0 + 24 * 3600

    const segs = buildTimeline(T0, dist, desiredArrival)

    const types = segs.map((s) => s.type)
    expect(types).toEqual(['driving', 'rest', 'driving'])
    const breakSeg = segs[1]!
    expect(breakSeg.type).toBe('rest')
    if (breakSeg.type === 'rest') {
      expect(breakSeg.reason).toBe('break')
      expect(breakSeg.tEnd - breakSeg.tStart).toBeCloseTo(30 * 60, 0)
    }
  })

  it('full multi-day trip: driving → break → driving → sleep → next shift', () => {
    // 1300 km NYC→Chicago ≈ 14.77 h driving → needs sleep
    const dist = 1_300_000
    const minDriving = driveSeconds(dist)
    const desiredArrival = T0 + minDriving + 20 * 3600 // generous slack

    const segs = buildTimeline(T0, dist, desiredArrival)

    const types = segs.map((s) => s.type)
    // must include at least one sleep
    expect(types).toContain('rest')
    const sleeps = segs.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    expect(sleeps.length).toBeGreaterThanOrEqual(1)

    // segments are contiguous (no gaps, no overlaps)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.tStart).toBeCloseTo(segs[i - 1]!.tEnd, 1)
    }

    // final segment ends at or before desiredArrival
    expect(segs[segs.length - 1]!.tEnd).toBeLessThanOrEqual(desiredArrival + 1)
  })

  it('throws HosError when desiredArrival is unreachable', () => {
    const dist = 1_000_000 // 1000 km
    const impossiblyEarly = T0 + 1 // 1 second from start

    expect(() => buildTimeline(T0, dist, impossiblyEarly)).toThrow(HosError)

    try {
      buildTimeline(T0, dist, impossiblyEarly)
    } catch (err) {
      expect(err).toBeInstanceOf(HosError)
      const hosErr = err as HosError
      expect(hosErr.minimumArrival).toBeGreaterThan(impossiblyEarly)
    }
  })

  it('distributes slack evenly across sleep segments', () => {
    // long trip with two sleep segments
    const dist = AVG_SPEED_MS * 30 * 3600 // ~30 h of driving → 2 full shifts → 2 sleeps
    const minSegs = buildTimeline(T0, dist, T0 + 200 * 3600)
    const minSleeps = minSegs.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    expect(minSleeps.length).toBeGreaterThanOrEqual(2)

    const extraSlack = 4 * 3600 // 4 h extra
    const lastMin = minSegs[minSegs.length - 1]!.tEnd
    const withSlack = buildTimeline(T0, dist, lastMin + extraSlack)

    const withSlackSleeps = withSlack.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    // each sleep extended by extraSlack/sleepCount
    const perSleep = extraSlack / withSlackSleeps.length
    for (const s of withSlackSleeps) {
      const dur = s.tEnd - s.tStart
      expect(dur).toBeGreaterThanOrEqual(10 * 3600 + perSleep - 1)
    }

    // final end time matches desiredArrival
    expect(withSlack[withSlack.length - 1]!.tEnd).toBeCloseTo(lastMin + extraSlack, 0)
  })
})
