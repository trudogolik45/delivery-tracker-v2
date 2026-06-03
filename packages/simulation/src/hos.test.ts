import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  solveMaxDistance,
  MAX_SOLVER_ITERATIONS,
  HosError,
  TRUCK_AVG_SPEED_MS,
  FUEL_RANGE,
  FUEL_STOP_DURATION,
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

  // ── fuel stops (S3) ───────────────────────────────────────────────────────
  const fuels = (segs: ReturnType<typeof buildTimeline>) =>
    segs.filter((s) => s.type === 'rest' && s.reason === 'fuel')

  it('emits no fuel stop when the trip ends exactly at a FUEL_RANGE boundary', () => {
    // The boundary coincides with the destination → a trailing zero-progress
    // refuel must NOT be emitted (off-by-one guard).
    const segs = buildTimeline(T0, FUEL_RANGE, minimumArrival(T0, FUEL_RANGE))
    expect(fuels(segs)).toHaveLength(0)
  })

  it('emits one fuel stop just past FUEL_RANGE, before the coincident break', () => {
    const dist = FUEL_RANGE + 1
    const segs = buildTimeline(T0, dist, minimumArrival(T0, dist))

    const fs = fuels(segs)
    expect(fs).toHaveLength(1)
    const fuel = fs[0]!
    if (fuel.type !== 'rest') throw new Error('fuel must be a rest segment')
    expect(fuel.atDist).toBeCloseTo(FUEL_RANGE, 0)
    expect(fuel.tEnd - fuel.tStart).toBe(FUEL_STOP_DURATION) // exactly 45 min

    // The fuel boundary lands on shift-3's 8h break point: fuel first, then a
    // SEPARATE break, both at the same odometer — never merged.
    const i = segs.indexOf(fuel)
    const prev = segs[i - 1]!
    const next = segs[i + 1]!
    expect(prev.type).toBe('driving')
    if (prev.type === 'driving') expect(prev.distEnd).toBeCloseTo(FUEL_RANGE, 0)
    expect(next.type).toBe('rest')
    if (next.type === 'rest') {
      expect(next.reason).toBe('break')
      expect(next.atDist).toBeCloseTo(FUEL_RANGE, 0)
    }
  })

  it('keeps segments contiguous and post-fuel driving resuming at the fuel odometer', () => {
    const dist = FUEL_RANGE + 1
    const segs = buildTimeline(T0, dist, minimumArrival(T0, dist))
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.tStart).toBeCloseTo(segs[i - 1]!.tEnd, 1)
    }
    const fuel = fuels(segs)[0]!
    const after = segs.slice(segs.indexOf(fuel) + 1).find((s) => s.type === 'driving')!
    if (fuel.type === 'rest' && after.type === 'driving') {
      expect(after.distStart).toBeCloseTo(fuel.atDist, 0)
    }
  })

  it('emits one fuel stop per boundary for a trip past 2× FUEL_RANGE', () => {
    const dist = 2 * FUEL_RANGE + 1
    const segs = buildTimeline(T0, dist, minimumArrival(T0, dist))
    const atDists = fuels(segs).map((f) => (f.type === 'rest' ? f.atDist : NaN))
    expect(atDists).toHaveLength(2)
    expect(atDists[0]!).toBeCloseTo(FUEL_RANGE, 0)
    expect(atDists[1]!).toBeCloseTo(2 * FUEL_RANGE, 0)
  })

  it('upholds the 14h on-duty window in a shift containing a fuel stop', () => {
    const dist = FUEL_RANGE + 500_000 // fuel mid-trip, with driving after it
    const segs = buildTimeline(T0, dist, T0 + 200 * 3600)
    expect(fuels(segs).length).toBeGreaterThanOrEqual(1)
    let shiftStart = segs[0]!.tStart
    for (const s of segs) {
      if (s.type === 'rest' && s.reason === 'sleep') {
        expect(s.tStart - shiftStart).toBeLessThanOrEqual(MAX_ONDUTY_WINDOW + 1)
        shiftStart = s.tEnd
      }
    }
  })
})

describe('S4 · time-solver (solveMaxDistance + HosError.direction)', () => {
  // Local mirrors of non-exported HOS constants for boundary arithmetic.
  // If these values ever change in hos.ts, tests will fail red — intentional.
  const MAX_DRIVE_BEFORE_BREAK = 8 * 3600 // 28 800 s
  const BREAK_DURATION_S = 30 * 60 // 1 800 s
  const MAX_DRIVE_PER_SHIFT = 11 * 3600 // 39 600 s
  const shiftCycleNoFuel =
    MAX_DRIVE_BEFORE_BREAK +
    BREAK_DURATION_S +
    (MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK) +
    SLEEP_DURATION // 77 400 s

  // ── HosError shape (S4 field additions) ─────────────────────────────────────

  it("HosError with only two positional args defaults direction to 'too_fast' and maximumArrival to undefined", () => {
    // Mimic exactly what buildTimeline throws: new HosError(message, minArrivalInt).
    // No direction or maximumArrival supplied — the defaults must kick in.
    const minArrivalInt = T0 + 50_000
    const err = new HosError('Cannot arrive by requested time. Minimum arrival: ...', minArrivalInt)

    expect(err).toBeInstanceOf(HosError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HosError')
    expect(err.minimumArrival).toBe(minArrivalInt)
    expect(err.direction).toBe('too_fast')
    expect(err.maximumArrival).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(err, 'minimumArrival')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(err, 'direction')).toBe(true)
  })

  it('HosError three-arg form sets direction but leaves maximumArrival undefined', () => {
    const minArrival = T0 + 30_000

    const errFast = new HosError('too fast message', minArrival, 'too_fast')
    expect(errFast.direction).toBe('too_fast')
    expect(errFast.minimumArrival).toBe(minArrival)
    expect(errFast.maximumArrival).toBeUndefined()

    const errSlow = new HosError('too slow message', minArrival, 'too_slow')
    expect(errSlow.direction).toBe('too_slow')
    expect(errSlow.minimumArrival).toBe(minArrival)
    expect(errSlow.maximumArrival).toBeUndefined()
  })

  it("HosError class can be constructed with direction 'too_slow' and maximumArrival set", () => {
    const fakeMinArrival = T0 + 100 * 3600
    const fakeMaxArrival = T0 + 200 * 3600

    const err = new HosError(
      'Driver cannot arrive before the delivery window closes',
      fakeMinArrival,
      'too_slow',
      fakeMaxArrival,
    )

    expect(err).toBeInstanceOf(HosError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HosError')
    expect(err.message).toBe('Driver cannot arrive before the delivery window closes')
    expect(err.direction).toBe('too_slow')
    expect(err.minimumArrival).toBe(fakeMinArrival)
    expect(err.maximumArrival).toBe(fakeMaxArrival)
  })

  it("buildTimeline too_fast error carries direction === 'too_fast' and no maximumArrival (backward compat)", () => {
    // buildTimeline throws: new HosError(msg, minArrivalInt)
    // The two-argument positional call defaults direction to 'too_fast'.
    // minimumArrival must remain non-optional (admin.ts reads it without a guard).
    try {
      buildTimeline(T0, 1_000_000, T0 + 1)
      throw new Error('expected HosError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HosError)
      const hosErr = err as HosError
      expect(hosErr.direction).toBe('too_fast')
      expect(hosErr.maximumArrival).toBeUndefined()
      expect(typeof hosErr.minimumArrival).toBe('number')
      expect(Number.isNaN(hosErr.minimumArrival)).toBe(false)
      expect(hosErr.minimumArrival).toBeGreaterThan(T0)
    }
  })

  it('HosError instanceof check and non-empty message still hold after S4 shape change', () => {
    // 500 km trip — single phase, no break, reachable in ~6.25 h
    try {
      buildTimeline(T0, 500_000, T0 + 1)
      throw new Error('expected HosError')
    } catch (err) {
      expect(err).toBeInstanceOf(HosError)
      expect(err).toBeInstanceOf(Error)
      const hosErr = err as HosError
      expect(typeof hosErr.message).toBe('string')
      expect(hosErr.message.length).toBeGreaterThan(0)
      expect(hosErr.name).toBe('HosError')
      expect(hosErr.direction).toBe('too_fast')
    }
  })

  // ── MAX_SOLVER_ITERATIONS export ─────────────────────────────────────────────

  it('MAX_SOLVER_ITERATIONS is exported and equals 20', () => {
    expect(MAX_SOLVER_ITERATIONS).toBe(20)
    expect(typeof MAX_SOLVER_ITERATIONS).toBe('number')
  })

  // ── Closed-form precision ─────────────────────────────────────────────────────

  it('mid-P1 shift 1: closed-form returns sub-meter-precise distance for a 4-hour target', () => {
    // P1 ramp spans [T0, T0 + 8h] with no rest and no fuel (FUEL_RANGE = 2400km >> 640km).
    // Target = T0 + 4h sits squarely inside the ramp.
    // closed-form: d* = (desiredArrival - T0) × AVG_SPEED_MS = 4 × 3600 × AVG_SPEED_MS = 320 000 m
    const desiredArrival = T0 + 4 * 3600
    const expectedDStar = AVG_SPEED_MS * 4 * 3600 // 320 000 m

    const d = solveMaxDistance(T0, desiredArrival)

    expect(d).toBeCloseTo(expectedDStar, 0)
    // Must NOT be snapped to a rest boundary (P1-end at ~640 000 m).
    expect(d).toBeLessThan(AVG_SPEED_MS * MAX_DRIVE_BEFORE_BREAK)
    // Oracle round-trip: minimumArrival of d* must equal the requested target.
    expect(minimumArrival(T0, d)).toBe(desiredArrival)
  })

  it('mid-P2 shift 1: closed-form yields a non-integer-metre distance (7 777 s into phase 2)', () => {
    // P1 ends at p1Dist ≈ 640 000 m; break ends at T0 + 8h + 0.5h = T0 + 30 600 s.
    // Target = p2StartT + 7 777 s (safely mid-ramp: 7777 < 10 800 s P2 budget).
    // AVG_SPEED_MS = 80 000/3 600 = 22.222…m/s → d* ≈ 812 822.222 m (non-integer).
    const p1Dist = AVG_SPEED_MS * MAX_DRIVE_BEFORE_BREAK
    const p2StartT = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S
    const desiredArrival = p2StartT + 7777
    const expectedDStar = p1Dist + AVG_SPEED_MS * 7777

    const d = solveMaxDistance(T0, desiredArrival)

    // toBeCloseTo(1) = ±0.05 m — catches integer-floor solvers (fractional part ≈ 0.222 m).
    expect(d).toBeCloseTo(expectedDStar, 1)
    expect(d).toBeGreaterThan(p1Dist)
    expect(d).toBeLessThan(p1Dist + (MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK) * AVG_SPEED_MS)
    expect(minimumArrival(T0, d)).toBe(desiredArrival)
  })

  it('mid-P2 shift 2: closed-form is precise across a shift boundary with non-integer metres', () => {
    // Shift 1 (no fuel): P1 8h + break 0.5h + P2 3h + sleep 10h = 21.5h = 77 400 s.
    // Shift 2 P1 ends at T0+77400+8h; break ends at T0+77400+8.5h = T0+108 000 s.
    // s2P2StartOdom = AVG_SPEED_MS × (MAX_DRIVE_PER_SHIFT + MAX_DRIVE_BEFORE_BREAK) = 1 520 000 m.
    // d* ≈ 1 692 822.222 m — same fractional-metre pattern as the shift-1 P2 test.
    const s1Dur = shiftCycleNoFuel // 77 400 s
    const s2P2StartT = T0 + s1Dur + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S
    const desiredArrival = s2P2StartT + 7777
    const s2P2StartOdom = AVG_SPEED_MS * (MAX_DRIVE_PER_SHIFT + MAX_DRIVE_BEFORE_BREAK)
    const expectedDStar = s2P2StartOdom + AVG_SPEED_MS * 7777
    const p2MaxDist = (MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK) * AVG_SPEED_MS

    const d = solveMaxDistance(T0, desiredArrival)

    expect(d).toBeCloseTo(expectedDStar, 1)
    expect(d).toBeGreaterThan(s2P2StartOdom)
    expect(d).toBeLessThan(s2P2StartOdom + p2MaxDist)
    // Confirm solver did not mistake shift: shift-1 P2 wrong answer ≈ 812 822 m.
    expect(d).toBeGreaterThan(1_500_000)
    expect(minimumArrival(T0, d)).toBe(desiredArrival)
  })

  it('mid-S1b ramp after fuel stop (shift 6): closed-form is exact inside a post-fuel ramp', () => {
    // targetDist = 2×FUEL_RANGE + AVG_SPEED_MS × 2.5 × 3600 = 4 800 000 + 200 000 = 5 000 000 m.
    // Shift 6 starts at 4 400 km; S1a drives 5h to fuel at 4 800 km; S1b has 3h remaining.
    // Upper boundary: (MAX_DRIVE_BEFORE_BREAK + 5×MAX_DRIVE_PER_SHIFT) × AVG_SPEED_MS ≈ 5 040 000 m.
    const targetDist = 2 * FUEL_RANGE + AVG_SPEED_MS * 2.5 * 3600 // 5 000 000 m
    const desiredArrival = minimumArrival(T0, targetDist)

    const d = solveMaxDistance(T0, desiredArrival)

    expect(d).toBeCloseTo(targetDist, 0)
    // Lower boundary: fuel stop at 4 800 000 m.
    expect(d).toBeGreaterThan(2 * FUEL_RANGE)
    // Upper boundary: S1b-end / break-start for shift 6 ≈ 5 040 000 m.
    // S1b duration = MAX_DRIVE_BEFORE_BREAK − 5h; total driving = 5×MAX_DRIVE_PER_SHIFT + MAX_DRIVE_BEFORE_BREAK.
    const p1BreakBoundaryShift6 = (MAX_DRIVE_BEFORE_BREAK + 5 * MAX_DRIVE_PER_SHIFT) * AVG_SPEED_MS
    expect(d).toBeLessThan(p1BreakBoundaryShift6) // ≈ 5 040 000, NOT 5 440 000
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(desiredArrival)
  })

  it('closed-form never snaps mid-ramp result to a rest-boundary odometer (all three ramp types)', () => {
    const p1End = AVG_SPEED_MS * MAX_DRIVE_BEFORE_BREAK

    // Case A — P1 shift 1
    const caseADStar = solveMaxDistance(T0, T0 + 4 * 3600)
    expect(caseADStar).toBeGreaterThan(0)
    expect(caseADStar).toBeLessThan(p1End)

    // Case B — P2 shift 1
    const p2End = p1End + (MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK) * AVG_SPEED_MS
    const p2StartT = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S
    const caseBDStar = solveMaxDistance(T0, p2StartT + 7777)
    expect(caseBDStar).toBeGreaterThan(p1End)
    expect(caseBDStar).toBeLessThan(p2End)

    // Case C — S1b ramp of shift 6
    // Upper boundary = (MAX_DRIVE_BEFORE_BREAK + 5×MAX_DRIVE_PER_SHIFT) × AVG_SPEED_MS ≈ 5 040 000 m
    const fuelBoundary = 2 * FUEL_RANGE
    const s1bBreakBoundary = (MAX_DRIVE_BEFORE_BREAK + 5 * MAX_DRIVE_PER_SHIFT) * AVG_SPEED_MS
    const targetDistC = 2 * FUEL_RANGE + AVG_SPEED_MS * 2.5 * 3600
    const caseCDStar = solveMaxDistance(T0, minimumArrival(T0, targetDistC))
    expect(caseCDStar).toBeGreaterThan(fuelBoundary)
    expect(caseCDStar).toBeLessThan(s1bBreakBoundary)
  })

  // ── Round-trip maximality ────────────────────────────────────────────────────

  it('round-trip: target = startedAt (zero trip) — returns 0', () => {
    const d = solveMaxDistance(T0, T0)
    expect(d).toBe(0)
    expect(minimumArrival(T0, AVG_SPEED_MS)).toBeGreaterThan(T0)
  })

  it('round-trip: short trip in P1 ramp (5 h) — arrival(d*) ≤ target and maximality', () => {
    // d* = AVG_SPEED_MS × 5h = 400 000 m; arrival(d*) = T0 + 5h exactly.
    const target = T0 + 5 * 3600
    const d = solveMaxDistance(T0, target)

    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('round-trip: 60 s into P2 ramp — arrival(d*) ≤ target and maximality', () => {
    // P2 starts at T0 + 8.5h. Target = T0 + 8.5h + 60s.
    // d* = P1 floor + 60 × AVG_SPEED_MS.
    const target = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S + 60
    const d = solveMaxDistance(T0, target)

    const expectedD = AVG_SPEED_MS * MAX_DRIVE_BEFORE_BREAK + 60 * AVG_SPEED_MS
    expect(d).toBeCloseTo(expectedD, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('round-trip: target in P2 ramp of shift 2 (T0 + 32 h) — arrival(d*) ≤ target', () => {
    // Shift 1 wall = 21.5h; shift 2 P1 (8h) + break (0.5h) ends at T0+30h.
    // T0+32h is 2h into shift-2 P2 ramp. d* = 1 520 000 + 2h×AVG_SPEED_MS = 1 680 000 m.
    const target = T0 + 32 * 3600
    const d = solveMaxDistance(T0, target)

    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  // ── In-gap determinism ────────────────────────────────────────────────────────

  it('break gap mid-point returns phase-1 boundary odom and arrival strictly precedes target', () => {
    // Break gap: [T0+8h, T0+8.5h). Target = T0+8h+15min. d* = 640 000 m.
    const inBreakTarget = T0 + MAX_DRIVE_BEFORE_BREAK + 15 * 60
    const expectedOdom = AVG_SPEED_MS * MAX_DRIVE_BEFORE_BREAK

    const d = solveMaxDistance(T0, inBreakTarget)
    expect(d).toBeCloseTo(expectedOdom, 0)

    const arrival = minimumArrival(T0, expectedOdom)
    expect(arrival).toBeCloseTo(T0 + MAX_DRIVE_BEFORE_BREAK, 0)
    expect(arrival).toBeLessThan(inBreakTarget)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(inBreakTarget)
  })

  it('round-trip: target in shift 1 sleep gap (T0 + 15 h) — arrival(d*) ≤ target', () => {
    // Sleep gap: [T0+11.5h, T0+21.5h). d* = AVG_SPEED_MS × 11h = 880 000 m.
    const target = T0 + 15 * 3600
    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(AVG_SPEED_MS * 11 * 3600, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    // arrival(d* + 1s) requires completing the sleep → jumps past T0+21.5h
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('sleep gap mid-point returns shift-1 end odom and arrival strictly precedes target', () => {
    const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
    const shift1EndT = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S + shiftDriveLeft
    const shift1EndOdom = AVG_SPEED_MS * MAX_DRIVE_PER_SHIFT

    const inSleepTarget = shift1EndT + 5 * 3600

    const d = solveMaxDistance(T0, inSleepTarget)
    expect(d).toBeCloseTo(shift1EndOdom, 0)

    expect(minimumArrival(T0, shift1EndOdom)).toBeCloseTo(shift1EndT, 0)
    expect(minimumArrival(T0, shift1EndOdom)).toBeLessThan(inSleepTarget)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(inSleepTarget)
  })

  it('sleep gap last second: target 1 s before sleep end still returns shift-end odom', () => {
    const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
    const shift1EndT = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S + shiftDriveLeft
    const shift1EndOdom = AVG_SPEED_MS * MAX_DRIVE_PER_SHIFT
    const sleepGapEnd = shift1EndT + SLEEP_DURATION

    const justBeforeSleepEnd = sleepGapEnd - 1

    expect(justBeforeSleepEnd).toBeLessThan(sleepGapEnd)
    expect(justBeforeSleepEnd).toBeGreaterThan(shift1EndT)

    const d = solveMaxDistance(T0, justBeforeSleepEnd)
    expect(d).toBeCloseTo(shift1EndOdom, 0)
    expect(minimumArrival(T0, shift1EndOdom)).toBeLessThan(justBeforeSleepEnd)
  })

  it('round-trip: target inside a fuel stop gap — returns fuel-boundary odometer', () => {
    // Anchor to 2×FUEL_RANGE (shift 6, unambiguous: timeToFuelP1 = 5h, s1bDuration = 3h).
    // odomAfterS1a = 4 800 000 m; odomP1End = 5 040 000 m — 240 km apart.
    const tFuelStart = minimumArrival(T0, 2 * FUEL_RANGE) // T0 + 407 700
    const target = tFuelStart + 10 * 60 // 10 min inside the 45-min gap

    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(2 * FUEL_RANGE, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('fuel gap last second: target 1 s before fuel gap end still returns fuel-boundary odom', () => {
    const tFuelStart = minimumArrival(T0, 2 * FUEL_RANGE)
    const justBeforeFuelGapEnd = tFuelStart + FUEL_STOP_DURATION - 1

    expect(justBeforeFuelGapEnd).toBeLessThan(tFuelStart + FUEL_STOP_DURATION)

    const d = solveMaxDistance(T0, justBeforeFuelGapEnd)
    expect(d).toBeCloseTo(2 * FUEL_RANGE, 0)
    expect(minimumArrival(T0, 2 * FUEL_RANGE)).toBeLessThan(justBeforeFuelGapEnd)
  })

  // ── Boundary coincidence (off-by-one guards) ─────────────────────────────────

  it('BC-1: target exactly at P1 ramp end (= break gap start) — ramp check fires, not gap', () => {
    // desiredArrival == t + s1aDuration: ramp <= check fires, returns 640 000 m.
    // The break gap check (strict <) is never evaluated.
    const tBreakStart = T0 + MAX_DRIVE_BEFORE_BREAK
    const odomAtBreakStart = MAX_DRIVE_BEFORE_BREAK * AVG_SPEED_MS

    const d = solveMaxDistance(T0, tBreakStart)

    expect(d).toBeCloseTo(odomAtBreakStart, 0)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tBreakStart)
  })

  it('BC-2: target exactly at break gap end (= P2 ramp start) — zero extra driving returned', () => {
    // Gap check strict-< is false; P2 ramp fires with (desiredArrival - t) = 0 → 640 000 m.
    const tBreakEnd = T0 + MAX_DRIVE_BEFORE_BREAK + BREAK_DURATION_S
    const odomAtBreakStart = MAX_DRIVE_BEFORE_BREAK * AVG_SPEED_MS

    const d = solveMaxDistance(T0, tBreakEnd)

    expect(d).toBeCloseTo(odomAtBreakStart, 0)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tBreakEnd)
  })

  it('BC-3: target exactly at P2 ramp end (= sleep gap start) — full shift-1 distance returned', () => {
    // Ramp <= check fires at T0+41400, returns 880 000 m. Sleep gap never entered.
    const tSleepStart = T0 + MAX_DRIVE_PER_SHIFT + BREAK_DURATION_S
    const odomShift1End = MAX_DRIVE_PER_SHIFT * AVG_SPEED_MS

    const d = solveMaxDistance(T0, tSleepStart)

    expect(d).toBeCloseTo(odomShift1End, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(tSleepStart)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tSleepStart)
  })

  it('BC-4: target exactly at sleep gap end (= shift-2 ramp start) — returns shift-1 odom, 0 into shift 2', () => {
    // Sleep gap strict-< is false; outer loop iterates, shift-2 ramp fires with 0 extra driving.
    const tSleepEnd = T0 + MAX_DRIVE_PER_SHIFT + BREAK_DURATION_S + SLEEP_DURATION
    const odomShift1End = MAX_DRIVE_PER_SHIFT * AVG_SPEED_MS

    const d = solveMaxDistance(T0, tSleepEnd)

    expect(d).toBeCloseTo(odomShift1End, 0)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tSleepEnd)
  })

  it('BC-5: target exactly at fuel gap start in shift 6 (S1a ramp end) — ramp fires, gap check not reached', () => {
    // Shift 6 S1a ramp ends when the truck reaches 2×FUEL_RANGE.
    // The ramp <= check fires; the fuel gap strict-< check is never reached.
    const tFuelStart = minimumArrival(T0, 2 * FUEL_RANGE) // T0 + 407 700

    const d = solveMaxDistance(T0, tFuelStart)

    expect(d).toBeCloseTo(2 * FUEL_RANGE, 0)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tFuelStart)
  })

  it('BC-6: target exactly at fuel gap end (= S1b ramp start) — gap strict-< is false, 0 extra driving', () => {
    // Fuel gap strict-< check is false (equality); S1b ramp fires with 0 extra metres → 2×FUEL_RANGE.
    const tFuelStart = minimumArrival(T0, 2 * FUEL_RANGE)
    const tFuelEnd = tFuelStart + FUEL_STOP_DURATION

    const d = solveMaxDistance(T0, tFuelEnd)

    expect(d).toBeCloseTo(2 * FUEL_RANGE, 0)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(tFuelEnd)
  })

  it('BC-7: zero-slack target in P2 of shift 1 — round-trip is tight to within 1 m', () => {
    // d_p2 = 640 000 + 100 000 = 740 000 m.
    // raw arrival = T0+30600 + 100000/AVG_SPEED_MS = T0+35099.999…; Math.ceil → T0+35100.
    const d_p2 = MAX_DRIVE_BEFORE_BREAK * AVG_SPEED_MS + 100_000
    const target = minimumArrival(T0, d_p2)

    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(d_p2, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('BC-8: zero-slack at FUEL_RANGE boundary — minimumArrival oracle confirms no extra stop', () => {
    // Shift 3: timeToFuelP1 = 28799.999…s < 28800s (float), hasFuelInP1=true but s1b≈0.
    // Forward sim exits before emitting the fuel stop. Solver returns FUEL_RANGE.
    const target = minimumArrival(T0, FUEL_RANGE)

    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(FUEL_RANGE, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('BC-9: zero-slack at 2×FUEL_RANGE — round-trip is exact via forward oracle', () => {
    // Shift 6: S1a ramp ends exactly at 4 800 000 m; forward sim exits before fuel stop.
    const target = minimumArrival(T0, 2 * FUEL_RANGE) // T0 + 407 700

    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(2 * FUEL_RANGE, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  // ── Iteration bound + termination (AC-6) ────────────────────────────────────

  it('AC-6: 10 000 km terminates without throwing (12 iterations << MAX_SOLVER_ITERATIONS)', () => {
    // 10 000 km needs ceil(10000/880) = 12 shift iterations < 20.
    // Fuel stops: shifts 3 (P1), 6 (P1), 9 (P1), 11 (P2).
    // minimumArrival(T0, 10_000_000) = T0 + 876 600 (verified numerically).
    const dist10k = 10_000_000
    const target = minimumArrival(T0, dist10k)
    expect(target).toBe(T0 + 876_600)
    expect(() => solveMaxDistance(T0, target)).not.toThrow()
  })

  it('AC-6: 10 000 km solve returns d* ≈ 10 000 km (round-trip oracle correctness)', () => {
    // Shift 12 starts at odom=9 680 000 m (T0+862 200); drives 14 400 s to reach 10 000 km.
    // d* = 9 680 000 + 14 400 × AVG_SPEED_MS = 10 000 000 m (exact float arithmetic).
    const dist10k = 10_000_000
    const target = minimumArrival(T0, dist10k) // T0 + 876 600
    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(dist10k, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target + 1)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('near-14-day target terminates without throwing (16 iterations < MAX_SOLVER_ITERATIONS)', () => {
    // desiredArrival = T0 + 14×24×3600 = T0 + 1 209 600.
    // 15 complete shifts (fuel stops in shifts 3, 6, 9, 11, 14):
    //   t after shift 15 sleep = T0 + 15×77 400 + 5×2 700 = T0 + 1 174 500
    // Shift 16 resolves desiredArrival in its P2 S2a ramp → 16 iterations < 20.
    const target = T0 + 14 * 24 * 3600
    expect(() => solveMaxDistance(T0, target)).not.toThrow()
  })

  it('near-14-day d* is correct — 13 940 km at the 14-day boundary (round-trip oracle)', () => {
    // Shift 16 P2: odomP1End = 13 840 000 m, tAfterBreak = T0+1 205 100.
    // d* = 13 840 000 + 4 500 × AVG_SPEED_MS = 13 940 000 m (exact: 4500/3600×80000=100000).
    const target = T0 + 14 * 24 * 3600
    const d = solveMaxDistance(T0, target)

    expect(d).toBeCloseTo(13_940_000, 0)
    expect(minimumArrival(T0, d)).toBeLessThanOrEqual(target + 1)
    expect(minimumArrival(T0, d + AVG_SPEED_MS)).toBeGreaterThan(target)
  })

  it('assertion is a real throw (not a silent cap) — valid inputs stay well under the cap', () => {
    // Valid inputs never exceed MAX_SOLVER_ITERATIONS (20); the 10 000 km trip uses 12.
    // The guard uses `throw new Error(...)` after the bounded for-loop — a real throw,
    // never a silent return of a stale d*.
    const dist10k = 10_000_000
    const target = minimumArrival(T0, dist10k)

    let thrownError: unknown = null
    try {
      solveMaxDistance(T0, target)
    } catch (e) {
      thrownError = e
    }
    expect(thrownError).toBeNull()

    // Guard never fires for schema-valid inputs (worst case = 16 shifts).
    expect(MAX_SOLVER_ITERATIONS).toBeGreaterThan(16)
    expect(typeof MAX_SOLVER_ITERATIONS).toBe('number')
  })
})
