import { inArray } from 'drizzle-orm'
import { db } from './db/index.js'
import { uploads } from './db/schema.js'
import { storage } from './storage/index.js'

export async function resolvePhotoUrls(photoUploadIds: string[]): Promise<string[]> {
  if (photoUploadIds.length === 0) return []
  const rows = await db
    .select({ id: uploads.id, storageKey: uploads.storageKey })
    .from(uploads)
    .where(inArray(uploads.id, photoUploadIds))
  const keyMap = new Map(rows.map((r) => [r.id, r.storageKey]))
  return photoUploadIds
    .map((id) => keyMap.get(id))
    .filter((k): k is string => k !== undefined)
    .map((k) => storage.url(k))
}
