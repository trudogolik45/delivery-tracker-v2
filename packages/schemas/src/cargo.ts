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
  fields: z
    .record(z.string().min(1).max(64), z.string().max(2000))
    .refine((o) => Object.keys(o).length <= 32, { message: 'too many fields' })
    .default({}),
  photoUploadIds: z.array(z.uuid()).max(20).default([]),
})
export type CargoCreate = z.infer<typeof CargoCreateSchema>

export const CargoUpdateSchema = CargoCreateSchema.partial()
export type CargoUpdate = z.infer<typeof CargoUpdateSchema>
