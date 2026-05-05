import { z } from 'zod'
import { TripSchema } from './trip.js'

export const CargoPublicSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  fields: z.record(z.string(), z.string()),
  photoUrls: z.array(z.string()),
})
export type CargoPublic = z.infer<typeof CargoPublicSchema>

export const ShareResponseSchema = z.object({
  trip: TripSchema,
  cargo: CargoPublicSchema,
})
export type ShareResponse = z.infer<typeof ShareResponseSchema>
