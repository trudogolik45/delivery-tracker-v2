import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRoute } from './mapbox.js'

// Minimal Mapbox response builder
function makeMapboxResponse(legs: { distance: number }[], totalDistance?: number, duration = 3600) {
  const computedTotal = legs.reduce((s, l) => s + l.distance, 0)
  return {
    routes: [
      {
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        },
        distance: totalDistance ?? computedTotal,
        duration,
        legs: legs.map((l) => ({ distance: l.distance })),
      },
    ],
  }
}

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve('error'),
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRoute', () => {
  describe('waypointDistances', () => {
    it('returns cumulative distances for intermediate waypoints (2 waypoints → 3 legs)', async () => {
      // 3 legs: origin→wp1 (100m), wp1→wp2 (200m), wp2→destination (150m)
      // waypointDistances = [100, 300]  (drop the last cumulative = totalDistance)
      mockFetch(makeMapboxResponse([{ distance: 100 }, { distance: 200 }, { distance: 150 }]))

      const result = await getRoute(
        { lat: 0, lng: 0 },
        { lat: 2, lng: 2 },
        [
          { lat: 0.5, lng: 0.5 },
          { lat: 1, lng: 1 },
        ],
        'tok',
      )

      expect(result.waypointDistances).toEqual([100, 300])
      expect(result.totalDistance).toBe(450)
    })

    it('returns single cumulative distance for 1 waypoint (2 legs)', async () => {
      // 2 legs: origin→wp1 (500m), wp1→destination (300m)
      // waypointDistances = [500]
      mockFetch(makeMapboxResponse([{ distance: 500 }, { distance: 300 }]))

      const result = await getRoute(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        [{ lat: 0.5, lng: 0.5 }],
        'tok',
      )

      expect(result.waypointDistances).toEqual([500])
      expect(result.totalDistance).toBe(800)
    })

    it('returns [] when no intermediate waypoints (0 waypoints → 1 leg)', async () => {
      // 1 leg: origin→destination (1000m)
      // waypointDistances = []
      mockFetch(makeMapboxResponse([{ distance: 1000 }]))

      const result = await getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [], 'tok')

      expect(result.waypointDistances).toEqual([])
      expect(result.totalDistance).toBe(1000)
    })

    it('clamps an offset that exceeds totalDistance due to rounding (near-end)', async () => {
      // Leg distances sum to slightly more than route.distance due to fp rounding:
      // legs[0].distance = 999.9999999, legs[1].distance = 0.0000001
      // cumulative after leg 0 = 999.9999999, which is within epsilon of totalDistance (1000)
      // → should be dropped (near-end)
      const totalDistance = 1000
      const body = {
        routes: [
          {
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            distance: totalDistance,
            duration: 3600,
            legs: [{ distance: 999.9999999 }, { distance: 0.0000001 }],
          },
        ],
      }
      mockFetch(body)

      const result = await getRoute(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        [{ lat: 0.5, lng: 0.5 }],
        'tok',
      )

      // The single waypoint offset (999.9999999) is within epsilon of totalDistance → dropped
      expect(result.waypointDistances).toEqual([])
    })

    it('drops an offset that is near 0 (epsilon guard)', async () => {
      // legs[0].distance is essentially 0 (fp noise), legs[1] carries the rest
      const totalDistance = 1000
      const body = {
        routes: [
          {
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            distance: totalDistance,
            duration: 3600,
            legs: [{ distance: 0.000001 }, { distance: 999.999999 }],
          },
        ],
      }
      mockFetch(body)

      const result = await getRoute(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        [{ lat: 0, lng: 0.0000001 }],
        'tok',
      )

      // Offset 0.000001 is within epsilon of 0 → dropped
      expect(result.waypointDistances).toEqual([])
    })

    it('keeps an offset that is clearly within (0, totalDistance)', async () => {
      // offset at 0.5m is > epsilon, and totalDistance - 0.5 is >> epsilon
      const totalDistance = 1000
      const body = {
        routes: [
          {
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            distance: totalDistance,
            duration: 3600,
            legs: [{ distance: 0.5 }, { distance: 999.5 }],
          },
        ],
      }
      mockFetch(body)

      const result = await getRoute(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        [{ lat: 0.5, lng: 0.5 }],
        'tok',
      )

      expect(result.waypointDistances).toEqual([0.5])
    })
  })

  describe('existing behaviour unchanged', () => {
    it('returns polyline and totalDistance and duration', async () => {
      mockFetch(makeMapboxResponse([{ distance: 1000 }]))

      const result = await getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [], 'tok')

      expect(result.polyline.type).toBe('LineString')
      expect(result.totalDistance).toBe(1000)
      expect(result.duration).toBe(3600)
    })

    it('throws on HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          text: () => Promise.resolve('bad request'),
        }),
      )

      await expect(getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [], 'tok')).rejects.toThrow(
        '422',
      )
    })

    it('throws when Mapbox returns a message field', async () => {
      mockFetch({ message: 'Invalid token' })

      await expect(getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [], 'tok')).rejects.toThrow(
        'Invalid token',
      )
    })

    it('throws when routes array is empty', async () => {
      mockFetch({ routes: [] })

      await expect(getRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, [], 'tok')).rejects.toThrow(
        'no routes',
      )
    })
  })
})
