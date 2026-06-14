#!/usr/bin/env bash
# smoke.sh — drive the running delivery-tracker API end-to-end with curl.
#
# Prerequisites (see SKILL.md): Postgres up (docker compose), migrations
# applied, an admin user seeded, and the API listening on $API_BASE.
# This script only DRIVES the running server — it does not start it.
#
# It exercises: health, JWT-cookie auth (+negative), brand CRUD, cargo
# create, the Caddy internal domain-validation hook, and the public
# /share render path INCLUDING cross-tenant isolation (a trip is inserted
# straight into Postgres because real trip generation needs a Mapbox token).
#
# Exit code is non-zero if any assertion fails.
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
# Default matches apps/api/.env.example (INTERNAL_TOKEN). Override if you changed it.
INTERNAL_TOKEN="${INTERNAL_TOKEN:-replace-with-32-plus-character-secret0}"
PG_CONTAINER="${PG_CONTAINER:-delivery-tracker-postgres-1}"
PG_USER="${PG_USER:-delivery}"
PG_DB="${PG_DB:-delivery_tracker}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password123}"

JAR="$(mktemp)"; BODY="$(mktemp)"
trap 'rm -f "$JAR" "$BODY"' EXIT

# Unique per run so reruns never collide on the slug/share_domain uniques.
RUN="smoke$$"
SLUG="$RUN"
DOMAIN="${RUN}.smoke.test"
HASH="hash${RUN}"

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
check() { # desc want got
  if [ "$2" = "$3" ]; then pass "$1 ($3)"; else bad "$1 (want $2, got $3)"; fi
}
has() { # desc pattern file
  if grep -q "$2" "$3"; then pass "$1"; else bad "$1"; fi
}
idof() { sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$1" | head -1; }

echo "== driving $API_BASE =="

# 1. health
code=$(curl -sS -o "$BODY" -w '%{http_code}' "$API_BASE/health")
check "health 200" 200 "$code"; has "health body ok" '"ok":true' "$BODY"

# 2. login (stores JWT cookie)
code=$(curl -sS -c "$JAR" -o "$BODY" -w '%{http_code}' -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "login 200" 200 "$code"

# 3. /auth/me WITHOUT cookie -> 401
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/auth/me")
check "me unauthenticated 401" 401 "$code"

# 4. /auth/me WITH cookie -> 200
code=$(curl -sS -b "$JAR" -o /dev/null -w '%{http_code}' "$API_BASE/auth/me")
check "me authenticated 200" 200 "$code"

# 5. create brand -> 201
code=$(curl -sS -b "$JAR" -o "$BODY" -w '%{http_code}' -X POST "$API_BASE/admin/brands" \
  -H 'Content-Type: application/json' \
  -d "{\"slug\":\"$SLUG\",\"name\":\"Smoke Co\",\"shareDomain\":\"$DOMAIN\"}")
check "create brand 201" 201 "$code"; BRAND_ID="$(idof "$BODY")"

# 6. list brands -> contains our slug
code=$(curl -sS -b "$JAR" -o "$BODY" -w '%{http_code}' "$API_BASE/admin/brands")
check "list brands 200" 200 "$code"; has "brand present in list" "\"$SLUG\"" "$BODY"

# 7. cargo create (brand-scoped) -> 201
code=$(curl -sS -b "$JAR" -o "$BODY" -w '%{http_code}' -X POST "$API_BASE/admin/b/$SLUG/cargo" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Cargo","fields":{"po":"PO-1"},"photoUploadIds":[]}')
check "create cargo 201" 201 "$code"; CARGO_ID="$(idof "$BODY")"

# 8. internal validate-domain: registered -> 200, unregistered -> 404, no token -> 404
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/internal/validate-domain?domain=$DOMAIN&token=$INTERNAL_TOKEN")
check "validate-domain registered 200" 200 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/internal/validate-domain?domain=nope.test&token=$INTERNAL_TOKEN")
check "validate-domain unregistered 404" 404 "$code"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/internal/validate-domain?domain=$DOMAIN")
check "validate-domain no-token 404" 404 "$code"

# 9. preview without Mapbox token -> 503 (token empty in .env.example)
code=$(curl -sS -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$API_BASE/admin/b/$SLUG/trips/preview" \
  -H 'Content-Type: application/json' \
  -d '{"origin":{"lat":40.7,"lng":-74},"destination":{"lat":34,"lng":-118.2},"startedAt":1800000000,"desiredArrival":1800200000}')
check "preview without Mapbox 503" 503 "$code"

# 10. share render path: insert a trip straight into Postgres (no Mapbox needed),
#     then assert the public endpoint renders it for the brand host and 404s for
#     any other host (tenant isolation).
if [ -n "${BRAND_ID:-}" ] && [ -n "${CARGO_ID:-}" ]; then
  if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
"INSERT INTO trips (brand_id, cargo_id, share_hash, origin, destination, waypoints, starts_at, desired_arrival, pauses, route_geometry, timeline, total_distance_meters) VALUES ('$BRAND_ID','$CARGO_ID','$HASH','{\"lat\":40.7,\"lng\":-74}','{\"lat\":34,\"lng\":-118.2}','[]',to_timestamp(1800000000),to_timestamp(1800100000),'[]','{\"type\":\"LineString\",\"coordinates\":[[-74,40.7],[-118.2,34]]}','[{\"type\":\"driving\",\"tStart\":1800000000,\"tEnd\":1800100000,\"distStart\":0,\"distEnd\":4000000}]',4000000);" >/dev/null; then
    pass "trip inserted via psql"
  else
    bad "trip insert"
  fi

  code=$(curl -sS -o "$BODY" -w '%{http_code}' "$API_BASE/share/$HASH" -H "Host: $DOMAIN")
  check "share render (correct host) 200" 200 "$code"
  has "share body has cargo" '"Smoke Cargo"' "$BODY"

  code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/share/$HASH" -H 'Host: other.smoke.test')
  check "share cross-tenant (wrong host) 404" 404 "$code"
else
  bad "skipping share test — missing brand/cargo id"
fi

# 11. share for unknown hash on a real brand host -> 404 (no oracle)
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/share/doesnotexist" -H "Host: $DOMAIN")
check "share unknown hash 404" 404 "$code"

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$fail"
