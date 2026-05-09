-- Migration 0007: add uploads.brand_id (tenant-scoped uploads, C4 security fix)
--
-- Hand-edited from Drizzle-generated DDL to be safe on a populated prod DB.
-- CLAUDE.md prohibits editing deployed migrations; 0007 is new and undeployed,
-- so adding backfill DML before first deployment is acceptable.
--
-- Execution order:
--  1. Add column nullable (no DEFAULT needed — we backfill immediately)
--  2. Backfill from cargo.photo_upload_ids (most uploads belong to one brand)
--  3. Delete orphan uploads not referenced by any cargo (no data loss: files
--     on disk survive; a future GC pass can clean them if desired)
--  4. Set NOT NULL now that all remaining rows have a value
--  5. Drop old single-column unique on storage_key
--  6. Add compound unique (brand_id, storage_key) — disk dedup preserved per brand
--  7. Add index on brand_id for query performance
--
-- OPERATOR: run this between API container restarts so no live writes occur
-- against uploads during steps 3-4.

ALTER TABLE "uploads" ADD COLUMN "brand_id" uuid REFERENCES "public"."brands"("id") ON DELETE CASCADE;--> statement-breakpoint

UPDATE "uploads"
SET "brand_id" = (
  SELECT c."brand_id"
  FROM "cargo" c
  WHERE "uploads"."id" = ANY(c."photo_upload_ids")
  ORDER BY c."created_at" ASC
  LIMIT 1
)
WHERE "brand_id" IS NULL;--> statement-breakpoint

DELETE FROM "uploads" WHERE "brand_id" IS NULL;--> statement-breakpoint

ALTER TABLE "uploads" ALTER COLUMN "brand_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "uploads" DROP CONSTRAINT IF EXISTS "uploads_storage_key_unique";--> statement-breakpoint

ALTER TABLE "uploads" ADD CONSTRAINT "uploads_brand_storage_key_unique" UNIQUE("brand_id","storage_key");--> statement-breakpoint

CREATE INDEX "uploads_brand_id_idx" ON "uploads" USING btree ("brand_id");
