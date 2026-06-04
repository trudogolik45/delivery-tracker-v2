import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Brand } from '@delivery/schemas'
import { db } from './index.js'
import { cargo, trips, uploads } from './schema.js'

// ─── Row / insert types lifted directly from the Drizzle schema ───────────────

export type CargoRow = typeof cargo.$inferSelect
export type CargoInsert = typeof cargo.$inferInsert
export type TripRow = typeof trips.$inferSelect
export type TripInsert = typeof trips.$inferInsert
export type UploadInsert = typeof uploads.$inferInsert

// Joined trip row used by share + admin trip-detail. The cargo columns are
// nullable to mirror the leftJoin shape, even though by data invariant a trip
// always has a cargo.
export type TripJoined = TripRow & {
  cargoTitle: string | null
  cargoFields: unknown
  cargoPhotoUploadIds: string[]
}

// Lighter row for admin trip lists — no waypoints / route geometry / pauses.
export type TripListRow = Pick<
  TripRow,
  | 'id'
  | 'shareHash'
  | 'cargoId'
  | 'origin'
  | 'destination'
  | 'startsAt'
  | 'desiredArrival'
  | 'timeline'
  | 'totalDistanceMeters'
> & { cargoTitle: string | null }

export type PauseResult = { ok: true } | { ok: false; reason: 'not_found' | 'already_paused' }

export type ResumeResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_paused' }

export type TenantDb = {
  cargo: {
    listAll(): Promise<CargoRow[]>
    byId(id: string): Promise<CargoRow | undefined>
    insert(values: Omit<CargoInsert, 'brandId'>): Promise<CargoRow>
    update(
      id: string,
      patch: Partial<Omit<CargoInsert, 'brandId' | 'id'>>,
    ): Promise<CargoRow | undefined>
    delete(id: string): Promise<{ id: string } | undefined>
  }
  trips: {
    byShareHash(hash: string): Promise<TripJoined | undefined>
    byId(id: string): Promise<TripJoined | undefined>
    listAll(): Promise<TripListRow[]>
    insert(values: Omit<TripInsert, 'brandId'>): Promise<{ id: string; shareHash: string }>
    delete(id: string): Promise<{ id: string } | undefined>
    pauseAtomic(id: string, nowSeconds: number, durationSeconds?: number): Promise<PauseResult>
    resumeAtomic(id: string, nowSeconds: number): Promise<ResumeResult>
  }
  uploads: {
    findOwnedIds(ids: readonly string[]): Promise<string[]>
    insertOrGetByStorageKey(values: Omit<UploadInsert, 'brandId'>): Promise<{ id: string }>
  }
}

/**
 * Tenant-scoped database helper. Every method embeds
 * `eq(<table>.brandId, brand.id)` in its predicate or its insert values —
 * that is the ONLY guarantee this helper provides. Routes that go through
 * `tenantDb(brand)` cannot accidentally read or write rows belonging to
 * a different tenant.
 *
 * Architectural rule (enforced by `admin.arch.test.ts`): code under
 * `src/routes`, `src/middleware`, `src/auth` MUST NOT call
 * `db.from(cargo|trips|uploads)` directly. Use this helper instead.
 */
export function tenantDb(brand: Brand): TenantDb {
  const brandId = brand.id

  // ── cargo ───────────────────────────────────────────────────────────────────
  const cargoApi: TenantDb['cargo'] = {
    async listAll() {
      return await db.select().from(cargo).where(eq(cargo.brandId, brandId))
    },

    async byId(id) {
      const [row] = await db
        .select()
        .from(cargo)
        .where(and(eq(cargo.id, id), eq(cargo.brandId, brandId)))
        .limit(1)
      return row
    },

    async insert(values) {
      const [row] = await db
        .insert(cargo)
        .values({ ...values, brandId })
        .returning()
      return row!
    },

    async update(id, patch) {
      const [row] = await db
        .update(cargo)
        .set(patch)
        .where(and(eq(cargo.id, id), eq(cargo.brandId, brandId)))
        .returning()
      return row
    },

    async delete(id) {
      const [deleted] = await db
        .delete(cargo)
        .where(and(eq(cargo.id, id), eq(cargo.brandId, brandId)))
        .returning({ id: cargo.id })
      return deleted
    },
  }

  // ── trips ───────────────────────────────────────────────────────────────────
  // Explicit column projection for the joined shape. Keeps Drizzle's inferred
  // result type aligned with `TripJoined` without needing `getTableColumns`.
  const tripJoinedSelect = {
    id: trips.id,
    brandId: trips.brandId,
    cargoId: trips.cargoId,
    shareHash: trips.shareHash,
    origin: trips.origin,
    destination: trips.destination,
    waypoints: trips.waypoints,
    startsAt: trips.startsAt,
    desiredArrival: trips.desiredArrival,
    pauses: trips.pauses,
    routeGeometry: trips.routeGeometry,
    timeline: trips.timeline,
    totalDistanceMeters: trips.totalDistanceMeters,
    createdAt: trips.createdAt,
    cargoTitle: cargo.title,
    cargoFields: cargo.fields,
    cargoPhotoUploadIds: cargo.photoUploadIds,
  } as const

  const tripListSelect = {
    id: trips.id,
    shareHash: trips.shareHash,
    cargoId: trips.cargoId,
    origin: trips.origin,
    destination: trips.destination,
    startsAt: trips.startsAt,
    desiredArrival: trips.desiredArrival,
    timeline: trips.timeline,
    totalDistanceMeters: trips.totalDistanceMeters,
    cargoTitle: cargo.title,
  } as const

  function toTripJoined(row: {
    id: string
    brandId: string
    cargoId: string
    shareHash: string
    origin: unknown
    destination: unknown
    waypoints: unknown
    startsAt: Date
    desiredArrival: Date
    pauses: unknown
    routeGeometry: unknown
    timeline: unknown
    totalDistanceMeters: number | null
    createdAt: Date
    cargoTitle: string | null
    cargoFields: unknown
    cargoPhotoUploadIds: string[] | null
  }): TripJoined {
    return {
      id: row.id,
      brandId: row.brandId,
      cargoId: row.cargoId,
      shareHash: row.shareHash,
      origin: row.origin,
      destination: row.destination,
      waypoints: row.waypoints,
      startsAt: row.startsAt,
      desiredArrival: row.desiredArrival,
      pauses: row.pauses,
      routeGeometry: row.routeGeometry,
      timeline: row.timeline,
      totalDistanceMeters: row.totalDistanceMeters,
      createdAt: row.createdAt,
      cargoTitle: row.cargoTitle,
      cargoFields: row.cargoFields,
      cargoPhotoUploadIds: row.cargoPhotoUploadIds ?? [],
    }
  }

  const tripsApi: TenantDb['trips'] = {
    async byShareHash(hash) {
      const [row] = await db
        .select(tripJoinedSelect)
        .from(trips)
        .leftJoin(cargo, and(eq(cargo.id, trips.cargoId), eq(cargo.brandId, brandId)))
        .where(and(eq(trips.brandId, brandId), eq(trips.shareHash, hash)))
        .limit(1)
      return row ? toTripJoined(row) : undefined
    },

    async byId(id) {
      const [row] = await db
        .select(tripJoinedSelect)
        .from(trips)
        .leftJoin(cargo, and(eq(cargo.id, trips.cargoId), eq(cargo.brandId, brandId)))
        .where(and(eq(trips.id, id), eq(trips.brandId, brandId)))
        .limit(1)
      return row ? toTripJoined(row) : undefined
    },

    async listAll() {
      return await db
        .select(tripListSelect)
        .from(trips)
        .leftJoin(cargo, eq(trips.cargoId, cargo.id))
        .where(eq(trips.brandId, brandId))
    },

    async insert(values) {
      const [row] = await db
        .insert(trips)
        .values({ ...values, brandId })
        .returning({ id: trips.id, shareHash: trips.shareHash })
      return row!
    },

    async delete(id) {
      const [deleted] = await db
        .delete(trips)
        .where(and(eq(trips.id, id), eq(trips.brandId, brandId)))
        .returning({ id: trips.id })
      return deleted
    },

    // Pause/resume SQL is lifted verbatim from admin.ts (pre-refactor) —
    // the WHERE clause encodes the "not already paused" / "currently paused"
    // guard atomically so concurrent calls cannot double-pause / double-resume.
    async pauseAtomic(id, nowSeconds, durationSeconds) {
      const pauseObj =
        durationSeconds !== undefined
          ? sql`jsonb_build_object('pausedAt', ${nowSeconds}::bigint, 'resumedAt', ${nowSeconds + durationSeconds}::bigint)`
          : sql`jsonb_build_object('pausedAt', ${nowSeconds}::bigint)`

      const updated = await db
        .update(trips)
        .set({ pauses: sql`${trips.pauses} || ${pauseObj}` })
        .where(
          and(
            eq(trips.id, id),
            eq(trips.brandId, brandId),
            sql`(jsonb_array_length(${trips.pauses}) = 0 OR (${trips.pauses}->-1) ? 'resumedAt')`,
          ),
        )
        .returning({ id: trips.id })

      if (updated.length > 0) return { ok: true }

      const [exists] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.brandId, brandId)))
        .limit(1)
      if (!exists) return { ok: false, reason: 'not_found' }
      return { ok: false, reason: 'already_paused' }
    },

    async resumeAtomic(id, nowSeconds) {
      const updated = await db
        .update(trips)
        .set({
          pauses: sql`jsonb_set(${trips.pauses}, array[(jsonb_array_length(${trips.pauses}) - 1)::text, 'resumedAt'], to_jsonb(${nowSeconds}::bigint))`,
        })
        .where(
          and(
            eq(trips.id, id),
            eq(trips.brandId, brandId),
            sql`jsonb_array_length(${trips.pauses}) > 0`,
            sql`NOT ((${trips.pauses}->-1) ? 'resumedAt')`,
          ),
        )
        .returning({ id: trips.id })

      if (updated.length > 0) return { ok: true }

      const [exists] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.brandId, brandId)))
        .limit(1)
      if (!exists) return { ok: false, reason: 'not_found' }
      return { ok: false, reason: 'not_paused' }
    },
  }

  // ── uploads ─────────────────────────────────────────────────────────────────
  const uploadsApi: TenantDb['uploads'] = {
    async findOwnedIds(ids) {
      if (ids.length === 0) return []
      const idArray = ids as readonly string[]
      const rows = await db
        .select({ id: uploads.id })
        .from(uploads)
        .where(and(inArray(uploads.id, idArray as string[]), eq(uploads.brandId, brandId)))
      return rows.map((r) => r.id)
    },

    async insertOrGetByStorageKey(values) {
      const [inserted] = await db
        .insert(uploads)
        .values({ ...values, brandId })
        .onConflictDoNothing()
        .returning({ id: uploads.id })

      if (inserted) return { id: inserted.id }

      // Fallback: row already exists for this (brand_id, storage_key) pair.
      const [existing] = await db
        .select({ id: uploads.id })
        .from(uploads)
        .where(and(eq(uploads.storageKey, values.storageKey), eq(uploads.brandId, brandId)))
        .limit(1)
      return { id: existing!.id }
    },
  }

  return {
    cargo: cargoApi,
    trips: tripsApi,
    uploads: uploadsApi,
  }
}
