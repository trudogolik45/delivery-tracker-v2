import { z } from 'zod'

// Exported for tests — call .safeParse() directly against this schema.
// Never import env.ts in tests (it calls process.exit on validation failure).
export const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(20),
    JWT_SECRET: z.string().min(32),
    INTERNAL_TOKEN: z.string().min(32),
    MAPBOX_TOKEN: z.string().optional(),
    PUBLIC_BASE: z.string().optional(),
    STORAGE_ROOT: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      const token = data.MAPBOX_TOKEN ?? ''
      if (!token.startsWith('pk.') && !token.startsWith('sk.')) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAPBOX_TOKEN'],
          message: 'MAPBOX_TOKEN must start with pk. or sk. in production',
        })
      }
      const base = data.PUBLIC_BASE ?? ''
      if (!base) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_BASE'],
          message: 'PUBLIC_BASE is required in production',
        })
      } else {
        try {
          const url = new URL(base)
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            ctx.addIssue({
              code: 'custom',
              path: ['PUBLIC_BASE'],
              message: 'PUBLIC_BASE must not be localhost in production',
            })
          }
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['PUBLIC_BASE'],
            message: 'PUBLIC_BASE must be a valid URL',
          })
        }
      }
    }
  })
