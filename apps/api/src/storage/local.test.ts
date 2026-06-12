import { describe, it, expect } from 'vitest'
import { sniffImageMime, makeKey } from './local.js'

// ── sniffImageMime ────────────────────────────────────────────────────────────

describe('sniffImageMime', () => {
  it('recognises JPEG (FF D8 FF signature)', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffImageMime(buf)).toBe('image/jpeg')
  })

  it('recognises PNG (\\x89PNG\\r\\n\\x1a\\n signature)', () => {
    const sig = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')
    const buf = Buffer.concat([sig, Buffer.alloc(4)])
    expect(sniffImageMime(buf)).toBe('image/png')
  })

  it('recognises GIF87a', () => {
    const buf = Buffer.from('GIF87a', 'latin1')
    expect(sniffImageMime(buf)).toBe('image/gif')
  })

  it('recognises GIF89a', () => {
    const buf = Buffer.from('GIF89a', 'latin1')
    expect(sniffImageMime(buf)).toBe('image/gif')
  })

  it('recognises WebP (RIFF....WEBP signature)', () => {
    const buf = Buffer.alloc(12)
    buf.write('RIFF', 0, 'latin1')
    // bytes 4-7 are file size (arbitrary)
    buf.write('WEBP', 8, 'latin1')
    expect(sniffImageMime(buf)).toBe('image/webp')
  })

  it('returns null for SVG content', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf-8')
    expect(sniffImageMime(buf)).toBeNull()
  })

  it('returns null for HTML content', () => {
    const buf = Buffer.from('<!DOCTYPE html><html><body></body></html>', 'utf-8')
    expect(sniffImageMime(buf)).toBeNull()
  })

  it('returns null for empty buffer', () => {
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for random bytes that match no signature', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03])
    expect(sniffImageMime(buf)).toBeNull()
  })
})

// ── makeKey ───────────────────────────────────────────────────────────────────

describe('makeKey', () => {
  it('returns <sha256hex>.<ext> for known MIME types', () => {
    const data = Buffer.from('hello')
    const key = makeKey(data, 'image/jpeg')
    expect(key).toMatch(/^[0-9a-f]{64}\.jpg$/)
  })

  it('returns <sha256hex>.bin for unknown MIME types', () => {
    const data = Buffer.from('hello')
    const key = makeKey(data, 'application/octet-stream')
    expect(key).toMatch(/^[0-9a-f]{64}\.bin$/)
  })

  it('is deterministic for the same input', () => {
    const data = Buffer.from('same content')
    expect(makeKey(data, 'image/png')).toBe(makeKey(data, 'image/png'))
  })
})
