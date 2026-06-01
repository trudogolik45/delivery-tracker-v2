---
title: Implement per-edge variable road speeds in HOS timeline (A1 + coalesce-first)
---

## Initial User Prompt

> Original feature intent (brainstorm):
> Users want improved driver delivery logic with more realistic routing and ETA
> calculations, taking into account HOS rules and average road speeds.

> Confirmation:
> Да согласен с A1 + coalesce-first, разверни задачу

### Locked decisions from brainstorm (do not re-litigate)

- **Core problem**: `generateTrip` fetches Mapbox Directions but discards `duration`;
  `buildTimeline` drives at a flat `AVG_SPEED_MS = 88 km/h` for the whole route,
  ignoring real road-class speeds. HOS rules (8h/30min/11h/14h on-duty window/10h
  sleep/sleep-cap+wait) are already implemented; 60/70h rolling window stays out of
  scope (ADR-0002).
- **Representation**: variant 1 — split driving into multiple **constant-speed
  `DrivingSegment`s**, one per coalesced speed band. The `Segment`/`Trip` schema in
  `@delivery/schemas` and `interpolate.ts` MUST stay unchanged (within-segment
  interpolation is already linear).
- **Speed source**: Mapbox profile `mapbox/driving` (typical road-class speeds,
  deterministic, no staleness — matches ADR-0002 precomputed-once timeline), request
  `annotations=duration,distance` with `overview=full`. NOT `driving-traffic`.
- **Chosen approach**: A1 (distance-walk with an immutable-profile cursor in
  `makeDriving`) merged with mandatory coalesce-first. The imperative two-phase loop in
  `simulateMinimum` is preserved — this is NOT an event-driven scheduler (that was
  rejected by FPF for violating the Simplicity constraint).
- **Existing trips**: new trips only, no backfill (old flat-88 timelines stay valid).

### Verified design skeleton (from adversarial workflow)

- `mapbox.ts`: add `annotations=duration,distance` to the URL, const `MAPBOX_PROFILE =
  'mapbox/driving'`, extend `RouteResult` with `legs: Array<{ annotation: { duration:
  number[]; distance: number[] } }>`; assert `legs[0].annotation` present (overview=full
  coupling) else throw.
- `hos.ts`: export `type SpeedEdge = { distStart; distEnd; duration }`; add
  `buildSpeedProfile(legs, totalDistance)` — concatenate per-leg annotation arrays (they
  abut, no overlap), build raw edges by cumulative distance, **skip edges where
  `duration <= 0 || distance <= 0`**, coalesce adjacent edges whose implied speed
  (`Σdist/Σduration`, harmonic-style) is within `COALESCE_TOLERANCE_MS` (default 8 km/h),
  cap at `MAX_SPEED_BANDS` (default 500) widening tolerance ×1.5 until under cap, and
  **reconcile last band `distEnd` to `totalDistance`**.
- `hos.ts`: add `flatSpeedProfile(totalDistance, speedMs = 88_000/3600)` returning a
  single edge — reproduces current behaviour bit-for-bit; the only home of the 88 constant.
- `hos.ts`: thread `profile: SpeedEdge[]` through `buildTimeline` → `simulateMinimum` →
  `makeDriving`. `makeDriving` returns `DrivingSegment[]`: init cursor
  `profile.findIndex(e => e.distEnd > distStart)`, accumulate band durations until
  `maxSeconds` is hit, **exact mid-band split** where the HOS cap lands. Update the two
  call sites in `simulateMinimum` to spread the array and take the last segment for
  `t`/`dist`. The `Math.min(totalDistance, …)` / `dist < totalDistance - 0.01`
  termination must use the reconciled distEnd.
- `distributeSlack`: UNCHANGED (only shifts tStart/tEnd, never distances; indifferent to
  segment count).
- `generate.ts`: destructure `legs`, `const profile = buildSpeedProfile(legs,
  totalDistance)`, pass to `buildTimeline`.
- `seed-demo-trip.ts`: delete the private divergent `buildTimeline` + local
  `AVG_SPEED_MS`; call the canonical `buildTimeline` with `flatSpeedProfile(totalDistance)`
  to preserve zero-slack demo behaviour. Confirm the package export surface re-exports
  `buildTimeline`/`flatSpeedProfile`.

### Invariants to preserve (must be asserted in tests)

Temporal contiguity (`tStart[i] == tEnd[i-1]`); final `tEnd == desiredArrival`;
`minArrival <= desiredArrival` HosError guard; monotonic non-decreasing distance;
driving-segment immutability in `distributeSlack`; last `distEnd == totalDistance`;
every segment valid against `SegmentSchema`.

### Known consequences / risks to surface

- Real `mapbox/driving` speeds are often **slower** than 88 km/h on city-heavy US routes
  → `minArrival` later → more `HosError 422`. Clients computing `desiredArrival =
  startedAt + dist/88 + padding` must switch to the real Mapbox `duration`. Needs a
  release-notes callout.
- Payload grows ~12–18× (still 8–12 KB, inline in every GET/share) — coalescing is
  mandatory; urban routes may hit `MAX_SPEED_BANDS` and coarsen (acceptable).
- Float drift between `routes[0].distance` and `Σ annotation.distance` — last-band
  reconciliation + clamp required.
- Audit any client code that infers shift count from `DrivingSegment` count (now 40–80).

## Description

// Will be filled in future stages by business analyst
