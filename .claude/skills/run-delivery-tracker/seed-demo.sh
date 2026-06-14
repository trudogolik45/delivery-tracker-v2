#!/usr/bin/env bash
# seed-demo.sh — seed a demo brand bound to the host "localhost" plus a cargo
# and an in-progress trip, so the share/tracking page renders a live map at
# http://localhost:5173/s/<hash> during local dev.
#
# Why direct SQL: the brand API rejects "localhost" (ShareDomainSchema requires
# a dotted FQDN), but the browser's Host on localhost:5173 is exactly "localhost".
# Inserting straight into Postgres is the only way to make the dev share page
# resolve a brand. Idempotent: it deletes any prior demo brand first (cascades).
#
# Requires: the dev Postgres container running, an admin user already seeded.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-delivery-tracker-postgres-1}"
PG_USER="${PG_USER:-delivery}"
PG_DB="${PG_DB:-delivery_tracker}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
HASH="${HASH:-livedemo00000001}"

# -tA = tuples-only/unaligned; head -1 drops psql's "INSERT 0 1" command tag,
# which -tA still appends after a RETURNING value.
psql() { docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA "$@" | head -1; }

UID0="$(psql -c "SELECT id FROM users WHERE email='$ADMIN_EMAIL';")"
[ -n "$UID0" ] || { echo "no admin user ($ADMIN_EMAIL) — run seed-admin first"; exit 1; }

psql -c "DELETE FROM brands WHERE slug='demo';" >/dev/null
DBID="$(psql -c "INSERT INTO brands (slug, share_domain, name, owner_id) VALUES ('demo','localhost','Demo Logistics','$UID0') RETURNING id;")"
DCID="$(psql -c "INSERT INTO cargo (brand_id, title, fields) VALUES ('$DBID','Wind Turbine Blade','{\"length\":\"72 m\",\"permit\":\"OS-2291\"}') RETURNING id;")"

NOW="$(date +%s)"; T0=$((NOW-7200)); T1=$((NOW+7200))
psql -c "INSERT INTO trips (brand_id, cargo_id, share_hash, origin, destination, waypoints, starts_at, desired_arrival, pauses, route_geometry, timeline, total_distance_meters) VALUES ('$DBID','$DCID','$HASH','{\"lat\":40.71,\"lng\":-74.0,\"label\":\"New York\"}','{\"lat\":41.88,\"lng\":-87.63,\"label\":\"Chicago\"}','[]',to_timestamp($T0),to_timestamp($T1),'[]','{\"type\":\"LineString\",\"coordinates\":[[-74.0,40.71],[-77.0,40.44],[-80.0,40.44],[-83.0,41.0],[-85.0,41.5],[-87.63,41.88]]}','[{\"type\":\"driving\",\"tStart\":$T0,\"tEnd\":$T1,\"distStart\":0,\"distEnd\":1270000}]',1270000);" >/dev/null

echo "seeded demo trip — open: http://localhost:5173/s/$HASH"
