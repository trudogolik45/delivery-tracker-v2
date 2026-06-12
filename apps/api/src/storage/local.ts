import { createHash } from 'crypto'
import { mkdir, writeFile, unlink, access } from 'fs/promises'
import { join } from 'path'
import type { Storage } from './types.js'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Сигнатуры первых байтов для каждого разрешённого MIME. Проверяем содержимое,
// а не заявленный клиентом Content-Type — иначе HTML/SVG можно выдать за картинку.
export function sniffImageMime(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')))
    return 'image/png'
  if (
    data.length >= 6 &&
    (data.subarray(0, 6).toString('latin1') === 'GIF87a' ||
      data.subarray(0, 6).toString('latin1') === 'GIF89a')
  )
    return 'image/gif'
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  return null
}

export function makeKey(data: Buffer, mime: string): string {
  const sha256 = createHash('sha256').update(data).digest('hex')
  const ext = MIME_TO_EXT[mime] ?? 'bin'
  return `${sha256}.${ext}`
}

export class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private filePath(key: string): string {
    return join(this.root, key.slice(0, 2), key)
  }

  async put(key: string, data: Buffer, _mime: string): Promise<void> {
    const dir = join(this.root, key.slice(0, 2))
    await mkdir(dir, { recursive: true })
    await writeFile(this.filePath(key), data)
  }

  url(key: string): string {
    // Host-relative on purpose: when /uploads/<...> is fetched from the brand
    // share domain it resolves to the brand domain, when fetched from admin
    // it resolves to admin. Avoids leaking the admin host into share pages.
    return `/uploads/${key.slice(0, 2)}/${key}`
  }

  async delete(key: string): Promise<void> {
    await unlink(this.filePath(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.filePath(key))
      return true
    } catch {
      return false
    }
  }
}
