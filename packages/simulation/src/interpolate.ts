import along from '@turf/along'
import type { Trip, Segment, PauseInterval } from '@delivery/schemas'

export type InterpolatedPosition = {
  position: { lat: number; lng: number }
  segment: Segment
  progress: number
}

// Assumes pauses are sorted ascending by pausedAt (append-only invariant).
export function totalPausedSeconds(pauses: PauseInterval[], t: number): number {
  let total = 0
  for (const p of pauses) {
    if (p.pausedAt >= t) break
    const end = p.resumedAt !== undefined ? Math.min(p.resumedAt, t) : t
    total += end - p.pausedAt
  }
  return total
}

export function interpolatePosition(trip: Trip, t: number): InterpolatedPosition {
  const effectiveT = t - totalPausedSeconds(trip.pauses, t)
  const segments = trip.segments
  const first = segments[0]!
  const last = segments[segments.length - 1]!

  if (effectiveT <= first.tStart) {
    return atDistance(trip, first, segmentStartDist(first), 0)
  }
  if (effectiveT >= last.tEnd) {
    return atDistance(trip, last, segmentEndDist(last), 1)
  }

  const segment = findSegmentAt(segments, effectiveT)

  if (segment.type === 'driving') {
    const span = segment.tEnd - segment.tStart
    const ratio = span > 0 ? (effectiveT - segment.tStart) / span : 0
    const dist = segment.distStart + ratio * (segment.distEnd - segment.distStart)
    return atDistance(trip, segment, dist, dist / trip.totalDistance)
  }

  return atDistance(trip, segment, segment.atDist, segment.atDist / trip.totalDistance)
}

function findSegmentAt(segments: Segment[], t: number): Segment {
  let lo = 0
  let hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (segments[mid]!.tEnd <= t) lo = mid + 1
    else hi = mid
  }
  return segments[lo]!
}

function segmentStartDist(s: Segment): number {
  return s.type === 'driving' ? s.distStart : s.atDist
}

function segmentEndDist(s: Segment): number {
  return s.type === 'driving' ? s.distEnd : s.atDist
}

function atDistance(
  trip: Trip,
  segment: Segment,
  distMeters: number,
  rawProgress: number,
): InterpolatedPosition {
  const clampedDist = Math.max(0, Math.min(trip.totalDistance, distMeters))
  const point = along(trip.polyline, clampedDist / 1000, { units: 'kilometers' })
  const [lng, lat] = point.geometry.coordinates as [number, number]
  return {
    position: { lat, lng },
    segment,
    progress: Math.max(0, Math.min(1, rawProgress)),
  }
}
