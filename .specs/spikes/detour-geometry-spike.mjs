#!/usr/bin/env node
// Feasibility spike for SPEC `.specs/realistic-delivery-timeline.spec.md` FR-3.
//
// Validates the LOCKED detour-geometry decision — "parametric multi-via arc +
// amplitude bisection" — against REAL Mapbox Directions on corridors with
// adversarial geometry (long inland, coastal, mountain, river crossing).
//
// It answers the one binary question the design reasoning cannot close on its
// own: does length(A) stay smooth/monotone enough that single-scalar bisection
// converges to a target detour distance within a small Mapbox-call budget,
// without snapping vias into water / off-road?
//
// Dependency-free (Node ≥18 global fetch). NOT part of the build. Throwaway.
//
// Run from repo root with your token (this script never reads .env itself):
//   MAPBOX_TOKEN="$(grep -E '^MAPBOX_TOKEN=' apps/api/.env | cut -d= -f2-)" \
//     node .specs/spikes/detour-geometry-spike.mjs
//
// Optional env knobs: K (vias, default 10), TOL (tolerance frac, default 0.02),
//   MAX_ITER (bisection cap, default 10), DELAY_MS (between calls, default 120),
//   RATIOS (comma list, default "1.5,2.0").

const TOKEN = process.env.MAPBOX_TOKEN;
if (!TOKEN) {
  console.error(
    "MAPBOX_TOKEN not set. Example:\n" +
      "  MAPBOX_TOKEN=\"$(grep -E '^MAPBOX_TOKEN=' apps/api/.env | cut -d= -f2-)\" node .specs/spikes/detour-geometry-spike.mjs",
  );
  process.exit(1);
}

const K = Number(process.env.K ?? 10); // via-point count
const TOL = Number(process.env.TOL ?? 0.02); // ±2% convergence tolerance
const MAX_ITER = Number(process.env.MAX_ITER ?? 10); // bisection iterations cap
const DELAY_MS = Number(process.env.DELAY_MS ?? 120); // politeness delay between calls
const RATIOS = (process.env.RATIOS ?? "1.5,2.0").split(",").map(Number);
const SNAP_BAD_M = 2000; // a via snapped >2 km away ≈ water/off-road

// [lng, lat] corridors chosen for adversarial geometry.
const CORRIDORS = [
  {
    name: "LA → NYC (long inland)",
    o: [-118.2437, 34.0522],
    d: [-74.006, 40.7128],
  },
  {
    name: "SF → LA (Pacific coast)",
    o: [-122.4194, 37.7749],
    d: [-118.2437, 34.0522],
  },
  {
    name: "Denver → Salt Lake City (Rockies)",
    o: [-104.9903, 39.7392],
    d: [-111.891, 40.7608],
  },
  {
    name: "Memphis → Little Rock (Mississippi R.)",
    o: [-90.049, 35.1495],
    d: [-92.2896, 34.7465],
  },
];

// ── geo helpers (great-circle) ──────────────────────────────────────────────
const R = 6_371_000; // m
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function haversine([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing([lng1, lat1], [lng2, lat2]) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function destination([lng, lat], bearingDeg, distM) {
  const dr = distM / R;
  const br = rad(bearingDeg);
  const lat1 = rad(lat);
  const lng1 = rad(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) +
      Math.cos(lat1) * Math.sin(dr) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [((deg(lng2) + 540) % 360) - 180, deg(lat2)];
}

function polylineLength(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++)
    s += haversine(coords[i - 1], coords[i]);
  return s;
}

// Point at cumulative-distance fraction t∈(0,1) along a polyline, plus the
// local segment bearing there.
function pointAtFraction(coords, t) {
  const total = polylineLength(coords);
  const target = t * total;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    if (acc + seg >= target) {
      const f = seg > 0 ? (target - acc) / seg : 0;
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      return {
        point: [lng1 + (lng2 - lng1) * f, lat1 + (lat2 - lat1) * f],
        bearing: bearing(coords[i - 1], coords[i]),
      };
    }
    acc += seg;
  }
  const n = coords.length;
  return {
    point: coords[n - 1],
    bearing: bearing(coords[n - 2], coords[n - 1]),
  };
}

// Build K vias along `directCoords`, each offset perpendicular by A·sin(π·t)
// on the given side (+1 left, −1 right).
function buildVias(directCoords, A, side) {
  const vias = [];
  for (let k = 1; k <= K; k++) {
    const t = k / (K + 1);
    const { point, bearing: b } = pointAtFraction(directCoords, t);
    const off = A * Math.sin(Math.PI * t);
    vias.push(destination(point, b + side * 90, off));
  }
  return vias;
}

// ── Mapbox Directions ───────────────────────────────────────────────────────
let CALLS = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function directions(coords, { alternatives = false } = {}) {
  CALLS++;
  if (DELAY_MS) await sleep(DELAY_MS);
  const path = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${path}` +
    `?geometries=geojson&overview=full&exclude=ferry` +
    (alternatives ? "&alternatives=true" : "") +
    `&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.message || !data.routes?.length) {
    return { ok: false, reason: data.message || `HTTP ${res.status}` };
  }
  const maxSnap = Math.max(
    0,
    ...(data.waypoints ?? []).map((w) => w.distance ?? 0),
  );
  const routes = data.routes.map((r) => ({
    distance: r.distance,
    coords: r.geometry.coordinates,
  }));
  return { ok: true, routes, maxSnap };
}

// length(A) for the better of the two offset sides (production rejects bad snaps).
async function lengthAtAmplitude(directCoords, o, d, A, side) {
  const r = await directions([o, ...buildVias(directCoords, A, side), d]);
  return r.ok ? { len: r.routes[0].distance, snap: r.maxSnap } : null;
}

// ── per-corridor run ────────────────────────────────────────────────────────
async function runCorridor(c) {
  const base = await directions([c.o, c.d]);
  if (!base.ok)
    return { name: c.name, error: `direct route failed: ${base.reason}` };
  const directDist = base.routes[0].distance;
  const directCoords = base.routes[0].coords;

  // Layer-0 probe: how much do plain alternatives stretch?
  const alt = await directions([c.o, c.d], { alternatives: true });
  const altMaxRatio = alt.ok
    ? Math.max(...alt.routes.map((r) => r.distance)) / directDist
    : 1;

  // Pick the offset side with the cleaner snap at a mid amplitude.
  const results = [];
  for (const ratio of RATIOS) {
    const dStar = directDist * ratio;
    let Amax = (directDist * (ratio - 1)) / 2; // perpendicular meters
    const probeMid = Amax / 2;
    const [pl, pr] = await Promise.all([
      lengthAtAmplitude(directCoords, c.o, c.d, probeMid, +1),
      lengthAtAmplitude(directCoords, c.o, c.d, probeMid, -1),
    ]);
    const side = (pl?.snap ?? Infinity) <= (pr?.snap ?? Infinity) ? +1 : -1;

    // Ensure the upper bracket actually overshoots d* (widen if needed).
    let hi = Amax;
    let fHi = await lengthAtAmplitude(directCoords, c.o, c.d, hi, side);
    let widen = 0;
    while (fHi && fHi.len < dStar && widen < 4) {
      hi *= 1.6;
      fHi = await lengthAtAmplitude(directCoords, c.o, c.d, hi, side);
      widen++;
    }

    // Bisection on amplitude A.
    let lo = 0;
    let best = { err: Infinity, len: directDist, A: 0, snap: 0 };
    let bracketed = !!(fHi && fHi.len >= dStar);
    for (let i = 0; i < MAX_ITER && bracketed; i++) {
      const mid = (lo + hi) / 2;
      const f = await lengthAtAmplitude(directCoords, c.o, c.d, mid, side);
      if (!f) {
        hi = mid; // bad snap / NoRoute → pull inward
        continue;
      }
      const err = Math.abs(f.len - dStar) / dStar;
      if (err < best.err) best = { err, len: f.len, A: mid, snap: f.snap };
      if (f.len < dStar) lo = mid;
      else hi = mid;
      if (err <= TOL) break;
    }

    results.push({
      ratio,
      converged: best.err <= TOL,
      achievedRatio: best.len / directDist,
      errPct: (best.err * 100).toFixed(2),
      side: side > 0 ? "L" : "R",
      bracketed,
      maxSnapM: Math.round(best.snap),
      snapFlag: best.snap > SNAP_BAD_M ? "⚠ bad-snap" : "ok",
    });
  }

  return {
    name: c.name,
    directKm: (directDist / 1000).toFixed(0),
    altMaxRatio: altMaxRatio.toFixed(2),
    results,
  };
}

// ── main ────────────────────────────────────────────────────────────────────
console.log(
  `detour-geometry spike — K=${K} vias, tol=±${(TOL * 100).toFixed(0)}%, ` +
    `maxIter=${MAX_ITER}, ratios=${RATIOS.join("/")}\n`,
);
for (const c of CORRIDORS) {
  const r = await runCorridor(c);
  if (r.error) {
    console.log(`✗ ${r.name}: ${r.error}\n`);
    continue;
  }
  console.log(
    `${r.name}  (direct ${r.directKm} km, alternatives max ${r.altMaxRatio}× direct)`,
  );
  for (const x of r.results) {
    const mark = x.converged ? "✓" : "✗";
    console.log(
      `   ${mark} target ${x.ratio}×  → achieved ${x.achievedRatio.toFixed(2)}× ` +
        `(err ${x.errPct}%, side ${x.side}, snap ${x.maxSnapM} m ${x.snapFlag}` +
        `${x.bracketed ? "" : ", NO-BRACKET"})`,
    );
  }
  console.log("");
}
console.log(`Total Mapbox Directions calls: ${CALLS}`);
console.log(
  'Read: ✓ on all corridors/ratios with snap "ok" ⇒ concept holds, tune K/TOL in /plan.\n' +
    "      ✗ or ⚠ bad-snap / NO-BRACKET on a corridor ⇒ that geometry breaks the single-side\n" +
    "      arc; /plan must add multi-side resampling or reconsider the detour mechanism.",
);
