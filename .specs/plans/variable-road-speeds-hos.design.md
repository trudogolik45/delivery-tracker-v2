# Design: Per-edge variable road speeds in the HOS timeline

**Status:** Validated (brainstorm + adversarial workflow), ready to plan
**Scope:** `packages/simulation`, `apps/api` (generate path + seed script)
**Task:** `.specs/tasks/draft/implement-variable-road-speeds-hos.feature.md`

## Problem

`generateTrip` calls Mapbox Directions but destructures only `{ polyline, totalDistance }`
and throws away `duration`. `buildTimeline` then drives at a flat
`AVG_SPEED_MS = 88 km/h` for the entire route, ignoring road class and typical
congestion. Mapbox already knows the real per-road speed; we discard it. ADR-0002
acknowledges this gap directly.

The HOS rules are already modelled (8h pre-break, 30-min break, 11h shift driving, 14h
on-duty window, 10h sleep, sleep cap + tail `wait`). The rolling 60/70h window stays out
of scope per ADR-0002. This change improves **speed realism only** — it does not touch
the HOS rule set.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Representation | Split driving into constant-speed `DrivingSegment`s, one per coalesced speed band | `Segment` schema and `interpolate.ts` stay unchanged — within-segment interpolation is already linear |
| Speed source | `mapbox/driving`, `annotations=duration,distance`, `overview=full` | Typical road-class speeds; deterministic, no staleness — matches ADR-0002 precomputed-once timeline |
| Algorithm | A1 distance-walk with an immutable-profile cursor + mandatory coalesce-first | Isomorphic to the existing imperative loop; not an event-driven scheduler (rejected by FPF for violating Simplicity) |
| Existing trips | New trips only, no backfill | Old flat-88 timelines stay valid; `interpolate.ts` already reads that format |

### Rejected alternatives

- **A2 cumulative-inversion** — strictly more complex (binary search + within-edge offset
  reconstruction), no accuracy gain over a forward walk at ~30–80 bands.
- **A4 per-block average speed** — chicken-and-egg (block average depends on which edges
  fall in the block, which depends on speed); doing it correctly re-implements the A1 walk
  anyway, and it loses city/highway variation inside a block.
- **A5 fixed-distance resample** — 10 km chunk is a magic constant; smears short
  speed-zones (bridges, ramps) and bloats payload. Kept its harmonic-mean aggregation idea.
- **A6 time-quantized buckets** — only works because current HOS limits happen to be
  multiples of 15 min; fragile coupling that breaks the moment a non-multiple rule is added.

## Architecture & data flow

```
getRoute (mapbox.ts)
  → RouteResult { polyline, totalDistance, duration, legs[].annotation{distance[],duration[]} }
buildSpeedProfile(legs, totalDistance)   [hos.ts, pure]
  → SpeedEdge[] (coalesced, bounded length)
buildTimeline(startedAt, totalDistance, desiredArrival, profile)
  → simulateMinimum(..., profile) → makeDriving(..., profile) → DrivingSegment[]
  → distributeSlack(...)   [UNCHANGED]
  → Segment[]   (stored in trips.timeline JSONB; interpolate.ts reads it client-side)
```

`hos.ts` gains one external-data dependency (the precomputed profile) but stays pure: the
profile is built upstream and passed in, so tests inject fixtures.

## Component changes

### `packages/simulation/src/mapbox.ts`
- Add `MAPBOX_PROFILE = 'mapbox/driving'` constant (document: free-flow, not traffic).
- URL: `…&overview=full&annotations=duration,distance&…`.
- Extend `RouteResult` with `legs: Array<{ annotation: { duration: number[]; distance: number[] } }>`; return `data.routes[0].legs`.
- Assert `legs[0]?.annotation` exists (annotations require `overview=full`); throw a
  descriptive error if absent rather than proceeding with an empty profile.

### `packages/simulation/src/hos.ts`
- Export `type SpeedEdge = { distStart: number; distEnd: number; duration: number }`.
- Export `buildSpeedProfile(legs, totalDistance): SpeedEdge[]`:
  1. Concatenate per-leg annotation arrays leg-by-leg — they **abut with no overlap**
     (unlike geometry coordinates, which share a boundary point).
  2. Build raw edges by running cumulative distance.
  3. **Skip** edges where `duration <= 0 || distance <= 0` (waypoint-snapping artifacts;
     avoids divide-by-zero).
  4. Coalesce adjacent edges whose implied speed `Σdist / Σduration` is within
     `COALESCE_TOLERANCE_MS` (default `8_000/3600` = 8 km/h), single-pass scan.
  5. If band count > `MAX_SPEED_BANDS` (default 500), widen tolerance ×1.5 and re-coalesce
     until under the cap.
  6. **Reconcile** the last band's `distEnd` to `totalDistance` (kills float drift between
     `routes[0].distance` and `Σ annotation.distance`).
- Export `flatSpeedProfile(totalDistance, speedMs = 88_000/3600): SpeedEdge[]` — a single
  edge spanning the route. Reproduces today's behaviour bit-for-bit and is the only home
  of the 88 km/h constant after `AVG_SPEED_MS` is deleted.
- Thread `profile: SpeedEdge[]` through `buildTimeline` → `simulateMinimum` → `makeDriving`.
- Rewrite `makeDriving` to return `DrivingSegment[]`:
  - Init cursor `profile.findIndex(e => e.distEnd > distStart)` — the band containing
    `distStart`, so phase 2 resumes exactly where phase 1 stopped.
  - Accumulate band durations forward until `maxSeconds` is consumed or `totalDistance`
    is reached.
  - When the budget runs out mid-band, **split exactly**: emit a segment whose `tEnd =
    tStart + budgetLeft` and whose `distEnd` is the proportional point in the band.
  - Each emitted segment is constant-speed by construction → `interpolate.ts`'s linear
    ratio holds.
  - Termination check uses the reconciled `distEnd` and keeps the `Math.min(totalDistance, …)` clamp.
- Update the two `makeDriving` call sites in `simulateMinimum`: spread the returned array,
  take the last element for the running `t` / `dist`.
- `distributeSlack` is **unchanged** — it only shifts `tStart`/`tEnd` and extends sleeps;
  it never touches distances and is indifferent to segment count.

### `packages/simulation/src/generate.ts`
- Destructure `legs`; `const profile = buildSpeedProfile(legs, totalDistance)`; pass to
  `buildTimeline`. Returned `Trip` shape is identical.
- Confirm the package export surface re-exports `buildTimeline` / `flatSpeedProfile` for
  the seed script.

### `apps/api/src/scripts/seed-demo-trip.ts`
- Delete the private divergent `buildTimeline` (lines 31–67) and local `AVG_SPEED_MS`.
- Call the canonical `buildTimeline` with `flatSpeedProfile(totalDistance)` (no Mapbox
  token needed), preserving the zero-slack demo trip behaviour.

## Invariants (must be asserted)

1. Temporal contiguity: `tStart[i] == tEnd[i-1]`.
2. Final `tEnd == desiredArrival`.
3. `minArrival <= desiredArrival` HosError guard (and `minimumArrival` echoed in 422).
4. Monotonic non-decreasing distance; `atDist` on rest = preceding `distEnd`.
5. Driving-segment immutability inside `distributeSlack` (distances never change).
6. Last `distEnd == totalDistance`.
7. Every segment valid against `SegmentSchema`.

## Consequences & risks

- **ETA shifts later on city-heavy routes.** Real `mapbox/driving` speed averages below
  88 km/h on typical US city→city routes (urban ingress/egress), so `minArrival` rises and
  `HosError 422` fires for more `desiredArrival` values. This is more honest, not a bug.
  Clients computing `desiredArrival = startedAt + dist/88 + padding` must switch to the
  real Mapbox `duration`. **Needs a release-notes callout.**
- **Payload grows ~12–18×** (≈8–12 KB, still inline in every GET/share). Coalescing is
  mandatory — one segment per raw edge would be 4–5 MB. Dense urban routes may hit
  `MAX_SPEED_BANDS` and coarsen; acceptable (urban trips are short, HOS rarely binds).
- **Float drift** between `routes[0].distance` and `Σ annotation.distance` — handled by
  last-band reconciliation + the `totalDistance` clamp in `makeDriving`.
- **Segment-count semantics.** A trip jumps from ~6 to 40–80 `DrivingSegment`s. Audit any
  client/analytics that infers shift count from segment count (share-page arrival display
  is safe — it reads the last segment's `tEnd`).
- **`overview=full` coupling.** Any future switch to `overview=simplified/false` silently
  drops annotations; the new assert guards against shipping an empty profile.

## Test plan

- Convert existing `hos.test.ts` cases to inject `flatSpeedProfile(dist)`; all numeric
  assertions stay valid (bit-for-bit equivalent to old constant).
- `buildSpeedProfile`: two-leg concat correctness; zero-duration edge filtering; coalescing
  tolerance (4 near-equal speeds merge, an outlier splits); `MAX_SPEED_BANDS` cap with
  widen-and-recoalesce; last `distEnd == totalDistance`.
- `makeDriving`: exact mid-band split (time across emitted segments == `maxSeconds`);
  partial-first-band entry (`distStart` mid-band resumes correctly).
- Invariants on a multi-band profile: contiguity (microsecond precision), `totalDistance`
  terminus, `tEnd == desiredArrival`, `distributeSlack` leaves distances untouched.
- Regression: flat profile reproduces old segment count / rest order / `tEnd` and old
  `HosError.minimumArrival` for representative distances (100/900/1300 km).

## Out of scope

Rolling 60/70h window; `driving-traffic` / live traffic; GPS tracking; backfilling
existing trips; loading/unloading dwell modelling.
