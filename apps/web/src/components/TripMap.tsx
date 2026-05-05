import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Trip } from '@delivery/schemas'
import { interpolatePosition } from '@delivery/simulation/interpolate'

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const TICK_MS = 1_000

interface TripMapProps {
  trip: Trip
  cargoTitle?: string
  className?: string
  showFooter?: boolean
}

export function TripMap({ trip, cargoTitle, className, showFooter = true }: TripMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (!mapContainer.current) return

    const initial = interpolatePosition(trip, Math.floor(Date.now() / 1000))
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [initial.position.lng, initial.position.lat],
      zoom: 5,
    })
    mapRef.current = map

    const marker = new maplibregl.Marker({ color: '#0f172a' })
      .setLngLat([initial.position.lng, initial.position.lat])
      .addTo(map)
    markerRef.current = marker

    const addRouteLayer = () => {
      if (map.getLayer('route-line')) return
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: trip.polyline, properties: {} },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#0f172a', 'line-width': 3 },
      })

      const bounds = new maplibregl.LngLatBounds()
      for (const c of trip.polyline.coordinates) {
        bounds.extend(c as [number, number])
      }
      map.fitBounds(bounds, { padding: 60, duration: 0 })
    }

    if (map.isStyleLoaded()) addRouteLayer()
    else map.once('load', addRouteLayer)
    map.on('error', (e) => console.error('[maplibre]', e.error ?? e))

    return () => {
      marker.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [trip])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!markerRef.current) return
    const { position } = interpolatePosition(trip, now)
    markerRef.current.setLngLat([position.lng, position.lat])
  }, [trip, now])

  const state = interpolatePosition(trip, now)
  const lastSegment = trip.segments[trip.segments.length - 1]!
  const eta = new Date(lastSegment.tEnd * 1000)

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      {cargoTitle && (
        <header className="border-b px-6 py-3">
          <h1 className="text-lg font-semibold">{cargoTitle}</h1>
          <p className="text-xs text-muted-foreground">
            ETA {eta.toLocaleString()} · {(trip.totalDistance / 1000).toFixed(0)} km total
          </p>
        </header>
      )}
      <div ref={mapContainer} className="flex-1 min-h-[300px]" />
      {showFooter && (
        <footer className="border-t px-6 py-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">{describeStatus(state.segment, now)}</span>
            <span className="text-muted-foreground">{(state.progress * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-all duration-500"
              style={{ width: `${state.progress * 100}%` }}
            />
          </div>
        </footer>
      )}
    </div>
  )
}

function describeStatus(
  segment: { type: 'driving' } | { type: 'rest'; reason: string; tEnd: number },
  now: number,
): string {
  if (segment.type === 'driving') return 'On the road'
  const until = new Date(segment.tEnd * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const label =
    segment.reason === 'break'
      ? 'Break'
      : segment.reason === 'sleep'
        ? 'Resting'
        : segment.reason === 'fuel'
          ? 'Refueling'
          : 'Waiting'
  if (now >= segment.tEnd) return label
  return `${label} until ${until}`
}
