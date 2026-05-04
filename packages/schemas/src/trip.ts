import { z } from 'zod'

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
