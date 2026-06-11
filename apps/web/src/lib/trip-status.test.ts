import { describe, expect, it } from 'vitest'
import { statusBadgeVariant } from './trip-status.js'

describe('statusBadgeVariant', () => {
  it('returns "default" for Arrived', () => {
    expect(statusBadgeVariant('Arrived')).toBe('default')
  })

  it('returns "secondary" for Resting', () => {
    expect(statusBadgeVariant('Resting')).toBe('secondary')
  })

  it('returns "outline" for Driving', () => {
    expect(statusBadgeVariant('Driving')).toBe('outline')
  })

  it('returns "outline" for Pending', () => {
    expect(statusBadgeVariant('Pending')).toBe('outline')
  })
})
