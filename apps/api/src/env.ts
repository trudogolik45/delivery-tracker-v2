import 'dotenv/config'
import { join } from 'path'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`missing required env var: ${name}`)
  }
  return value
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  MAPBOX_TOKEN: process.env.MAPBOX_TOKEN ?? '',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  STORAGE_ROOT: process.env.STORAGE_ROOT ?? join(process.cwd(), 'uploads'),
  PUBLIC_BASE: process.env.PUBLIC_BASE ?? 'http://localhost:3000',
}

export const isProd = env.NODE_ENV === 'production'
