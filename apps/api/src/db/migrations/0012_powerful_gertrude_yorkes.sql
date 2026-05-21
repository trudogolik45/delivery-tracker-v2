-- Migration 0012: compound tenant-scoped uniqueness on trips (additive — review H1 sec)
--
-- Pairs with the Host -> brand -> trip share resolver (apps/api/src/routes/share.ts)
-- so the lookup `WHERE brand_id = :brand AND share_hash = :hash` is index-served.
-- Coexists with the global `trips_share_hash_unique` until 0013 (destructive,
-- deferred until the new resolver is live in production for one full release).
--
-- Additive — no table rewrite, no row scan, no blocking lock besides ACCESS EXCLUSIVE
-- briefly during constraint validation (small in dev, ~ms on prod scale).

ALTER TABLE "trips" ADD CONSTRAINT "trips_brand_share_hash_unique" UNIQUE("brand_id","share_hash");
