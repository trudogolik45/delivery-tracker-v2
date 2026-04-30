import { z } from 'zod'

export const BrandPublicSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
})
export type BrandPublic = z.infer<typeof BrandPublicSchema>

export const BrandsArraySchema = z.array(BrandPublicSchema)
export type BrandsArray = z.infer<typeof BrandsArraySchema>
