import { z } from 'zod'

// Largest sensible gap between startedAt and desiredArrival. Beyond this the
// HOS simulator only pads the timeline with idle `wait` time, and such a value
// almost always signals a client clock/units bug — reject it at the boundary.
export const MAX_ARRIVAL_WINDOW_SECONDS = 14 * 24 * 3600 // 14 days

// Порог «красного» предупреждения о простое у точки выгрузки: при ожидании ≥ 1.5 ч
// клиент показывает усиленное предупреждение. Живёт в schemas как единый источник
// для web (и при необходимости api).
export const WAIT_WARN_THRESHOLD_SECONDS = 5400 // 1.5 ч

// desiredArrival must lie strictly after startedAt and within the 14-day window.
// A non-positive gap (arrival at/before start) is just as much a clock/units bug
// as an over-long one, so reject both directions here rather than letting a
// non-positive gap fall through to a less precise HosError downstream.
const withinArrivalWindow = (v: { startedAt: number; desiredArrival: number }) => {
  const gap = v.desiredArrival - v.startedAt
  return gap > 0 && gap <= MAX_ARRIVAL_WINDOW_SECONDS
}

const arrivalWindowError = {
  error: 'desiredArrival must be after startedAt and within 14 days of it',
  path: ['desiredArrival'],
}

export const LatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().optional(),
})
export type LatLng = z.infer<typeof LatLngSchema>

export const GenerateTripInputSchema = z
  .object({
    cargoId: z.uuid(),
    origin: LatLngSchema,
    destination: LatLngSchema,
    waypoints: z.array(LatLngSchema).max(10).default([]),
    startedAt: z.number().int().positive(),
    desiredArrival: z.number().int().positive(),
  })
  .refine(withinArrivalWindow, arrivalWindowError)
export type GenerateTripInput = z.infer<typeof GenerateTripInputSchema>

export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
})
export type LineString = z.infer<typeof LineStringSchema>

export const PauseIntervalSchema = z.object({
  pausedAt: z.number(),
  resumedAt: z.number().optional(),
})
export type PauseInterval = z.infer<typeof PauseIntervalSchema>

export const DrivingSegmentSchema = z.object({
  type: z.literal('driving'),
  tStart: z.number(),
  tEnd: z.number(),
  distStart: z.number(),
  distEnd: z.number(),
})
export type DrivingSegment = z.infer<typeof DrivingSegmentSchema>

export const RestSegmentSchema = z.object({
  type: z.literal('rest'),
  tStart: z.number(),
  tEnd: z.number(),
  atDist: z.number(),
  reason: z.enum(['sleep', 'break', 'fuel', 'wait']),
})
export type RestSegment = z.infer<typeof RestSegmentSchema>

export const SegmentSchema = z.discriminatedUnion('type', [DrivingSegmentSchema, RestSegmentSchema])
export type Segment = z.infer<typeof SegmentSchema>

export const TripStatusSchema = z.enum(['Pending', 'Driving', 'Resting', 'Arrived'])
export type TripStatus = z.infer<typeof TripStatusSchema>

// Единственный источник логики статуса — раньше дублировалась на клиенте
// (apps/web/src/lib/trip-status.ts) и считалась из полного timeline в списке.
export function tripStatusFromTimeline(
  timeline: Segment[] | null | undefined,
  nowSeconds: number,
): TripStatus {
  if (!timeline || timeline.length === 0) return 'Pending'
  const firstSeg = timeline[0]
  const lastSeg = timeline[timeline.length - 1]
  if (!firstSeg || !lastSeg) return 'Pending'
  if (nowSeconds < firstSeg.tStart) return 'Pending'
  if (nowSeconds >= lastSeg.tEnd) return 'Arrived'
  const current = timeline.find((s) => s.tStart <= nowSeconds && nowSeconds < s.tEnd)
  if (!current) return 'Pending'
  return current.type === 'driving' ? 'Driving' : 'Resting'
}

export const TripSchema = z.object({
  startedAt: z.number(),
  polyline: LineStringSchema,
  totalDistance: z.number(),
  segments: z.array(SegmentSchema).min(1),
  pauses: z.array(PauseIntervalSchema).default([]),
})
export type Trip = z.infer<typeof TripSchema>

// Семантика desiredArrival — «не раньше»: поздний приезд больше не ошибка, а флаг.
// Дискриминированное объединение точно выражает инвариант «minimumArrival присутствует
// ⇔ lateArrival === true».
export const TripPreviewResponseSchema = z.discriminatedUnion('lateArrival', [
  z.object({ trip: TripSchema, lateArrival: z.literal(false) }),
  z.object({ trip: TripSchema, lateArrival: z.literal(true), minimumArrival: z.number().int() }),
])
export type TripPreviewResponse = z.infer<typeof TripPreviewResponseSchema>

export const TripCreateResponseSchema = z.discriminatedUnion('lateArrival', [
  z.object({ tripId: z.uuid(), shareHash: z.string(), lateArrival: z.literal(false) }),
  z.object({
    tripId: z.uuid(),
    shareHash: z.string(),
    lateArrival: z.literal(true),
    minimumArrival: z.number().int(),
  }),
])
export type TripCreateResponse = z.infer<typeof TripCreateResponseSchema>

export const TripPreviewInputSchema = z
  .object({
    origin: LatLngSchema,
    destination: LatLngSchema,
    waypoints: z.array(LatLngSchema).max(10).default([]),
    startedAt: z.number().int().positive(),
    desiredArrival: z.number().int().positive(),
  })
  .refine(withinArrivalWindow, arrivalWindowError)
export type TripPreviewInput = z.infer<typeof TripPreviewInputSchema>

export const TripListItemSchema = z.object({
  id: z.uuid(),
  shareHash: z.string(),
  cargoId: z.uuid(),
  cargoTitle: z.string(),
  origin: LatLngSchema,
  destination: LatLngSchema,
  startsAt: z.string(),
  desiredArrival: z.string(),
  startedAt: z.number().nullable(),
  totalDistance: z.number().nullable(),
  status: TripStatusSchema,
})
export type TripListItem = z.infer<typeof TripListItemSchema>

export const TripAdminSchema = z.object({
  id: z.uuid(),
  shareHash: z.string(),
  shareDomain: z.string(),
  cargoId: z.uuid(),
  cargoTitle: z.string(),
  origin: LatLngSchema,
  destination: LatLngSchema,
  waypoints: z.array(LatLngSchema),
  startsAt: z.string(),
  desiredArrival: z.string(),
  trip: TripSchema.nullable(),
})
export type TripAdmin = z.infer<typeof TripAdminSchema>
