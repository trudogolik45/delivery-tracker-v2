#!/usr/bin/env node
// Feasibility spike for SPEC `.specs/realistic-delivery-timeline.spec.md` FR-3.
// Plan task S1 (delivery-tracker-v2-18y).
//
// v2 — DISTRIBUTED MULTI-BUMP generator (replaces the v1 single-midpoint arc).
//
// Why v2: the v1 single half-sine bump `A·sin(π·t)` did not scale. On LA→NYC 2×
// the amplitude needed becomes geographically absurd (vias land in the ocean /
// Canada), Mapbox snaps them back, and the route never lengthens → NO-BRACKET.
// v2 distributes the extra length across NBUMPS small same-side bumps, each with
// a CAPPED amplitude (A_CAP ≈130 km/via) so every via stays near a road and snaps
// cleanly. Length grows with the NUMBER of bumps, not the amplitude of one.
//
// Two-level search per target distance d*:
//   inner: bisect A ∈ [0, A_CAP] at fixed NBUMPS  → hit d* within tolerance
//   outer: if f(A_CAP, NBUMPS) < d*, raise NBUMPS (bounded by the 25-coord budget)
// If even max NBUMPS + A_CAP cannot reach d*  → INFEASIBLE: that is the honest
// FR-5 reject boundary (maximumArrival), not a silent wrong route.
//
// Dependency-free (Node ≥18 global fetch). NOT part of the build. Throwaway.
//
// Run from repo root with your token (this script never reads .env itself):
//   MAPBOX_TOKEN="$(grep -E '^MAPBOX_TOKEN=' apps/api/.env | cut -d= -f2- | tr -d '\r')" \
//     node .specs/spikes/detour-geometry-spike.mjs
//
// Optional env: A_CAP (m, default 130000), MAX_VIAS (default 20),
//   PTS_PER_BUMP (default 2), TOL (default 0.02), MAX_BISECT (default 6),
//   DELAY_MS (default 120), RATIOS (default "1.5,2.0").

const TOKEN = process.env.MAPBOX_TOKEN
if (!TOKEN) {
  console.error(
    'MAPBOX_TOKEN not set. Example:\n' +
      "  MAPBOX_TOKEN=\"$(grep -E '^MAPBOX_TOKEN=' apps/api/.env | cut -d= -f2- | tr -d '\\r')\" node .specs/spikes/detour-geometry-spike.mjs",
  )
  process.exit(1)
}

const A_CAP = Number(process.env.A_CAP ?? 130_000) // max perpendicular offset per via (m)
const MAX_VIAS = Number(process.env.MAX_VIAS ?? 20) // ≤ 25 − origin − dest − headroom
const PTS_PER_BUMP = Number(process.env.PTS_PER_BUMP ?? 2)
const TOL = Number(process.env.TOL ?? 0.02)
const MAX_BISECT = Number(process.env.MAX_BISECT ?? 6)
const DELAY_MS = Number(process.env.DELAY_MS ?? 120)
const RATIOS = (process.env.RATIOS ?? '1.5,2.0').split(',').map(Number)
const SNAP_BAD_M = 2500
const NBUMPS_LADDER = [2, 4, 6, 8, 10].filter((n) => n * PTS_PER_BUMP <= MAX_VIAS)

const CORRIDORS = [
  {
    name: 'LA → NYC (long inland)',
    o: [-118.2437, 34.0522],
    d: [-74.006, 40.7128],
  },
  {
    name: 'SF → LA (Pacific coast)',
    o: [-122.4194, 37.7749],
    d: [-118.2437, 34.0522],
  },
  {
    name: 'Denver → SLC (Rockies)',
    o: [-104.9903, 39.7392],
    d: [-111.891, 40.7608],
  },
  {
    name: 'Memphis → Little Rock (Mississippi R.)',
    o: [-90.049, 35.1495],
    d: [-92.2896, 34.7465],
  },
]

// ── geo (great-circle) ──────────────────────────────────────────────────────
const R = 6_371_000
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

function haversine([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
function bearing([lng1, lat1], [lng2, lat2]) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2))
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1))
  return (deg(Math.atan2(y, x)) + 360) % 360
}
function destination([lng, lat], bearingDeg, distM) {
  const dr = distM / R
  const br = rad(bearingDeg)
  const lat1 = rad(lat)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br),
  )
  const lng2 =
    rad(lng) +
    Math.atan2(
      Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    )
  return [((deg(lng2) + 540) % 360) - 180, deg(lat2)]
}
function polylineLength(coords) {
  let s = 0
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i])
  return s
}
function pointAtFraction(coords, t) {
  const total = polylineLength(coords)
  const target = t * total
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i])
    if (acc + seg >= target) {
      const f = seg > 0 ? (target - acc) / seg : 0
      const [lng1, lat1] = coords[i - 1]
      const [lng2, lat2] = coords[i]
      return {
        point: [lng1 + (lng2 - lng1) * f, lat1 + (lat2 - lat1) * f],
        bearing: bearing(coords[i - 1], coords[i]),
      }
    }
    acc += seg
  }
  const n = coords.length
  return {
    point: coords[n - 1],
    bearing: bearing(coords[n - 2], coords[n - 1]),
  }
}

// NBUMPS same-side bumps; per-via offset = A·|sin(π·NBUMPS·t)|, capped by A_CAP.
function buildVias(directCoords, A, nbumps, side) {
  const K = Math.min(MAX_VIAS, nbumps * PTS_PER_BUMP)
  const vias = []
  for (let k = 1; k <= K; k++) {
    const t = k / (K + 1)
    const off = Math.min(A_CAP, A) * Math.abs(Math.sin(Math.PI * nbumps * t))
    const { point, bearing: b } = pointAtFraction(directCoords, t)
    vias.push(destination(point, b + side * 90, off))
  }
  return vias
}

// ── Mapbox ──────────────────────────────────────────────────────────────────
let CALLS = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function directions(coords, { alternatives = false } = {}) {
  CALLS++
  if (DELAY_MS) await sleep(DELAY_MS)
  const path = coords.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${path}` +
    `?geometries=geojson&overview=full&exclude=ferry` +
    (alternatives ? '&alternatives=true' : '') +
    `&access_token=${TOKEN}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.message || !data.routes?.length)
    return { ok: false, reason: data.message || `HTTP ${res.status}` }
  const maxSnap = Math.max(0, ...(data.waypoints ?? []).map((w) => w.distance ?? 0))
  return {
    ok: true,
    routes: data.routes.map((r) => ({ distance: r.distance })),
    maxSnap,
  }
}

async function measure(o, d, directCoords, A, nbumps, side) {
  const r = await directions([o, ...buildVias(directCoords, A, nbumps, side), d])
  return r.ok ? { len: r.routes[0].distance, snap: r.maxSnap } : null
}

// ── per-corridor ────────────────────────────────────────────────────────────
async function runCorridor(c) {
  // One call gives both the base distance and the geometry we sample vias along.
  const baseGeom = await fetchGeometry(c.o, c.d)
  if (!baseGeom.ok) return { name: c.name, error: `direct route failed: ${baseGeom.reason}` }
  const directDist = baseGeom.distance
  const coords = baseGeom.coords
  const alt = await directions([c.o, c.d], { alternatives: true })
  const altMaxRatio = alt.ok ? Math.max(...alt.routes.map((r) => r.distance)) / directDist : 1

  // Pick the cleaner offset side once (geography-dependent, not ratio-dependent).
  const startBumps = NBUMPS_LADDER[Math.floor(NBUMPS_LADDER.length / 2)]
  const [pl, pr] = await Promise.all([
    measure(c.o, c.d, coords, A_CAP, startBumps, +1),
    measure(c.o, c.d, coords, A_CAP, startBumps, -1),
  ])
  const side = (pl?.snap ?? Infinity) <= (pr?.snap ?? Infinity) ? +1 : -1

  const results = []
  for (const ratio of RATIOS) {
    const dStar = directDist * ratio
    // Outer: climb NBUMPS until f(A_CAP, nbumps) brackets d*.
    let nbumps = null
    let maxAchieved = directDist
    for (const n of NBUMPS_LADDER) {
      const f = await measure(c.o, c.d, coords, A_CAP, n, side)
      if (f) maxAchieved = Math.max(maxAchieved, f.len)
      if (f && f.len >= dStar) {
        nbumps = n
        break
      }
    }
    if (nbumps === null) {
      results.push({
        ratio,
        status: 'INFEASIBLE',
        achieved: maxAchieved / directDist,
        nbumps: NBUMPS_LADDER[NBUMPS_LADDER.length - 1],
        side: side > 0 ? 'L' : 'R',
        snapM: 0,
      })
      continue
    }
    // Inner: bisect A ∈ [0, A_CAP] at the bracketing nbumps.
    let lo = 0
    let hi = A_CAP
    let best = { err: Infinity, len: directDist, snap: 0 }
    for (let i = 0; i < MAX_BISECT; i++) {
      const mid = (lo + hi) / 2
      const f = await measure(c.o, c.d, coords, mid, nbumps, side)
      if (!f || f.len < directDist) {
        hi = mid // bad snap / NoRoute / regression → pull inward
        continue
      }
      const err = Math.abs(f.len - dStar) / dStar
      if (err < best.err) best = { err, len: f.len, snap: f.snap }
      if (f.len < dStar) lo = mid
      else hi = mid
      if (err <= TOL) break
    }
    results.push({
      ratio,
      status: best.err <= TOL ? 'PASS' : 'NEAR',
      achieved: best.len / directDist,
      errPct: (best.err * 100).toFixed(2),
      nbumps,
      side: side > 0 ? 'L' : 'R',
      snapM: Math.round(best.snap),
      snapFlag: best.snap > SNAP_BAD_M ? '⚠bad-snap' : 'ok',
    })
  }
  return {
    name: c.name,
    directKm: (directDist / 1000).toFixed(0),
    altMaxRatio: altMaxRatio.toFixed(2),
    results,
  }
}

// Mapbox doesn't return geometry from our slim `directions()`; fetch it once.
async function fetchGeometry(o, d) {
  CALLS++
  if (DELAY_MS) await sleep(DELAY_MS)
  const path = [o, d].map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${path}?geometries=geojson&overview=full&exclude=ferry&access_token=${TOKEN}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.message || !data.routes?.length)
    return { ok: false, reason: data.message || `HTTP ${res.status}` }
  const route = data.routes[0]
  return {
    ok: true,
    coords: route.geometry.coordinates,
    distance: route.distance,
  }
}

// ── main ────────────────────────────────────────────────────────────────────
console.log(
  `detour multi-bump spike — A_CAP=${A_CAP / 1000}km/via, bumps∈${JSON.stringify(NBUMPS_LADDER)}, ` +
    `tol=±${(TOL * 100).toFixed(0)}%, ratios=${RATIOS.join('/')}\n`,
)
let pass = 0
let total = 0
for (const c of CORRIDORS) {
  const r = await runCorridor(c)
  if (r.error) {
    console.log(`✗ ${r.name}: ${r.error}\n`)
    continue
  }
  console.log(`${r.name}  (direct ${r.directKm} km, alternatives max ${r.altMaxRatio}× direct)`)
  for (const x of r.results) {
    total++
    const mark = x.status === 'PASS' ? '✓' : x.status === 'INFEASIBLE' ? '∅' : '~'
    if (x.status === 'PASS' || x.status === 'INFEASIBLE') pass++ // explicit reject is an acceptable gate outcome
    if (x.status === 'INFEASIBLE') {
      console.log(
        `   ∅ target ${x.ratio}×  → INFEASIBLE (max achievable ${x.achieved.toFixed(2)}× at ${x.nbumps} bumps, side ${x.side}) ⇒ FR-5 reject boundary`,
      )
    } else {
      console.log(
        `   ${mark} target ${x.ratio}×  → achieved ${x.achieved.toFixed(2)}× ` +
          `(err ${x.errPct}%, ${x.nbumps} bumps, side ${x.side}, snap ${x.snapM}m ${x.snapFlag})`,
      )
    }
  }
  console.log('')
}
console.log(
  `Resolved (PASS or explicit INFEASIBLE-reject): ${pass}/${total}.  Total Mapbox calls: ${CALLS}`,
)
console.log(
  'Read: ✓ PASS = detour converged within tolerance, snap ok. ∅ INFEASIBLE = honest FR-5 reject\n' +
    '      (the route physically cannot stretch that far) — also a gate pass. ~ NEAR / ⚠bad-snap on a\n' +
    '      corridor that should be feasible ⇒ tune A_CAP / bumps / PTS_PER_BUMP, or add multi-side resample.',
)
