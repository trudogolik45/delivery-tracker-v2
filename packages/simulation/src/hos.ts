import type { Segment, DrivingSegment } from '@delivery/schemas'

// FMCSA property-carrying driver rules (simplified, no 60/70h rolling window)
// Heavy truck with a loaded trailer, not a car. Governed top speed × a road-class
// factor folding in urban ingress/egress, grades, and typical congestion.
// Exported (with its factors) so the variable-road-speeds work can later derate
// per Mapbox speed band without touching the HOS rule set.
export const GOVERNED_TOP_SPEED = 100_000 / 3600 // ~62 mph limiter, m/s
export const ROAD_CLASS_FACTOR = 0.8 // blended derate vs free-flow governed speed
export const TRUCK_AVG_SPEED_MS = GOVERNED_TOP_SPEED * ROAD_CLASS_FACTOR // 80 km/h → m/s
const MAX_DRIVE_BEFORE_BREAK = 8 * 3600 // 8 h
const BREAK_DURATION = 30 * 60 // 30 min
const MAX_DRIVE_PER_SHIFT = 11 * 3600 // 11 h total per shift
export const MAX_ONDUTY_WINDOW = 14 * 3600 // 14 h on-duty window — driving must cease 14 h after the shift starts (breaks included)
export const SLEEP_DURATION = 10 * 3600 // 10 h rest between shifts
// Upper bound for a single sleep. Slack beyond what sleeps can absorb (capped
// here) is emitted as a `wait` segment instead of inflating sleep to
// biologically impossible durations. 14 h is a plausibility/product choice
// (a driver sleeping 80h+ is obviously a data error) — it happens to equal
// MAX_ONDUTY_WINDOW but is a distinct constraint, so do not consolidate them.
export const SLEEP_DURATION_MAX = 14 * 3600 // 14 h
// Loaded long-haul refuelling: a tank good for ~1500 mi, ~45-min stop (pull in,
// fill, pay, pull out). Distance-triggered and on-duty-not-driving — the stop
// consumes the 14h window (via windowLeft) but NOT the per-phase driving budget,
// so it never shortens how far the driver may legally drive in a shift.
export const FUEL_RANGE = 2_400_000 // m (~1500 mi) between refuels
export const FUEL_STOP_DURATION = 45 * 60 // 45 min

// `direction` distinguishes the two ways a desiredArrival can be infeasible:
// 'too_fast' — even the shortest route arrives later than requested (carries
// `minimumArrival`, the earliest reachable time); 'too_slow' — even the longest
// tolerable detour arrives earlier than requested (carries `maximumArrival`, the
// latest reachable time). The constructor keeps its original positional shape so
// the existing two-arg call site and `err.minimumArrival` readers stay valid;
// `direction` defaults to 'too_fast' and `maximumArrival` is opt-in (set by the
// too-slow reject path added in S5).
export class HosError extends Error {
  readonly minimumArrival: number
  readonly direction: 'too_fast' | 'too_slow'
  readonly maximumArrival?: number
  constructor(
    message: string,
    minimumArrival: number,
    direction: 'too_fast' | 'too_slow' = 'too_fast',
    maximumArrival?: number,
  ) {
    super(message)
    this.name = 'HosError'
    this.minimumArrival = minimumArrival
    this.direction = direction
    this.maximumArrival = maximumArrival
  }
}

export function buildTimeline(
  startedAt: number,
  totalDistance: number,
  desiredArrival: number,
): Segment[] {
  const minimum = simulateMinimum(startedAt, totalDistance)
  const minArrival = minimum[minimum.length - 1]!.tEnd

  if (minArrival > desiredArrival) {
    // Round up to a whole second so the value is safe to echo back as
    // desiredArrival (TripPreviewInputSchema requires int seconds).
    const minArrivalInt = Math.ceil(minArrival)
    throw new HosError(
      `Cannot arrive by requested time. Minimum arrival: ${new Date(minArrivalInt * 1000).toISOString()}`,
      minArrivalInt,
    )
  }

  return distributeSlack(minimum, desiredArrival - minArrival)
}

export const MAX_SOLVER_ITERATIONS = 20

// Inverse of simulateMinimum: given a target wall-clock arrival, returns the
// MAXIMUM distance d* (metres, measured from d=0) a driver leaving at
// `startedAt` can cover while still arriving at or before `desiredArrival` under
// the same HOS rules. This is what the detour planner needs — "how long may the
// route be so the truck arrives on time, not early".
//
// arrival(d) is a monotone staircase: linear driving ramps (slope
// 1/TRUCK_AVG_SPEED_MS) separated by vertical jumps at each inserted rest
// (fuel 45 min, break 30 min, sleep 10 h). No distance maps into a jump's open
// interval. The solver walks ONE shift per iteration, resolves the target in
// closed form the instant it lands inside a ramp, and returns the boundary
// odometer when it lands inside a rest "gap". Because a shift drives ≤ 880 km
// ≪ FUEL_RANGE (2400 km), at most one fuel boundary falls in each phase, so each
// phase splits into at most two named sub-ramps (S1a/S1b, S2a/S2b) — no inner loop.
//
// The fuel-reached test is DISTANCE-based (`reachable odom ≥ nextFuel − 0.01`),
// mirroring driveWithFuel exactly, so the inverse and the forward simulator agree
// at the odometer where an 8 h budget ends precisely on a FUEL_RANGE multiple
// (e.g. 2400 km). A strict time compare would disagree there on a float coin-flip
// and silently drop a refuel, drifting d* ~45 min too far.
//
// The 14-day arrival window enforced by the schema bounds this to ≤ 16 shifts;
// MAX_SOLVER_ITERATIONS = 20 is therefore an assertion that never fires for valid
// input. If the loop ever ran away it throws rather than returning a stale d*.
export function solveMaxDistance(startedAt: number, desiredArrival: number): number {
  let t = startedAt
  let odom = 0

  for (let iteration = 0; iteration < MAX_SOLVER_ITERATIONS; iteration++) {
    const shiftStart = t // 14 h on-duty window opens here

    // ── Phase 1: up to 8 h driving, at most one FUEL_RANGE boundary inside it ──
    // +0.01 mirrors driveWithFuel: a boundary just refuelled at is not re-triggered.
    const nextFuelP1 = Math.ceil((odom + 0.01) / FUEL_RANGE) * FUEL_RANGE
    const p1MaxOdom = odom + MAX_DRIVE_BEFORE_BREAK * TRUCK_AVG_SPEED_MS
    const hasFuelInP1 = p1MaxOdom >= nextFuelP1 - 0.01
    const timeToFuelP1 = (nextFuelP1 - odom) / TRUCK_AVG_SPEED_MS
    const s1aDuration = hasFuelInP1 ? timeToFuelP1 : MAX_DRIVE_BEFORE_BREAK

    if (desiredArrival <= t + s1aDuration) {
      return odom + (desiredArrival - t) * TRUCK_AVG_SPEED_MS
    }
    const odomAfterS1a = odom + s1aDuration * TRUCK_AVG_SPEED_MS
    t += s1aDuration

    let odomP1End: number
    if (hasFuelInP1) {
      // Fuel gap [t, t + FUEL_STOP_DURATION) — strictly exclusive upper bound.
      if (desiredArrival < t + FUEL_STOP_DURATION) {
        return odomAfterS1a
      }
      t += FUEL_STOP_DURATION

      const s1bDuration = Math.max(0, MAX_DRIVE_BEFORE_BREAK - timeToFuelP1)
      if (desiredArrival <= t + s1bDuration) {
        return odomAfterS1a + (desiredArrival - t) * TRUCK_AVG_SPEED_MS
      }
      odomP1End = odomAfterS1a + s1bDuration * TRUCK_AVG_SPEED_MS
      t += s1bDuration
    } else {
      odomP1End = odomAfterS1a
    }

    // ── Mandatory 30-min break gap ────────────────────────────────────────────
    if (desiredArrival < t + BREAK_DURATION) {
      return odomP1End
    }
    t += BREAK_DURATION

    // ── Phase 2: rest of the 11 h shift driving, bounded by the 14 h window ────
    const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
    const windowLeft = MAX_ONDUTY_WINDOW - (t - shiftStart)
    const p2budget = Math.min(shiftDriveLeft, windowLeft)

    const nextFuelP2 = Math.ceil((odomP1End + 0.01) / FUEL_RANGE) * FUEL_RANGE
    const p2MaxOdom = odomP1End + p2budget * TRUCK_AVG_SPEED_MS
    const hasFuelInP2 = p2MaxOdom >= nextFuelP2 - 0.01
    const timeToFuelP2 = (nextFuelP2 - odomP1End) / TRUCK_AVG_SPEED_MS
    const s2aDuration = hasFuelInP2 ? timeToFuelP2 : p2budget

    if (desiredArrival <= t + s2aDuration) {
      return odomP1End + (desiredArrival - t) * TRUCK_AVG_SPEED_MS
    }
    const odomAfterS2a = odomP1End + s2aDuration * TRUCK_AVG_SPEED_MS
    t += s2aDuration

    let odomShiftEnd: number
    if (hasFuelInP2) {
      if (desiredArrival < t + FUEL_STOP_DURATION) {
        return odomAfterS2a
      }
      t += FUEL_STOP_DURATION

      const s2bDuration = Math.max(0, p2budget - timeToFuelP2)
      if (desiredArrival <= t + s2bDuration) {
        return odomAfterS2a + (desiredArrival - t) * TRUCK_AVG_SPEED_MS
      }
      odomShiftEnd = odomAfterS2a + s2bDuration * TRUCK_AVG_SPEED_MS
      t += s2bDuration
    } else {
      odomShiftEnd = odomAfterS2a
    }

    // ── 10-hour sleep gap before the next shift ───────────────────────────────
    if (desiredArrival < t + SLEEP_DURATION) {
      return odomShiftEnd
    }
    t += SLEEP_DURATION
    odom = odomShiftEnd
  }

  throw new Error(
    `assertion: solveMaxDistance exceeded ${MAX_SOLVER_ITERATIONS} shift iterations ` +
      `(startedAt=${startedAt}, desiredArrival=${desiredArrival})`,
  )
}

function simulateMinimum(startedAt: number, totalDistance: number): Segment[] {
  const segments: Segment[] = []
  let t = startedAt
  let dist = 0

  while (dist < totalDistance - 0.01) {
    const shiftStart = t // FMCSA 14h on-duty window opens when the shift begins

    // Phase 1: drive up to 8 h, refuelling at any FUEL_RANGE boundary crossed.
    const p1 = driveWithFuel(segments, t, dist, totalDistance, MAX_DRIVE_BEFORE_BREAK)
    t = p1.t
    dist = p1.dist
    if (dist >= totalDistance - 0.01) break

    // Mandatory 30-min break
    segments.push({
      type: 'rest',
      tStart: t,
      tEnd: t + BREAK_DURATION,
      atDist: dist,
      reason: 'break',
    })
    t += BREAK_DURATION

    // Phase 2: drive the rest of the shift, bounded by both the 11h shift
    // driving limit and the 14h on-duty window (breaks count toward the window).
    // shiftDriveLeft (3h) < windowLeft (5.5h) is a pure TIME inequality — driving
    // speed cancels out, so the truck-speed change (88→80 km/h) does not affect it.
    // windowLeft only begins to bind once extra on-duty NON-driving time is inserted
    // mid-shift (e.g. a 45-min fuel stop drops it to 4.75h, still > shiftDriveLeft).
    const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
    const windowLeft = MAX_ONDUTY_WINDOW - (t - shiftStart)
    const p2 = driveWithFuel(segments, t, dist, totalDistance, Math.min(shiftDriveLeft, windowLeft))
    t = p2.t
    dist = p2.dist
    if (dist >= totalDistance - 0.01) break

    // 10-hour sleep before next shift
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

// Drives up to `maxDriveSeconds` of DRIVING time from the (t, dist) cursor,
// inserting a `fuel` rest at each FUEL_RANGE odometer boundary crossed mid-drive.
// Fuel time advances the wall clock but is NOT charged against the driving budget
// (it is on-duty-not-driving), so a refuel never shortens a phase. Each fuel
// rest's atDist equals the preceding driving distEnd exactly, so interpolate.ts
// holds the marker static during the stop. Pushes onto `segments`, returns the
// advanced cursor.
function driveWithFuel(
  segments: Segment[],
  t: number,
  dist: number,
  totalDistance: number,
  maxDriveSeconds: number,
): { t: number; dist: number } {
  let driveLeft = maxDriveSeconds
  while (driveLeft > 0 && dist < totalDistance - 0.01) {
    // +0.01 so a boundary we just refuelled at is not re-triggered.
    const nextFuel = Math.ceil((dist + 0.01) / FUEL_RANGE) * FUEL_RANGE
    const secondsToFuel = (nextFuel - dist) / TRUCK_AVG_SPEED_MS
    const seg = makeDriving(t, dist, totalDistance, Math.min(driveLeft, secondsToFuel))
    segments.push(seg)
    driveLeft -= seg.tEnd - t // fuel time is added below, never debited here
    t = seg.tEnd
    dist = seg.distEnd
    // Refuel only when a boundary was actually reached mid-trip — not on arrival,
    // and not when the driving budget ran out short of the boundary.
    if (dist >= totalDistance - 0.01) break
    if (dist >= nextFuel - 0.01) {
      segments.push({
        type: 'rest',
        tStart: t,
        tEnd: t + FUEL_STOP_DURATION,
        atDist: dist,
        reason: 'fuel',
      })
      t += FUEL_STOP_DURATION
    }
  }
  return { t, dist }
}

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

// Absorbs slack between the minimum timeline and desiredArrival.
//
// Phase A: distribute slack evenly across sleep segments, but never extend a
// single sleep past SLEEP_DURATION_MAX. Segments after each extended sleep shift
// forward accordingly.
// Phase B: any slack the sleeps could not absorb becomes one `wait` segment at
// the destination — the driver staged at the drop point awaiting the delivery
// window — preserving the invariant that the final segment ends at desiredArrival.
//
// Trips with no sleep segments keep the minimum timeline (driver arrives early);
// leftover slack is not padded, matching the short-trip contract.
function distributeSlack(segments: Segment[], slack: number): Segment[] {
  if (slack <= 0) return segments

  const sleepCount = segments.filter((s) => s.type === 'rest' && s.reason === 'sleep').length
  if (sleepCount === 0) return segments

  const headroomPerSleep = SLEEP_DURATION_MAX - SLEEP_DURATION
  const absorbable = Math.min(slack, sleepCount * headroomPerSleep)
  const perSleep = absorbable / sleepCount
  const leftover = slack - absorbable

  let shift = 0
  const shifted = segments.map((seg) => {
    const s = { ...seg, tStart: seg.tStart + shift, tEnd: seg.tEnd + shift }
    if (s.type === 'rest' && s.reason === 'sleep') {
      shift += perSleep
      return { ...s, tEnd: s.tEnd + perSleep }
    }
    return s
  })

  if (leftover <= 0) return shifted

  const last = shifted[shifted.length - 1]!
  const atDist = last.type === 'driving' ? last.distEnd : last.atDist
  const wait: Segment = {
    type: 'rest',
    tStart: last.tEnd,
    tEnd: last.tEnd + leftover,
    atDist,
    reason: 'wait',
  }
  return [...shifted, wait]
}
