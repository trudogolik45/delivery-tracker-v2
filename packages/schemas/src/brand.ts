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

const ShareDomainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i, 'invalid domain')
  .transform((v) => v.toLowerCase())

export const BrandCreateSchema = z.object({
  slug: BrandSlugSchema,
  name: z.string().min(1).max(120),
  shareDomain: ShareDomainSchema,
})
export type BrandCreate = z.infer<typeof BrandCreateSchema>

export const BrandDnsStatusSchema = z.object({
  resolved: z.boolean(),
  expected: z.array(z.string()),
  actual: z.array(z.string()),
})
export type BrandDnsStatus = z.infer<typeof BrandDnsStatusSchema>
