import { z } from 'zod'

export const LatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().optional(),
})
export type LatLng = z.infer<typeof LatLngSchema>

export const GenerateTripInputSchema = z.object({
  cargoId: z.uuid(),
  origin: LatLngSchema,
  destination: LatLngSchema,
  waypoints: z.array(LatLngSchema).max(10).default([]),
  startedAt: z.number().int().positive(),
  desiredArrival: z.number().int().positive(),
})
export type GenerateTripInput = z.infer<typeof GenerateTripInputSchema>

export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
})
export type LineString = z.infer<typeof LineStringSchema>

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

export const SegmentSchema = z.discriminatedUnion('type', [
  DrivingSegmentSchema,
  RestSegmentSchema,
])
export type Segment = z.infer<typeof SegmentSchema>

export const TripSchema = z.object({
  startedAt: z.number(),
  polyline: LineStringSchema,
  totalDistance: z.number(),
  segments: z.array(SegmentSchema).min(1),
})
export type Trip = z.infer<typeof TripSchema>

export const TripPreviewInputSchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
  waypoints: z.array(LatLngSchema).max(10).default([]),
  startedAt: z.number().int().positive(),
  desiredArrival: z.number().int().positive(),
})
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
  timeline: z.array(SegmentSchema).nullable(),
})
export type TripListItem = z.infer<typeof TripListItemSchema>

export const TripAdminSchema = z.object({
  id: z.uuid(),
  shareHash: z.string(),
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
