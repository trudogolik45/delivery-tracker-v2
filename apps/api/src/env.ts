import 'dotenv/config'

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
}

export const isProd = env.NODE_ENV === 'production'
