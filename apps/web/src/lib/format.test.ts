import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatMiles,
  formatShortDateTime,
  formatTime,
} from './format.js'

describe('formatMiles', () => {
  it('converts 1 mile in meters to "1 mi"', () => {
    expect(formatMiles(1609.344)).toBe('1 mi')
  })

  it('returns "0 mi" for 0 meters', () => {
    expect(formatMiles(0)).toBe('0 mi')
  })

  it('converts 100 miles in meters to "100 mi"', () => {
    expect(formatMiles(160934.4)).toBe('100 mi')
  })
})

describe('date formatting', () => {
  const fixed = new Date('2024-03-15T14:30:00Z')
  const fixedString = '2024-03-15T14:30:00Z'
  const fixedNumber = fixed.getTime()

  describe('formatDate', () => {
    it('returns a date string matching M/D/YYYY pattern', () => {
      expect(formatDate(fixed)).toMatch(/\d+\/\d+\/\d{4}/)
    })

    it('accepts a string and produces the same result as a Date', () => {
      expect(formatDate(fixedString)).toBe(formatDate(fixed))
    })

    it('accepts a number and produces the same result as a Date', () => {
      expect(formatDate(fixedNumber)).toBe(formatDate(fixed))
    })
  })

  describe('formatDateTime', () => {
    it('returns a string containing a year', () => {
      expect(formatDateTime(fixed)).toMatch(/\d{4}/)
    })

    it('returns a string containing AM or PM', () => {
      expect(formatDateTime(fixed)).toMatch(/AM|PM/)
    })

    it('accepts string and number yielding the same result as Date', () => {
      expect(formatDateTime(fixedString)).toBe(formatDateTime(fixed))
      expect(formatDateTime(fixedNumber)).toBe(formatDateTime(fixed))
    })
  })

  describe('formatTime', () => {
    it('returns a time string with AM or PM', () => {
      expect(formatTime(fixed)).toMatch(/AM|PM/)
    })

    it('accepts string and number yielding the same result as Date', () => {
      expect(formatTime(fixedString)).toBe(formatTime(fixed))
      expect(formatTime(fixedNumber)).toBe(formatTime(fixed))
    })
  })

  describe('formatShortDateTime', () => {
    it('returns a string with AM or PM', () => {
      expect(formatShortDateTime(fixed)).toMatch(/AM|PM/)
    })

    it('accepts string and number yielding the same result as Date', () => {
      expect(formatShortDateTime(fixedString)).toBe(formatShortDateTime(fixed))
      expect(formatShortDateTime(fixedNumber)).toBe(formatShortDateTime(fixed))
    })
  })
})
