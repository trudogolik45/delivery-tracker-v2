import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  HosError,
  TRUCK_AVG_SPEED_MS,
  SLEEP_DURATION,
  SLEEP_DURATION_MAX,
  MAX_ONDUTY_WINDOW,
} from './hos.js'

// Distance fixtures are derived from the production truck speed, so the
// structural assertions ("8 h of driving", "30 h trip") stay valid regardless
// of the constant's exact value.
const AVG_SPEED_MS = TRUCK_AVG_SPEED_MS

function driveSeconds(meters: number) {
  return meters / AVG_SPEED_MS
}

const T0 = 1_000_000 // arbitrary unix start

// True minimum arrival (no slack) for a trip — probed via HosError, which
// reports the earliest reachable arrival when desiredArrival is unreachable.
function minimumArrival(startedAt: number, dist: number): number {
  try {
    buildTimeline(startedAt, dist, startedAt) // startedAt is always unreachable
  } catch (err) {
    return (err as HosError).minimumArrival
  }
  throw new Error('expected HosError for an unreachable arrival')
}

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

  it('drives at truck speed (~80 km/h), slower than the old 88 km/h car speed (AC-3)', () => {
    // Short single-phase trip (no rests) → arrival reflects pure driving speed.
    const dist = 100_000 // 100 km
    const truckArrival = minimumArrival(T0, dist) - T0
    expect(truckArrival).toBeCloseTo(dist / TRUCK_AVG_SPEED_MS, 0)
    // strictly slower than the previous 88 km/h car assumption
    expect(truckArrival).toBeGreaterThan(dist / (88_000 / 3600))
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

  it('distributes sub-cap slack evenly across sleeps with no wait segment', () => {
    // ~30 h of driving → 2 full shifts → 2 sleeps. Baseline must be the TRUE
    // minimum: deriving it from a huge window would itself hit the sleep cap
    // and make this test vacuous.
    const dist = AVG_SPEED_MS * 30 * 3600
    const minArrival = minimumArrival(T0, dist)
    expect(minArrival).toBeGreaterThan(T0)

    const minSegs = buildTimeline(T0, dist, minArrival)
    const sleepCount = minSegs.filter((s) => s.type === 'rest' && s.reason === 'sleep').length
    expect(sleepCount).toBeGreaterThanOrEqual(2)

    // Slack strictly below the total headroom (sleepCount * 4h) so it is fully
    // absorbed by sleeps — evenly, under the cap, with NO overflow wait block.
    const extraSlack = 4 * 3600
    expect(extraSlack).toBeLessThan(sleepCount * (SLEEP_DURATION_MAX - SLEEP_DURATION))
    const withSlack = buildTimeline(T0, dist, minArrival + extraSlack)

    const sleeps = withSlack.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    const perSleep = extraSlack / sleeps.length
    for (const s of sleeps) {
      const dur = s.tEnd - s.tStart
      // each sleep gets an EVEN share of the slack...
      expect(dur).toBeCloseTo(SLEEP_DURATION + perSleep, 0)
      // ...and never exceeds the cap (would catch over-aggressive capping)
      expect(dur).toBeLessThanOrEqual(SLEEP_DURATION_MAX + 1)
    }

    // sub-cap slack must not overflow into a wait segment
    expect(withSlack.some((s) => s.type === 'rest' && s.reason === 'wait')).toBe(false)

    // final end time matches desiredArrival
    expect(withSlack[withSlack.length - 1]!.tEnd).toBeCloseTo(minArrival + extraSlack, 0)
  })

  it('caps each sleep at 14h and emits a single tail wait segment for large slack', () => {
    // ~30 h of driving → 3 shifts → 2 sleeps. A huge arrival window previously
    // inflated each sleep to 80h+ (biologically impossible). Now sleeps are
    // capped and the excess surfaces as a `wait` block at the destination.
    const dist = AVG_SPEED_MS * 30 * 3600
    const desiredArrival = T0 + 1000 * 3600 // absurdly generous window
    const segs = buildTimeline(T0, dist, desiredArrival)

    const sleeps = segs.filter((s) => s.type === 'rest' && s.reason === 'sleep')
    expect(sleeps.length).toBeGreaterThanOrEqual(2)

    // no sleep exceeds the 14h cap
    for (const s of sleeps) {
      expect(s.tEnd - s.tStart).toBeLessThanOrEqual(SLEEP_DURATION_MAX + 1)
    }

    // leftover slack becomes exactly one `wait` segment at the destination
    const waits = segs.filter((s) => s.type === 'rest' && s.reason === 'wait')
    expect(waits.length).toBe(1)
    expect(waits[0]!.tEnd - waits[0]!.tStart).toBeGreaterThan(0)

    // segments remain contiguous
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.tStart).toBeCloseTo(segs[i - 1]!.tEnd, 1)
    }

    // invariant: final segment ends exactly at desiredArrival
    expect(segs[segs.length - 1]!.tEnd).toBeCloseTo(desiredArrival, 0)
  })

  it('regression: a 30h-drive trip with a 200h window no longer produces 80h+ sleeps', () => {
    const dist = AVG_SPEED_MS * 30 * 3600
    const segs = buildTimeline(T0, dist, T0 + 200 * 3600)
    const maxSleep = Math.max(
      ...segs
        .filter((s) => s.type === 'rest' && s.reason === 'sleep')
        .map((s) => s.tEnd - s.tStart),
    )
    expect(maxSleep).toBeLessThanOrEqual(SLEEP_DURATION_MAX + 1)
  })

  it('never drives beyond the 14h on-duty window within any shift', () => {
    // FMCSA 14h on-duty window: from a shift's first drive to the last drive
    // before the next sleep, wall-clock time must not exceed 14h.
    const dist = AVG_SPEED_MS * 30 * 3600
    const segs = buildTimeline(T0, dist, T0 + 60 * 3600)

    let shiftStart = segs[0]!.tStart
    for (const s of segs) {
      if (s.type === 'rest' && s.reason === 'sleep') {
        // sleep.tStart marks the end of on-duty driving for this shift
        expect(s.tStart - shiftStart).toBeLessThanOrEqual(MAX_ONDUTY_WINDOW + 1)
        shiftStart = s.tEnd // next shift begins after the sleep
      }
    }
  })
})
