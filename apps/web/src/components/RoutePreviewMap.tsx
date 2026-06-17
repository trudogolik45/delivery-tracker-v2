import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2 } from 'lucide-react'
import type { Trip } from '@delivery/schemas'
import type { GeoPoint } from '@/components/GeoSearch'
import { MAP_STYLE } from '@/lib/map-style'

interface RoutePreviewMapProps {
  trip: Trip | null
  origin: GeoPoint | null
  destination: GeoPoint | null
  waypoints: (GeoPoint | null)[]
  loading: boolean
}

const ROUTE_SOURCE_ID = 'preview-route'
const ROUTE_LAYER_ID = 'preview-route-line'

// Превью-карта визарда: рисует polyline маршрута + маркеры origin/destination/waypoints.
// В отличие от TripMap здесь нет тикающего маркера водителя и status-футера —
// только статичный предпросмотр с overlay-спиннером во время пересчёта.
// Default-экспорт: компонент подключается через React.lazy [NFR-3].
export default function RoutePreviewMap({
  trip,
  origin,
  destination,
  waypoints,
  loading,
}: RoutePreviewMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)

  // Карта инициализируется один раз; далее обновляются только источник и маркеры.
  useEffect(() => {
    if (!mapContainer.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [-98, 39], // центр континентальных США как нейтральный дефолт
      zoom: 3,
    })
    mapRef.current = map

    const markStyleLoaded = () => setReady(true)
    if (map.isStyleLoaded()) setReady(true)
    else map.once('load', markStyleLoaded)
    map.on('error', (e) => console.error('[maplibre]', e.error ?? e))

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Линия маршрута + fitBounds при смене trip [R3 AC6]. Источник/слой пересоздаются,
  // чтобы не зависеть от строгой типизации GeoJSONSource.setData.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
    if (!trip) return

    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', geometry: trip.polyline, properties: {} },
    })
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: { 'line-color': '#0f172a', 'line-width': 3 },
    })

    const bounds = new maplibregl.LngLatBounds()
    for (const c of trip.polyline.coordinates) bounds.extend(c as [number, number])
    map.fitBounds(bounds, { padding: 60, duration: 0 })
  }, [trip, ready])

  // Маркеры origin/destination и разрешённых waypoints; пересоздаются при add/remove [R3 AC7].
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    const points: { point: GeoPoint; color: string }[] = []
    if (origin) points.push({ point: origin, color: '#16a34a' })
    for (const w of waypoints) if (w) points.push({ point: w, color: '#2563eb' })
    if (destination) points.push({ point: destination, color: '#dc2626' })

    for (const { point, color } of points) {
      const marker = new maplibregl.Marker({ color }).setLngLat([point.lng, point.lat]).addTo(map)
      markersRef.current.push(marker)
    }
  }, [origin, destination, waypoints, ready])

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
