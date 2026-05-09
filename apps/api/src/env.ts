import 'dotenv/config'
import { join } from 'path'
import { z } from 'zod'
import { EnvSchema } from './env.schema.js'

// Resolved env type with all optional fields filled in with defaults.
export type ResolvedEnv = {
  DATABASE_URL: string
  JWT_SECRET: string
  INTERNAL_TOKEN: string
  MAPBOX_TOKEN: string
  PUBLIC_BASE: string
  STORAGE_ROOT: string
  NODE_ENV: 'development' | 'test' | 'production'
}

function loadEnv(): ResolvedEnv {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error(
      'Invalid environment configuration:',
      JSON.stringify(z.treeifyError(parsed.error), null, 2),
    )
    process.exit(1)
  }

  const data = parsed.data
  return {
    DATABASE_URL: data.DATABASE_URL,
    JWT_SECRET: data.JWT_SECRET,
    INTERNAL_TOKEN: data.INTERNAL_TOKEN,
    MAPBOX_TOKEN: data.MAPBOX_TOKEN ?? '',
    PUBLIC_BASE: data.PUBLIC_BASE ?? 'http://localhost:3000',
    STORAGE_ROOT: data.STORAGE_ROOT ?? join(process.cwd(), 'uploads'),
    NODE_ENV: data.NODE_ENV,
  }
}

export const env = loadEnv()

export const isProd = env.NODE_ENV === 'production'
