-- Migration 0008: tenant indexes (additive, P0 perf — review finding P0-1)
--
-- brands_owner_id_idx  — requireAdminBrand chokepoint, hit on every admin req
-- cargo_brand_id_idx   — admin cargo list / cross-tenant scope predicate
-- trips_brand_id_idx   — admin trip list (kept after 0012 compound unique;
--                        narrower than (brand_id, share_hash), better for
--                        tenant-list scans that don't filter by share_hash)
--
-- Scale notes: regular CREATE INDEX (not CONCURRENTLY) — safe at current size
-- (4 brands, dozens of trips/cargo on prod 2026-05-09). Switch to CONCURRENTLY
-- when tables exceed ~1M rows (requires bypassing Drizzle's transactional wrapper).

CREATE INDEX "brands_owner_id_idx" ON "brands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cargo_brand_id_idx" ON "cargo" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "trips_brand_id_idx" ON "trips" USING btree ("brand_id");