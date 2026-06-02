---
name: HOS Variable Speed Profile
description: Per-edge variable road speeds in HOS timeline simulation via Mapbox Directions annotations — SpeedEdge profile, coalescing, distance-walk cursor, and flatSpeedProfile fallback
topics: mapbox-directions,annotations,hos,simulation,speed-profile,coalescing,typescript
created: 2026-06-02
updated: 2026-06-02
scratchpad: .specs/scratchpad/965bd1e6.md
---

# HOS Variable Speed Profile

## Overview

This skill covers replacing a flat average-speed constant in an HOS timeline simulator with a per-edge speed profile derived from Mapbox Directions `annotations=duration,distance`. The approach: fetch annotations alongside the route, build a coalesced `SpeedEdge[]` profile (coalesce-first), and thread it through `buildTimeline → simulateMinimum → makeDriving`. Downstream `Segment`/`Trip` schemas and `interpolate.ts` MUST remain unchanged; within-segment interpolation stays linear.

---

## Key Concepts

- **SpeedEdge**: `{ distStart: number; distEnd: number; duration: number }` — one constant-speed band covering a distance range; implied speed = `(distEnd - distStart) / duration` m/s.
- **buildSpeedProfile**: constructs `SpeedEdge[]` from raw Mapbox leg annotations; skips zero-distance/zero-duration edges; coalesces adjacent bands within tolerance; caps at `MAX_SPEED_BANDS`.
- **flatSpeedProfile**: returns a single-edge profile at the legacy speed — reproduces old behaviour bit-for-bit; used as a default argument and in seed/demo callers.
- **A1 distance-walk cursor**: `makeDriving` advances a cursor through `SpeedEdge[]` accumulating per-band durations until the HOS time cap is hit; performs exact mid-band split at the cap boundary.
- **Last-band reconciliation**: last `SpeedEdge.distEnd` is always forced to `totalDistance` to absorb float drift between `Σannotation.distance` and `routes[0].distance`.
- **Coalesce-first**: coalescing into bands happens once at profile build time, not inside the simulation loop.

---

## Documentation & References

| Resource | Description | Link |
|----------|-------------|------|
| Mapbox Directions API v5 — Overview | General endpoint, profiles, parameters | https://docs.mapbox.com/api/navigation/directions/ |
| Mapbox Directions API v5 — `annotations` parameter & `leg.annotation` | Per-edge duration/distance arrays, semantics | https://docs.mapbox.com/api/navigation/directions/#route-leg-object |
| FMCSA HOS rules | 8h/30min/11h/14h/10h constants | https://www.fmcsa.dot.gov/regulations/hours-of-service/summary-hours-service-regulations |

---

## Recommended Libraries & Tools

| Name | Purpose | Maturity | Notes |
|------|---------|----------|-------|
| `fetch` (built-in) | HTTP call to Mapbox Directions API | Stable (Node ≥18) | No new packages required — raw `fetch()` suffices; the Mapbox JS SDK is not needed for a server-side annotation fetch |

**No new packages required.** The Mapbox Directions v5 REST endpoint is a straightforward JSON GET; the official Mapbox JS SDK is a browser/client library and adds unnecessary weight to a Node simulation package. Pin the API to `v5` in the URL path. Note: Mapbox **v6** renames the annotation response key from `leg.annotation` to `leg.annotations` (plural) — if upgrading to v6, update all `annotation` property accesses accordingly.

---

## Mapbox Directions API: Using Annotations for Speed Profiling

### URL format

```
https://api.mapbox.com/directions/v5/mapbox/driving/{coords}
  ?geometries=geojson
  &overview=full
  &annotations=duration,distance
  &access_token={token}
```

`overview=full` is **required** for annotations to be returned. Without it, annotation arrays are absent.

### Annotation array semantics (K coordinates → K-1 edges)

- Annotations are **per-leg**. A route with N waypoints has N-1 legs; each leg has its own `annotation.duration[]` and `annotation.distance[]`.
- Each entry is "between each pair of coordinates" — for a leg with K geometry coordinates, the arrays have **K-1 entries** (edges, not vertices).
- Zero-distance / zero-duration edges CAN appear (e.g., arrival maneuver). Always skip them: `if (duration <= 0 || distance <= 0) continue`.
- **Multi-waypoint concatenation**: concatenate `leg[i].annotation.duration` and `leg[i].annotation.distance` across all legs to get a single continuous profile. Legs abut without overlap — the shared waypoint is NOT duplicated in annotation arrays.

### Response type extension

```typescript
// Extend the raw response type to include legs
const data = (await res.json()) as {
  routes?: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    distance: number
    duration: number
    legs: Array<{
      annotation: {
        duration: number[]
        distance: number[]
      }
    }>
  }>
  message?: string
}

// Extend the RouteResult export
export type RouteResult = {
  polyline: LineString
  totalDistance: number
  duration: number
  legs: Array<{ annotation: { duration: number[]; distance: number[] } }>
}
```

Assert `legs[0]?.annotation` is present after fetching or throw — the `overview=full` + annotations coupling means absence indicates an API contract violation.

---

## Patterns & Best Practices

### SpeedEdge type and profile builder

```typescript
export type SpeedEdge = {
  distStart: number
  distEnd: number
  duration: number  // seconds to traverse this band
}

const COALESCE_TOLERANCE_MS = 8_000 / 3600  // 8 km/h in m/s
const MAX_SPEED_BANDS = 500

export function buildSpeedProfile(
  legs: Array<{ annotation: { duration: number[]; distance: number[] } }>,
  totalDistance: number,
): SpeedEdge[] {
  // Phase 1: flatten per-leg arrays into raw edges
  const raw: SpeedEdge[] = []
  let cumDist = 0
  for (const leg of legs) {
    const durs = leg.annotation.duration
    const dists = leg.annotation.distance
    for (let i = 0; i < durs.length; i++) {
      const d = dists[i]!
      const t = durs[i]!
      if (t <= 0 || d <= 0) { cumDist += d; continue }
      raw.push({ distStart: cumDist, distEnd: cumDist + d, duration: t })
      cumDist += d
    }
  }
  if (raw.length === 0) return flatSpeedProfile(totalDistance)

  // Phase 2: coalesce with widening tolerance loop
  // WARNING: O(N × widening iterations) — see pitfall table
  let tolerance = COALESCE_TOLERANCE_MS
  let bands = coalesce(raw, tolerance)
  while (bands.length > MAX_SPEED_BANDS) {
    tolerance *= 1.5
    bands = coalesce(raw, tolerance)
  }

  // Phase 3: reconcile last band to totalDistance
  bands[bands.length - 1]!.distEnd = totalDistance
  return bands
}

function coalesce(edges: SpeedEdge[], tolerance: number): SpeedEdge[] {
  const out: SpeedEdge[] = []
  let cur = { ...edges[0]! }
  for (let i = 1; i < edges.length; i++) {
    const next = edges[i]!
    const mergedSpeed = (cur.distEnd - cur.distStart + next.distEnd - next.distStart)
                      / (cur.duration + next.duration)
    const curSpeed = (cur.distEnd - cur.distStart) / cur.duration
    if (Math.abs(mergedSpeed - curSpeed) <= tolerance) {
      cur = { distStart: cur.distStart, distEnd: next.distEnd, duration: cur.duration + next.duration }
    } else {
      out.push(cur)
      cur = { ...next }
    }
  }
  out.push(cur)
  return out
}

export function flatSpeedProfile(
  totalDistance: number,
  speedMs = 88_000 / 3600,
): SpeedEdge[] {
  return [{ distStart: 0, distEnd: totalDistance, duration: totalDistance / speedMs }]
}
```

### A1 distance-walk cursor in `makeDriving`

The refactored `makeDriving` returns `DrivingSegment[]` (an array, not a single segment). The cursor MUST be bounds-guarded before each band access — after the last band is consumed `cursor` reaches `profile.length` and `profile[cursor]!` would crash.

```typescript
function makeDriving(
  tStart: number,
  distStart: number,
  totalDistance: number,
  maxSeconds: number,
  profile: SpeedEdge[],
): DrivingSegment[] {
  const segments: DrivingSegment[] = []
  let cursor = profile.findIndex(e => e.distEnd > distStart)
  if (cursor === -1) cursor = profile.length - 1

  let t = tStart
  let dist = distStart
  let secondsLeft = maxSeconds

  while (secondsLeft > 0 && dist < totalDistance - 0.01) {
    // BOUNDS GUARD: cursor can reach profile.length after last band
    if (cursor >= profile.length) break
    const band = profile[cursor]!
    const speedMs = (band.distEnd - band.distStart) / band.duration
    const bandDist = Math.min(band.distEnd, totalDistance) - dist
    const bandSeconds = bandDist / speedMs

    if (bandSeconds <= secondsLeft) {
      // consume full band
      segments.push({
        type: 'driving',
        tStart: t,
        tEnd: t + bandSeconds,
        distStart: dist,
        distEnd: dist + bandDist,
      })
      t += bandSeconds
      dist += bandDist
      secondsLeft -= bandSeconds
      cursor++  // advance — must be followed by bounds check at top of loop
    } else {
      // exact mid-band split at HOS cap
      const partialDist = secondsLeft * speedMs
      segments.push({
        type: 'driving',
        tStart: t,
        tEnd: t + secondsLeft,
        distStart: dist,
        distEnd: dist + partialDist,
      })
      break
    }
  }
  return segments
}
```

### Both `makeDriving` call sites in `simulateMinimum`

`simulateMinimum` calls `makeDriving` **twice**: once for the pre-break driving leg (d1) and once for the post-break leg (d2). Both call sites must be updated identically — spread the returned `DrivingSegment[]` into `segments` and read the last element for `t`/`dist`:

```typescript
// Call site 1 — d1: drive up to MAX_DRIVE_BEFORE_BREAK
const segs1 = makeDriving(t, dist, totalDistance, MAX_DRIVE_BEFORE_BREAK, profile)
segments.push(...segs1)
const last1 = segs1[segs1.length - 1]!
t = last1.tEnd
dist = last1.distEnd
if (dist >= totalDistance - 0.01) break

// Mandatory 30-min break
segments.push({ type: 'rest', tStart: t, tEnd: t + BREAK_DURATION, atDist: dist, reason: 'break' })
t += BREAK_DURATION

// Call site 2 — d2: drive the rest of the shift
const shiftDriveLeft = MAX_DRIVE_PER_SHIFT - MAX_DRIVE_BEFORE_BREAK
const windowLeft = MAX_ONDUTY_WINDOW - (t - shiftStart)
const segs2 = makeDriving(t, dist, totalDistance, Math.min(shiftDriveLeft, windowLeft), profile)
segments.push(...segs2)
const last2 = segs2[segs2.length - 1]!
t = last2.tEnd
dist = last2.distEnd
if (dist >= totalDistance - 0.01) break
```

Omitting either call-site transformation leaves the other operating on a stale single-segment `DrivingSegment` reference and breaks temporal contiguity.

### Threading the profile through `buildTimeline`

```typescript
export function buildTimeline(
  startedAt: number,
  totalDistance: number,
  desiredArrival: number,
  profile: SpeedEdge[] = flatSpeedProfile(totalDistance),  // default preserves old behaviour
): Segment[] {
  const minimum = simulateMinimum(startedAt, totalDistance, profile)
  // ...rest unchanged
}
```

The default argument means all existing call sites and tests continue to work without modification.

---

## Common Pitfalls & Solutions

| Issue | Impact | Solution |
|-------|--------|----------|
| Summing `annotation.distance` != `routes[0].distance` (float drift) | Last `DrivingSegment.distEnd` overshoots `totalDistance` | Force `bands[bands.length - 1]!.distEnd = totalDistance` |
| `annotation.duration[]` absent when `overview != full` | Runtime crash | Assert presence; throw on missing |
| Zero-duration edges (arrival maneuver in annotation) | Division by zero in speed computation | Skip edges where `duration <= 0 \|\| distance <= 0` |
| Multi-waypoint: annotation arrays per-leg, not concatenated | Incorrect speed profile — profile ends at first waypoint | Concatenate all legs' annotation arrays in order |
| Cursor `++` without bounds guard after last band | `profile[cursor]!` crashes at `profile.length` | Add `if (cursor >= profile.length) break` at the top of the while loop body |
| Coalesce tolerance-widening loop cost | O(N × widening iterations) on routes with thousands of edges; rare but possible on very long motorway routes | Accept: `MAX_SPEED_BANDS = 500` limits iterations in practice; avoid lowering it significantly |
| Client code counts `DrivingSegments` to infer shifts (now 40–80 per shift) | Client-side logic break | Release notes callout; `DrivingSegment`s are no longer shift boundaries |
| Real `mapbox/driving` speeds slower than flat 88 km/h on city routes | More `HosError 422` from downstream clients using `dist/88 + padding` | Release notes: clients must use Mapbox `duration` for `desiredArrival` |
| Mapbox v6 annotation key rename (`annotation` → `annotations`) | Silent undefined reads | Pin API to v5 in URL; update all property accesses if upgrading to v6 |

---

## Recommendations

1. **Default profile argument**: Make `profile: SpeedEdge[] = flatSpeedProfile(totalDistance)` to preserve backward compatibility with all existing tests and call sites.
2. **Assert annotation presence**: After fetching, assert `legs?.[0]?.annotation` is defined and throw a descriptive error — the `overview=full` coupling makes absence indicate API misbehaviour.
3. **Reconcile last band distEnd**: Always set `bands[bands.length - 1]!.distEnd = totalDistance` after coalescing to prevent float drift from causing the simulation loop to never terminate.
4. **Export flatSpeedProfile from the `./generate` subpath**: Seed/demo callers need it; re-export from the generate entry-point so it is accessible without importing the Node-only generate module in test-only contexts.
5. **Keep `distributeSlack` untouched**: It operates only on `tStart`/`tEnd` time shifts and is indifferent to how many `DrivingSegment`s exist.

---

## Project-Specific Notes

> **Non-reusable section** — the following notes are specific to the `delivery-tracker-v2` project and should not be copied to other codebases.

- Files involved: `packages/simulation/src/mapbox.ts`, `packages/simulation/src/hos.ts`, `packages/simulation/src/generate.ts`, `apps/api/src/scripts/seed-demo-trip.ts`
- Test file: `packages/simulation/src/hos.test.ts` — add coverage for `buildSpeedProfile` (skip zero edges, coalesce within tolerance, last `distEnd == totalDistance`), `flatSpeedProfile` (single edge, implied speed == 88 km/h), `makeDriving` with 2-band profile (exact mid-band split, temporal contiguity), `buildTimeline` regression guard with `flatSpeedProfile`, and cursor bounds (cursor reaching profile end).
- `seed-demo-trip.ts` has a private divergent `buildTimeline` + local `AVG_SPEED_MS` — delete them; call canonical `buildTimeline(startedAt, totalDistance, minArrival, flatSpeedProfile(totalDistance))`.

---

## Sources & Verification

| Source | Type | Last Verified |
|--------|------|---------------|
| https://docs.mapbox.com/api/navigation/directions/ | Official | 2026-06-02 |
| https://docs.mapbox.com/api/navigation/directions/#route-leg-object | Official | 2026-06-02 |
| https://www.fmcsa.dot.gov/regulations/hours-of-service/summary-hours-service-regulations | Official | 2026-06-02 |
| packages/simulation/src/hos.ts (codebase) | Primary | 2026-06-02 |
| packages/simulation/src/mapbox.ts (codebase) | Primary | 2026-06-02 |
| packages/simulation/src/generate.ts (codebase) | Primary | 2026-06-02 |
| apps/api/src/scripts/seed-demo-trip.ts (codebase) | Primary | 2026-06-02 |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-02 | Initial creation for task: implement-variable-road-speeds-hos.feature.md |
| 2026-06-02 | Revised: split Mapbox links; added bounds guard + pitfall row; showed both d1/d2 call-site transformations; added Recommended Libraries & Tools; moved task-specific checklist to Project-Specific Notes sidebar; added coalesce O(N) pitfall row; added Mapbox v6 key-rename pitfall |
