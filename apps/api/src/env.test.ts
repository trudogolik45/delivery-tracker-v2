import { describe, it, expect } from 'vitest'
import { EnvSchema } from './env.schema.js'

const BASE_VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  INTERNAL_TOKEN: 'b'.repeat(32),
  NODE_ENV: 'development',
}

describe('EnvSchema', () => {
  it('passes with all required fields in development', () => {
    const result = EnvSchema.safeParse(BASE_VALID)
    expect(result.success).toBe(true)
  })

  it('fails when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = BASE_VALID
    const result = EnvSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'JWT_SECRET')).toBe(true)
    }
  })

  it('fails when JWT_SECRET is shorter than 32 chars', () => {
    const result = EnvSchema.safeParse({ ...BASE_VALID, JWT_SECRET: 'short' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'JWT_SECRET')).toBe(true)
    }
  })

  it('fails when INTERNAL_TOKEN is missing', () => {
    const { INTERNAL_TOKEN: _omit, ...rest } = BASE_VALID
    const result = EnvSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'INTERNAL_TOKEN')).toBe(true)
    }
  })

  it('fails in production when MAPBOX_TOKEN is missing', () => {
    const result = EnvSchema.safeParse({
      ...BASE_VALID,
      NODE_ENV: 'production',
      PUBLIC_BASE: 'https://admin.example.com',
      // MAPBOX_TOKEN deliberately absent
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'MAPBOX_TOKEN')).toBe(true)
    }
  })

  it('fails in production when MAPBOX_TOKEN does not start with pk. or sk.', () => {
    const result = EnvSchema.safeParse({
      ...BASE_VALID,
      NODE_ENV: 'production',
      PUBLIC_BASE: 'https://admin.example.com',
      MAPBOX_TOKEN: 'nope.invalid',
    })
    expect(result.success).toBe(false)
  })

  it('passes in production with valid pk. MAPBOX_TOKEN and non-localhost PUBLIC_BASE', () => {
    const result = EnvSchema.safeParse({
      ...BASE_VALID,
      NODE_ENV: 'production',
      PUBLIC_BASE: 'https://admin.example.com',
      MAPBOX_TOKEN: 'pk.eyJhbGciOiJIUzI1NiJ9.fake',
    })
    expect(result.success).toBe(true)
  })

  it('fails in production when PUBLIC_BASE is localhost', () => {
    const result = EnvSchema.safeParse({
      ...BASE_VALID,
      NODE_ENV: 'production',
      PUBLIC_BASE: 'http://localhost:3000',
      MAPBOX_TOKEN: 'pk.valid',
    })
    expect(result.success).toBe(false)
  })

  it('fails when DATABASE_URL is shorter than 20 chars', () => {
    const result = EnvSchema.safeParse({ ...BASE_VALID, DATABASE_URL: 'short' })
    expect(result.success).toBe(false)
  })
})
