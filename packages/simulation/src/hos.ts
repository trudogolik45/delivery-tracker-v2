import type { Segment, DrivingSegment } from '@delivery/schemas'

// FMCSA property-carrying driver rules (simplified, no 60/70h rolling window)
const AVG_SPEED_MS = 88_000 / 3600 // 88 km/h → m/s
const MAX_DRIVE_BEFORE_BREAK = 8 * 3600 // 8 h
const BREAK_DURATION = 30 * 60 // 30 min
const MAX_DRIVE_PER_SHIFT = 11 * 3600 // 11 h total per shift
const MAX_ONDUTY_WINDOW = 14 * 3600 // 14 h on-duty window — driving must cease 14 h after the shift starts (breaks included)
const SLEEP_DURATION = 10 * 3600 // 10 h rest between shifts
// Upper bound for a single sleep. Slack beyond what sleeps can absorb (capped
// here) is emitted as a `wait` segment instead of inflating sleep to
// biologically impossible durations. 14 h matches the FMCSA extended-rest
// ceiling and keeps share-page timelines plausible.
const SLEEP_DURATION_MAX = 14 * 3600 // 14 h

export class HosError extends Error {
  readonly minimumArrival: number
  constructor(message: string, minimumArrival: number) {
    super(message)
    this.name = 'HosError'
    this.minimumArrival = minimumArrival
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

function simulateMinimum(startedAt: number, totalDistance: number): Segment[] {
  const segments: Segment[] = []
  let t = startedAt
  let dist = 0

  while (dist < totalDistance - 0.01) {
    const shiftStart = t // FMCSA 14h on-duty window opens when the shift begins

    // Phase 1: drive up to 8 h
    const d1 = makeDriving(t, dist, totalDistance, MAX_DRIVE_BEFORE_BREAK)
    segments.push(d1)
    t = d1.tEnd
    dist = d1.distEnd
    if (dist >= totalDistance - 0.01) break

    // Mandatory 30-min break
    segments.push({ type: 'rest', tStart: t, tEnd: t + BREAK_DURATION, atDist: dist, reason: 'break' })
    t += BREAK_DURATION

    // Phase 2: drive the rest of the shift, bounded by both the 11h shift
    // driving limit and the 14h on-duty window (breaks count toward the window).
    const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
    const windowLeft = MAX_ONDUTY_WINDOW - (t - shiftStart)
    const d2 = makeDriving(t, dist, totalDistance, Math.min(shiftDriveLeft, windowLeft))
    segments.push(d2)
    t = d2.tEnd
    dist = d2.distEnd
    if (dist >= totalDistance - 0.01) break

    // 10-hour sleep before next shift
    segments.push({ type: 'rest', tStart: t, tEnd: t + SLEEP_DURATION, atDist: dist, reason: 'sleep' })
    t += SLEEP_DURATION
  }

  return segments
}

function makeDriving(
  tStart: number,
  distStart: number,
  totalDistance: number,
  maxSeconds: number,
): DrivingSegment {
  const remaining = totalDistance - distStart
  const drivingSeconds = Math.min(maxSeconds, remaining / AVG_SPEED_MS)
  return {
    type: 'driving',
    tStart,
    tEnd: tStart + drivingSeconds,
    distStart,
    distEnd: Math.min(totalDistance, distStart + drivingSeconds * AVG_SPEED_MS),
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
