import type { Segment, DrivingSegment } from '@delivery/schemas'

// FMCSA property-carrying driver rules (simplified, no 60/70h rolling window)
const AVG_SPEED_MS = 88_000 / 3600 // 88 km/h → m/s
const MAX_DRIVE_BEFORE_BREAK = 8 * 3600 // 8 h
const BREAK_DURATION = 30 * 60 // 30 min
const MAX_DRIVE_PER_SHIFT = 11 * 3600 // 11 h total per shift
const SLEEP_DURATION = 10 * 3600 // 10 h rest between shifts

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
    throw new HosError(
      `Cannot arrive by requested time. Minimum arrival: ${new Date(minArrival * 1000).toISOString()}`,
      minArrival,
    )
  }

  return distributeSlack(minimum, desiredArrival - minArrival)
}

function simulateMinimum(startedAt: number, totalDistance: number): Segment[] {
  const segments: Segment[] = []
  let t = startedAt
  let dist = 0

  while (dist < totalDistance - 0.01) {
    // Phase 1: drive up to 8 h
    const d1 = makeDriving(t, dist, totalDistance, MAX_DRIVE_BEFORE_BREAK)
    segments.push(d1)
    t = d1.tEnd
    dist = d1.distEnd
    if (dist >= totalDistance - 0.01) break

    // Mandatory 30-min break
    segments.push({ type: 'rest', tStart: t, tEnd: t + BREAK_DURATION, atDist: dist, reason: 'break' })
    t += BREAK_DURATION

    // Phase 2: drive remaining 3 h of shift (11 h − 8 h)
    const d2 = makeDriving(t, dist, totalDistance, MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK)
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

// Distributes extra time evenly across sleep segments.
// All segments after each extended sleep shift forward accordingly.
function distributeSlack(segments: Segment[], slack: number): Segment[] {
  const sleepCount = segments.filter((s) => s.type === 'rest' && s.reason === 'sleep').length
  if (sleepCount === 0 || slack <= 0) return segments

  const extra = slack / sleepCount
  let shift = 0
  return segments.map((seg) => {
    const s = { ...seg, tStart: seg.tStart + shift, tEnd: seg.tEnd + shift }
    if (s.type === 'rest' && s.reason === 'sleep') {
      shift += extra
      return { ...s, tEnd: s.tEnd + extra }
    }
    return s
  })
}
