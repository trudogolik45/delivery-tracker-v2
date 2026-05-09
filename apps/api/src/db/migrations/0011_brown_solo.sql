-- Migration 0011: case-insensitive share_domain uniqueness (additive, P1 sec — review H2 arch)
--
-- The existing case-sensitive `brands_share_domain_unique` allows registering both
-- "Foo.com" and "foo.com" — Caddy on_demand_tls treats them as the same host,
-- so this opens a tenant-spoofing window. The LOWER() expression unique closes it.
--
-- Existing case-sensitive unique stays — it's strictly stricter on its dimension;
-- the LOWER index hardens the case-fold dimension. Defense-in-depth.
-- App layer should normalize share_domain to lowercase on INSERT/UPDATE.
--
-- Pre-flight verified on prod (2026-05-09):
--   SELECT lower(share_domain), count(*) FROM brands
--    WHERE share_domain IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--   → 0 rows (no case-fold duplicates)

CREATE UNIQUE INDEX "brands_share_domain_lower_idx" ON "brands" USING btree (lower("share_domain"));