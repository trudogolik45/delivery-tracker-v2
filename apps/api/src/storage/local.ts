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
