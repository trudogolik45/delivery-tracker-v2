import { z } from 'zod'

export const UserPublicSchema = z.object({
  id: z.uuid(),
  email: z.email(),
})
export type UserPublic = z.infer<typeof UserPublicSchema>

export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(256),
})
export type LoginInput = z.infer<typeof LoginInputSchema>

export const LoginResponseSchema = z.object({
  user: UserPublicSchema,
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const MeResponseSchema = z.object({
  user: UserPublicSchema,
})
export type MeResponse = z.infer<typeof MeResponseSchema>
