import { describe, it, expect } from 'vitest'
import length from '@turf/length'
import type { Trip, Segment } from '@delivery/schemas'
import { interpolatePosition, totalPausedSeconds } from './interpolate.js'

const polyline = {
  type: 'LineString' as const,
  coordinates: [
    [0, 0],
    [1, 0],
  ] as [number, number][],
}

const totalDistanceMeters =
  length(
    { type: 'Feature', geometry: polyline, properties: {} },
    { units: 'kilometers' },
  ) * 1000

function makeTrip(segments: Segment[]): Trip {
  return {
    startedAt: 0,
    polyline,
    totalDistance: totalDistanceMeters,
    segments,
    pauses: [],
  }
}

describe('interpolatePosition', () => {
  it('puts position at polyline start at t = first segment tStart', () => {
    const trip = makeTrip([
      { type: 'driving', tStart: 0, tEnd: 3600, distStart: 0, distEnd: totalDistanceMeters },
    ])
    const { position, progress } = interpolatePosition(trip, 0)
    expect(position.lng).toBeCloseTo(0, 4)
    expect(position.lat).toBeCloseTo(0, 4)
    expect(progress).toBe(0)
  })

  it('puts position at polyline end at t = last segment tEnd', () => {
    const trip = makeTrip([
      { type: 'driving', tStart: 0, tEnd: 3600, distStart: 0, distEnd: totalDistanceMeters },
    ])
    const { position, progress } = interpolatePosition(trip, 3600)
    expect(position.lng).toBeCloseTo(1, 4)
    expect(position.lat).toBeCloseTo(0, 4)
    expect(progress).toBe(1)
  })

  it('linearly interpolates within a driving segment', () => {
    const trip = makeTrip([
      { type: 'driving', tStart: 0, tEnd: 3600, distStart: 0, distEnd: totalDistanceMeters },
    ])
    const { position, progress } = interpolatePosition(trip, 1800)
    expect(position.lng).toBeCloseTo(0.5, 3)
    expect(position.lat).toBeCloseTo(0, 4)
    expect(progress).toBeCloseTo(0.5, 3)
  })

  it('keeps marker static during a rest segment', () => {
    const halfDist = totalDistanceMeters / 2
    const trip = makeTrip([
      { type: 'driving', tStart: 0, tEnd: 1800, distStart: 0, distEnd: halfDist },
      { type: 'rest', tStart: 1800, tEnd: 5400, atDist: halfDist, reason: 'break' },
      { type: 'driving', tStart: 5400, tEnd: 7200, distStart: halfDist, distEnd: totalDistanceMeters },
    ])
    const a = interpolatePosition(trip, 2000)
    const b = interpolatePosition(trip, 4000)
    expect(a.segment.type).toBe('rest')
    expect(b.segment.type).toBe('rest')
    expect(a.position.lng).toBeCloseTo(b.position.lng, 6)
    expect(a.position.lat).toBeCloseTo(b.position.lat, 6)
    expect(a.progress).toBeCloseTo(0.5, 3)
  })

  it('clamps to polyline start when t precedes first segment', () => {
    const trip = makeTrip([
      { type: 'driving', tStart: 100, tEnd: 200, distStart: 0, distEnd: totalDistanceMeters },
    ])
    const { position, progress } = interpolatePosition(trip, -50)
    expect(position.lng).toBeCloseTo(0, 4)
    expect(progress).toBe(0)
  })

  it('clamps to polyline end when t exceeds last segment', () => {
    const trip = makeTrip([
      { type: 'driving', tStart: 0, tEnd: 3600, distStart: 0, distEnd: totalDistanceMeters },
    ])
    const { position, progress } = interpolatePosition(trip, 99999)
    expect(position.lng).toBeCloseTo(1, 4)
    expect(progress).toBe(1)
  })

  it('selects the correct segment via binary search (no pauses)', () => {
    const segments: Segment[] = []
    const N = 20
    const stepDist = totalDistanceMeters / N
    for (let i = 0; i < N; i++) {
      segments.push({
        type: 'driving',
        tStart: i * 60,
        tEnd: (i + 1) * 60,
        distStart: i * stepDist,
        distEnd: (i + 1) * stepDist,
      })
    }
    const trip = makeTrip(segments)
    const { segment } = interpolatePosition(trip, 9.5 * 60)
    expect(segment.type).toBe('driving')
    if (segment.type === 'driving') {
      expect(segment.tStart).toBe(9 * 60)
      expect(segment.tEnd).toBe(10 * 60)
    }
  })
})

describe('totalPausedSeconds', () => {
  it('returns 0 for empty pauses', () => {
    expect(totalPausedSeconds([], 1000)).toBe(0)
  })

  it('counts a completed pause', () => {
    expect(totalPausedSeconds([{ pausedAt: 100, resumedAt: 600 }], 1000)).toBe(500)
  })

  it('counts an open pause up to t', () => {
    expect(totalPausedSeconds([{ pausedAt: 100 }], 600)).toBe(500)
  })

  it('ignores pauses starting at or after t', () => {
    expect(totalPausedSeconds([{ pausedAt: 1000 }], 1000)).toBe(0)
    expect(totalPausedSeconds([{ pausedAt: 2000 }], 1000)).toBe(0)
  })
})

describe('interpolatePosition with pauses', () => {
  const baseDriving = [
    { type: 'driving' as const, tStart: 0, tEnd: 3600, distStart: 0, distEnd: totalDistanceMeters },
  ]

  it('shifts position back by completed pause duration', () => {
    const trip: Trip = { ...makeTrip(baseDriving), pauses: [{ pausedAt: 1000, resumedAt: 1500 }] }
    const withPause = interpolatePosition(trip, 2000)
    const reference = interpolatePosition(makeTrip(baseDriving), 1500)
    expect(withPause.position.lng).toBeCloseTo(reference.position.lng, 5)
    expect(withPause.progress).toBeCloseTo(reference.progress, 5)
  })

  it('freezes position when pause is open', () => {
    const trip: Trip = { ...makeTrip(baseDriving), pauses: [{ pausedAt: 1800 }] }
    const atPause = interpolatePosition(trip, 1800)
    const later = interpolatePosition(trip, 3600)
    expect(atPause.progress).toBeCloseTo(0.5, 3)
    expect(later.progress).toBeCloseTo(atPause.progress, 5)
    expect(later.position.lng).toBeCloseTo(atPause.position.lng, 5)
  })
})
