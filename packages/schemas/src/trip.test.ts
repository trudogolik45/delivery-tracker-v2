import { describe, it, expect } from 'vitest'
import {
  GenerateTripInputSchema,
  TripPreviewInputSchema,
  MAX_ARRIVAL_WINDOW_SECONDS,
  WAIT_WARN_THRESHOLD_SECONDS,
  WAYPOINT_STOP_SECONDS,
  RestSegmentSchema,
  TripPreviewResponseSchema,
  TripCreateResponseSchema,
  tripStatusFromTimeline,
} from './trip.js'
import type { Segment, Trip } from './trip.js'

// Fixture: 3-segment timeline  driving(0-3600) / rest(3600-7200) / driving(7200-10800)
const T0 = 1_700_000_000
const TIMELINE: Segment[] = [
  { type: 'driving', tStart: T0, tEnd: T0 + 3600, distStart: 0, distEnd: 100 },
  { type: 'rest', tStart: T0 + 3600, tEnd: T0 + 7200, atDist: 100, reason: 'sleep' },
  { type: 'driving', tStart: T0 + 7200, tEnd: T0 + 10800, distStart: 100, distEnd: 200 },
]

describe('tripStatusFromTimeline', () => {
  it('returns Pending when now is before first tStart', () => {
    expect(tripStatusFromTimeline(TIMELINE, T0 - 1)).toBe('Pending')
  })

  it('returns Driving when now is inside a driving segment', () => {
    expect(tripStatusFromTimeline(TIMELINE, T0 + 1800)).toBe('Driving')
  })

  it('returns Resting when now is inside a rest segment', () => {
    expect(tripStatusFromTimeline(TIMELINE, T0 + 5000)).toBe('Resting')
  })

  it('returns Arrived when now >= last tEnd', () => {
    expect(tripStatusFromTimeline(TIMELINE, T0 + 10800)).toBe('Arrived')
    expect(tripStatusFromTimeline(TIMELINE, T0 + 99999)).toBe('Arrived')
  })

  it('returns Pending for null timeline', () => {
    expect(tripStatusFromTimeline(null, T0 + 1000)).toBe('Pending')
  })

  it('returns Pending for empty timeline', () => {
    expect(tripStatusFromTimeline([], T0 + 1000)).toBe('Pending')
  })

  it('returns Driving at the exact boundary now === firstSeg.tStart', () => {
    expect(tripStatusFromTimeline(TIMELINE, T0)).toBe('Driving')
  })
})

const ORIGIN = { lat: 40.7128, lng: -74.006 }
const DESTINATION = { lat: 41.8781, lng: -87.6298 }
const CARGO_ID = '00000000-0000-4000-8000-000000000000'
const STARTED_AT = 1_700_000_000

describe('arrival-window validation', () => {
  const previewBase = {
    origin: ORIGIN,
    destination: DESTINATION,
    startedAt: STARTED_AT,
  }
  const generateBase = { ...previewBase, cargoId: CARGO_ID }

  it('accepts a desiredArrival inside the 14-day window', () => {
    const r = TripPreviewInputSchema.safeParse({
      ...previewBase,
      desiredArrival: STARTED_AT + MAX_ARRIVAL_WINDOW_SECONDS,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a desiredArrival beyond the 14-day window with a desiredArrival path', () => {
    const r = TripPreviewInputSchema.safeParse({
      ...previewBase,
      desiredArrival: STARTED_AT + MAX_ARRIVAL_WINDOW_SECONDS + 1,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(['desiredArrival'])
    }
  })

  it('rejects a desiredArrival at or before startedAt (non-positive window)', () => {
    const equal = TripPreviewInputSchema.safeParse({ ...previewBase, desiredArrival: STARTED_AT })
    expect(equal.success).toBe(false)
    if (!equal.success) {
      expect(equal.error.issues[0]!.path).toEqual(['desiredArrival'])
    }

    const before = TripPreviewInputSchema.safeParse({
      ...previewBase,
      desiredArrival: STARTED_AT - 3600,
    })
    expect(before.success).toBe(false)
    if (!before.success) {
      expect(before.error.issues[0]!.path).toEqual(['desiredArrival'])
    }
  })

  it('applies the same window to the generate-trip input', () => {
    const ok = GenerateTripInputSchema.safeParse({
      ...generateBase,
      desiredArrival: STARTED_AT + 3600,
    })
    expect(ok.success).toBe(true)

    const tooFar = GenerateTripInputSchema.safeParse({
      ...generateBase,
      desiredArrival: STARTED_AT + MAX_ARRIVAL_WINDOW_SECONDS + 1,
    })
    expect(tooFar.success).toBe(false)
  })
})

describe('WAIT_WARN_THRESHOLD_SECONDS', () => {
  it('equals 1.5 hours expressed in seconds', () => {
    expect(WAIT_WARN_THRESHOLD_SECONDS).toBe(5400)
  })
})

describe('WAYPOINT_STOP_SECONDS', () => {
  it('equals 5 hours expressed in seconds', () => {
    expect(WAYPOINT_STOP_SECONDS).toBe(18000)
  })
})

describe('RestSegmentSchema', () => {
  it('accepts all four rest reasons', () => {
    for (const reason of ['sleep', 'break', 'fuel', 'wait'] as const) {
      const r = RestSegmentSchema.safeParse({
        type: 'rest',
        tStart: T0,
        tEnd: T0 + 600,
        atDist: 100,
        reason,
      })
      expect(r.success).toBe(true)
    }
  })

  it('accepts reason service_stop', () => {
    const r = RestSegmentSchema.safeParse({
      type: 'rest',
      tStart: T0,
      tEnd: T0 + WAYPOINT_STOP_SECONDS,
      atDist: 100,
      reason: 'service_stop',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown rest reason', () => {
    const r = RestSegmentSchema.safeParse({
      type: 'rest',
      tStart: T0,
      tEnd: T0 + 600,
      atDist: 100,
      reason: 'lunch',
    })
    expect(r.success).toBe(false)
  })
})

const SAMPLE_TRIP: Trip = {
  startedAt: T0,
  polyline: {
    type: 'LineString',
    coordinates: [
      [-74.006, 40.7128],
      [-87.6298, 41.8781],
    ],
  },
  totalDistance: 1200,
  segments: [{ type: 'driving', tStart: T0, tEnd: T0 + 3600, distStart: 0, distEnd: 1200 }],
  pauses: [],
}

describe('TripPreviewResponseSchema', () => {
  it('parses a late response carrying minimumArrival', () => {
    const r = TripPreviewResponseSchema.safeParse({
      trip: SAMPLE_TRIP,
      lateArrival: true,
      minimumArrival: T0 + 10000,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a late response without minimumArrival', () => {
    const r = TripPreviewResponseSchema.safeParse({
      trip: SAMPLE_TRIP,
      lateArrival: true,
    })
    expect(r.success).toBe(false)
  })

  it('parses a non-late response without minimumArrival and strips a stray one', () => {
    const r = TripPreviewResponseSchema.safeParse({
      trip: SAMPLE_TRIP,
      lateArrival: false,
      minimumArrival: T0 + 10000,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('minimumArrival' in r.data).toBe(false)
    }
  })

  it('rejects a non-integer minimumArrival', () => {
    const r = TripPreviewResponseSchema.safeParse({
      trip: SAMPLE_TRIP,
      lateArrival: true,
      minimumArrival: T0 + 0.5,
    })
    expect(r.success).toBe(false)
  })
})

describe('TripCreateResponseSchema', () => {
  const TRIP_ID = '11111111-1111-4111-8111-111111111111'

  it('parses a late response carrying minimumArrival', () => {
    const r = TripCreateResponseSchema.safeParse({
      tripId: TRIP_ID,
      shareHash: 'abc123',
      lateArrival: true,
      minimumArrival: T0 + 10000,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a late response without minimumArrival', () => {
    const r = TripCreateResponseSchema.safeParse({
      tripId: TRIP_ID,
      shareHash: 'abc123',
      lateArrival: true,
    })
    expect(r.success).toBe(false)
  })

  it('parses a non-late response without minimumArrival and strips a stray one', () => {
    const r = TripCreateResponseSchema.safeParse({
      tripId: TRIP_ID,
      shareHash: 'abc123',
      lateArrival: false,
      minimumArrival: T0 + 10000,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('minimumArrival' in r.data).toBe(false)
    }
  })

  it('rejects an invalid tripId', () => {
    const r = TripCreateResponseSchema.safeParse({
      tripId: 'not-a-uuid',
      shareHash: 'abc123',
      lateArrival: false,
    })
    expect(r.success).toBe(false)
  })
})
