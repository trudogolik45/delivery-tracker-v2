import { z } from 'zod'

export const CargoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  fields: z.record(z.string(), z.string()),
  photoUploadIds: z.array(z.uuid()),
  createdAt: z.string(),
})
export type Cargo = z.infer<typeof CargoSchema>

export const CargoWithPhotosSchema = CargoSchema.extend({
  photoUrls: z.array(z.string()),
})
export type CargoWithPhotos = z.infer<typeof CargoWithPhotosSchema>

export const CargoCreateSchema = z.object({
  title: z.string().min(1).max(255),
  fields: z.record(z.string(), z.string()).default({}),
  photoUploadIds: z.array(z.uuid()).default([]),
})
export type CargoCreate = z.infer<typeof CargoCreateSchema>

export const CargoUpdateSchema = CargoCreateSchema.partial()
export type CargoUpdate = z.infer<typeof CargoUpdateSchema>
