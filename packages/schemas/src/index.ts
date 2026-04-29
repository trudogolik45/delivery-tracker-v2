import { z } from 'zod'

export const PingSchema = z.object({
  ok: z.literal(true),
  ts: z.number(),
})

export type Ping = z.infer<typeof PingSchema>