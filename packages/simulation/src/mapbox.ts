import type { LineString } from '@delivery/schemas'

export type LatLng = { lat: number; lng: number; label?: string }

export type RouteResult = {
  polyline: LineString
  totalDistance: number // meters
  duration: number // seconds
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
    }>
    message?: string
  }

  if (data.message) throw new Error(`Mapbox error: ${data.message}`)

  const route = data.routes?.[0]
  if (!route) throw new Error('Mapbox returned no routes')

  return {
    polyline: {
      type: 'LineString',
      coordinates: route.geometry.coordinates,
    },
    totalDistance: route.distance,
    duration: route.duration,
  }
}
