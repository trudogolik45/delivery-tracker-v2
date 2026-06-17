import { describe, expect, it } from 'vitest'
import type { Segment } from '@delivery/schemas'
import { deriveLateArrival } from './trip-detail.js'

const desiredIso = '2026-06-20T00:00:00Z'
const desiredUnix = Math.floor(new Date(desiredIso).getTime() / 1000)

function driving(tStart: number, tEnd: number): Segment {
  return { type: 'driving', tStart, tEnd, distStart: 0, distEnd: 1000 }
}

function rest(tStart: number, tEnd: number, reason: 'sleep' | 'break' | 'fuel' | 'wait'): Segment {
  return { type: 'rest', tStart, tEnd, atDist: 1000, reason }
}

describe('deriveLateArrival', () => {
  it('is false for empty segments', () => {
    expect(deriveLateArrival(desiredIso, [])).toBe(false)
  })

  it('is true when the last segment ends after the window without a trailing wait', () => {
    const segs = [driving(desiredUnix - 3600, desiredUnix + 3600)]
    expect(deriveLateArrival(desiredIso, segs)).toBe(true)
  })

  it('is false when the timeline ends at or before the window', () => {
    const segs = [driving(desiredUnix - 7200, desiredUnix - 100)]
    expect(deriveLateArrival(desiredIso, segs)).toBe(false)
  })

  it('is false when a trailing wait padded arrival to the window (early arrival)', () => {
    const segs = [
      driving(desiredUnix - 7200, desiredUnix - 3600),
      rest(desiredUnix - 3600, desiredUnix, 'wait'),
    ]
    expect(deriveLateArrival(desiredIso, segs)).toBe(false)
  })

  it('applies the +1s guard so an exact one-second overrun is not late', () => {
    const segs = [driving(desiredUnix - 100, desiredUnix + 1)]
    expect(deriveLateArrival(desiredIso, segs)).toBe(false)
  })
})
