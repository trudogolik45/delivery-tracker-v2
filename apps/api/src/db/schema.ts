import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  shareDomain: text('share_domain').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cargo = pgTable('cargo', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  fields: jsonb('fields').notNull().default({}),
  photoUploadIds: uuid('photo_upload_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    routeGeometry: jsonb('route_geometry'),
    timeline: jsonb('timeline'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trips_share_hash_idx').on(t.shareHash)],
)

export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  storageKey: text('storage_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
