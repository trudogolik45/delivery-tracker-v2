-- Migration 0009: denormalize trip distance (additive, P0 perf — review finding P0-2)
--
-- Drops @turf/length(polyline) recompute on every /share/:hash request (~25-50ms).
-- App writes from Mapbox Directions API (returns distance in METERS by spec;
-- already used as `length(polyline, 'kilometers') * 1000` in admin.ts:313 — same unit).
--
-- Nullable column → no table rewrite, no blocking backfill. Read path uses
-- `total_distance_meters ?? Math.round(turfLength(polyline) * 1000)` for legacy rows.
-- Optional one-shot backfill via Node script after deploy (scripts/backfill-trip-distance.ts).

ALTER TABLE "trips" ADD COLUMN "total_distance_meters" integer;