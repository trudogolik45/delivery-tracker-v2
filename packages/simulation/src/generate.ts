// Node-only. Calls Mapbox Directions and builds the simplified driving-day timeline.
import type { Trip, GenerateTripInput, TripPreviewInput } from '@delivery/schemas'
import { getRoute } from './mapbox.js'
import { buildTimeline } from './hos.js'

export { HosError } from './hos.js'

export interface GenerateResult {
  trip: Trip
  minArrival: number // unix sec (из TimelineResult)
  lateArrival: boolean
}

export async function generateTrip(
  input: GenerateTripInput | TripPreviewInput,
  opts: { mapboxToken: string },
): Promise<GenerateResult> {
  const { polyline, totalDistance, waypointDistances } = await getRoute(
    input.origin,
    input.destination,
    input.waypoints,
    opts.mapboxToken,
  )

  const startedAt = Math.floor(input.startedAt)
  const desiredArrival = Math.floor(input.desiredArrival)
  // rng по умолчанию Math.random — единственный production-источник случайности [R7 AC1].
  const { segments, minArrival, lateArrival } = buildTimeline(
    startedAt,
    totalDistance,
    desiredArrival,
    Math.random,
    waypointDistances,
  )

  return {
    trip: { startedAt, polyline, totalDistance, segments, pauses: [] },
    minArrival,
    lateArrival,
  }
}
