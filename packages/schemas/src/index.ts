import { z } from 'zod'

export const BrandPublicSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
})
export type BrandPublic = z.infer<typeof BrandPublicSchema>
