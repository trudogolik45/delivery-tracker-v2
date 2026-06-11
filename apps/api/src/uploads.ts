import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db/index.js'
import { uploads } from './db/schema.js'
import { storage } from './storage/index.js'

// Карта uploadId -> public URL для ВСЕХ переданных id одним запросом.
// brandId обязателен: функция не должна резолвить чужие загрузки, даже если
// вызывающий передал «не свои» id — последняя линия tenant-изоляции.
export async function resolvePhotoUrlMap(
  brandId: string,
  photoUploadIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(photoUploadIds)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({ id: uploads.id, storageKey: uploads.storageKey })
    .from(uploads)
    .where(and(inArray(uploads.id, unique), eq(uploads.brandId, brandId)))
  return new Map(rows.map((r) => [r.id, storage.url(r.storageKey)]))
}

export async function resolvePhotoUrls(
  brandId: string,
  photoUploadIds: string[],
): Promise<string[]> {
  const urlMap = await resolvePhotoUrlMap(brandId, photoUploadIds)
  return photoUploadIds.map((id) => urlMap.get(id)).filter((u): u is string => u !== undefined)
}
