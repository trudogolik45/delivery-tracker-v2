// Node-only. Calls Mapbox Directions and builds HOS-compliant timeline.
import type { Trip, GenerateTripInput } from '@delivery/schemas'
import { getRoute } from './mapbox.js'
import { buildTimeline } from './hos.js'

export { HosError } from './hos.js'

export async function generateTrip(
  input: GenerateTripInput,
  opts: { mapboxToken: string },
): Promise<Trip> {
  const { polyline, totalDistance } = await getRoute(
    input.origin,
    input.destination,
    input.waypoints,
    opts.mapboxToken,
  )

  const startedAt = Math.floor(input.startedAt)
  const desiredArrival = Math.floor(input.desiredArrival)
  const segments = buildTimeline(startedAt, totalDistance, desiredArrival)

  return { startedAt, polyline, totalDistance, segments, pauses: [] }
}
