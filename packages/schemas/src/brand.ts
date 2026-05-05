import { z } from 'zod'

export const BrandSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid brand slug')

export const BrandSchema = z.object({
  id: z.uuid(),
  slug: BrandSlugSchema,
  name: z.string(),
  shareDomain: z.string(),
})
export type Brand = z.infer<typeof BrandSchema>

export const BrandsArraySchema = z.array(BrandSchema)
export type BrandsArray = z.infer<typeof BrandsArraySchema>
