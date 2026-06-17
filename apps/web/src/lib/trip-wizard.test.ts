import { describe, expect, it } from 'vitest'
import {
  buildPreviewBody,
  canAdvanceTiming,
  canCreate,
  computeTimingError,
  serializePreviewKey,
  waitLevel,
} from './trip-wizard.js'

const origin = { label: 'Origin', lat: 40.7, lng: -74 }
const destination = { label: 'Dest', lat: 34, lng: -118 }

describe('computeTimingError', () => {
  it('returns null when either field is empty', () => {
    expect(computeTimingError('', '2026-06-20T12:00')).toBeNull()
    expect(computeTimingError('2026-06-18T12:00', '')).toBeNull()
  })

  it('errors when arrival is not strictly after departure', () => {
    expect(computeTimingError('2026-06-18T12:00', '2026-06-18T12:00')).toMatch(/after departure/)
    expect(computeTimingError('2026-06-18T12:00', '2026-06-18T10:00')).toMatch(/after departure/)
  })

  it('errors when the gap exceeds 14 days', () => {
    expect(computeTimingError('2026-06-18T12:00', '2026-07-10T12:00')).toMatch(/14 days/)
  })

  it('returns null for a valid window', () => {
    expect(computeTimingError('2026-06-18T12:00', '2026-06-20T12:00')).toBeNull()
  })
})

describe('canAdvanceTiming', () => {
  it('is false when a field is empty', () => {
    expect(canAdvanceTiming('', '2026-06-20T12:00')).toBe(false)
  })

  it('is false on a validation error', () => {
    expect(canAdvanceTiming('2026-06-18T12:00', '2026-06-18T10:00')).toBe(false)
  })

  it('is true for a valid window', () => {
    expect(canAdvanceTiming('2026-06-18T12:00', '2026-06-20T12:00')).toBe(true)
  })
})

describe('waitLevel', () => {
  it('is none for zero/negative idle', () => {
    expect(waitLevel(0)).toBe('none')
    expect(waitLevel(-10)).toBe('none')
  })

  it('is notice below the threshold', () => {
    expect(waitLevel(1)).toBe('notice')
    expect(waitLevel(5399)).toBe('notice')
  })

  it('is red at or above WAIT_WARN_THRESHOLD_SECONDS (5400)', () => {
    expect(waitLevel(5400)).toBe('red')
    expect(waitLevel(36000)).toBe('red')
  })
})

describe('canCreate', () => {
  it('is true only with a trip, not loading and no error', () => {
    expect(canCreate({ hasTrip: true, loading: false, error: null })).toBe(true)
  })

  it('is false without a trip', () => {
    expect(canCreate({ hasTrip: false, loading: false, error: null })).toBe(false)
  })

  it('is false while loading', () => {
    expect(canCreate({ hasTrip: true, loading: true, error: null })).toBe(false)
  })

  it('is false on a non-late error', () => {
    expect(canCreate({ hasTrip: true, loading: false, error: 'boom' })).toBe(false)
  })
})

describe('buildPreviewBody', () => {
  it('returns null when origin or destination is missing', () => {
    expect(
      buildPreviewBody({
        origin: null,
        destination,
        waypoints: [],
        startedAt: 1,
        desiredArrival: 2,
      }),
    ).toBeNull()
    expect(
      buildPreviewBody({
        origin,
        destination: null,
        waypoints: [],
        startedAt: 1,
        desiredArrival: 2,
      }),
    ).toBeNull()
  })

  it('excludes unresolved (null) waypoints and carries timing through', () => {
    const wp = { label: 'WP', lat: 38, lng: -90 }
    const body = buildPreviewBody({
      origin,
      destination,
      waypoints: [wp, null, null],
      startedAt: 100,
      desiredArrival: 200,
    })
    expect(body).not.toBeNull()
    expect(body!.waypoints).toHaveLength(1)
    expect(body!.waypoints[0]).toMatchObject({ lat: 38, lng: -90 })
    expect(body!.origin).toMatchObject({ lat: 40.7, lng: -74 })
    expect(body!.startedAt).toBe(100)
    expect(body!.desiredArrival).toBe(200)
  })
})

describe('serializePreviewKey', () => {
  it('is null without origin/destination', () => {
    expect(
      serializePreviewKey({
        origin: null,
        destination,
        waypoints: [],
        startedAt: 1,
        desiredArrival: 2,
      }),
    ).toBeNull()
  })

  it('ignores unresolved waypoints and changes with timing', () => {
    const base = { origin, destination, waypoints: [null], startedAt: 1, desiredArrival: 2 }
    const k1 = serializePreviewKey(base)
    const k2 = serializePreviewKey({ ...base, waypoints: [] })
    expect(k1).toBe(k2)
    const k3 = serializePreviewKey({ ...base, desiredArrival: 3 })
    expect(k3).not.toBe(k1)
  })
})
