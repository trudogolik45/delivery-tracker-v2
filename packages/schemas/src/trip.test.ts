import { describe, it, expect } from 'vitest'
import {
  GenerateTripInputSchema,
  TripPreviewInputSchema,
  MAX_ARRIVAL_WINDOW_SECONDS,
} from './trip.js'

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
