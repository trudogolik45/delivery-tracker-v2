import type { LineString } from '@delivery/schemas'

export type LatLng = { lat: number; lng: number; label?: string }

export type RouteResult = {
  polyline: LineString
  totalDistance: number // meters
  duration: number // seconds
  waypointDistances: number[] // cumulative meters along route for each intermediate waypoint
}

export async function getRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[],
  mapboxToken: string,
): Promise<RouteResult> {
  const coords = [origin, ...waypoints, destination].map((p) => `${p.lng},${p.lat}`).join(';')

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?geometries=geojson&overview=full&access_token=${mapboxToken}`

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Mapbox Directions error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    routes?: Array<{
      geometry: { type: 'LineString'; coordinates: [number, number][] }
      distance: number
      duration: number
      legs: Array<{ distance: number }>
    }>
    message?: string
  }

  if (data.message) throw new Error(`Mapbox error: ${data.message}`)

  const route = data.routes?.[0]
  if (!route) throw new Error('Mapbox returned no routes')

  // Epsilon for clamping fp-rounding noise near 0 or totalDistance (1 mm in meters)
  const EPSILON = 0.001

  const waypointDistances: number[] = []
  let cumulative = 0
  // legs has (waypoints.length + 1) entries; intermediate waypoints are at legs[0..n-2]
  for (let i = 0; i < route.legs.length - 1; i++) {
    const leg = route.legs[i]
    if (!leg) continue
    cumulative += leg.distance
    if (cumulative > EPSILON && cumulative < route.distance - EPSILON) {
      waypointDistances.push(cumulative)
    }
  }

  return {
    polyline: {
      type: 'LineString',
      coordinates: route.geometry.coordinates,
    },
    totalDistance: route.distance,
    duration: route.duration,
    waypointDistances,
  }
}
