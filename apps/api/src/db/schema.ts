import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  unique,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    shareDomain: text('share_domain').notNull().unique(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('brands_owner_id_idx').on(t.ownerId),
    uniqueIndex('brands_share_domain_lower_idx').on(sql`lower(${t.shareDomain})`),
  ],
)

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cargo = pgTable(
  'cargo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    fields: jsonb('fields').notNull().default({}),
    photoUploadIds: uuid('photo_upload_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cargo_brand_id_idx').on(t.brandId),
    check(
      'cargo_fields_object_and_bounded',
      sql`${t.fields} IS NOT NULL AND jsonb_typeof(${t.fields}) = 'object' AND octet_length(${t.fields}::text) <= 16384`,
    ),
  ],
)

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    cargoId: uuid('cargo_id')
      .notNull()
      .references(() => cargo.id, { onDelete: 'cascade' }),
    shareHash: text('share_hash').notNull().unique(),
    origin: jsonb('origin').notNull(),
    destination: jsonb('destination').notNull(),
    waypoints: jsonb('waypoints').notNull().default([]),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    desiredArrival: timestamp('desired_arrival', { withTimezone: true }).notNull(),
    pauses: jsonb('pauses').notNull().default([]),
    routeGeometry: jsonb('route_geometry'),
    timeline: jsonb('timeline'),
    totalDistanceMeters: integer('total_distance_meters'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trips_share_hash_idx').on(t.shareHash),
    // Tenant scope index — kept even after the future compound (brand_id, share_hash)
    // unique lands. Trade-off: the compound's leading column covers WHERE brand_id=?,
    // but admin tenant lists are far more frequent than share lookups, and the
    // narrower (brand_id) index is smaller and cache-friendlier for those scans.
    index('trips_brand_id_idx').on(t.brandId),
  ],
)

export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('uploads_brand_id_idx').on(t.brandId),
    // Compound unique: same sha256/storageKey from two brands → two upload rows,
    // same file on disk. Disk dedup preserved; DB ownership scoped per brand.
    unique('uploads_brand_storage_key_unique').on(t.brandId, t.storageKey),
  ],
)
