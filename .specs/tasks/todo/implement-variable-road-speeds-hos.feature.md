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

## Implementation Notes

> **Required Skill**: You MUST use and analyse `hos-variable-speed-profile` skill before doing any modification to task file or starting implementation of it!
>
> Skill location: `.claude/skills/hos-variable-speed-profile/SKILL.md`

# Description

The HOS (Hours of Service) timeline generator currently assumes a single flat speed for every driving segment, regardless of the actual road types traversed. The routing service already returns per-segment duration and distance annotations that encode real road-class speeds, but this data is discarded. This mismatch causes minimum feasible arrival times to be systematically optimistic on city-heavy routes, leading to HOS break placements that are nominally correct but practically infeasible, and to share-page ETAs that do not reflect reality.

This feature extends trip generation so that routing queries request per-segment speed annotation data, and the HOS timeline builder uses that data to govern driving-segment durations. Trip timelines reflect per-road-class speeds instead of a single average, so HOS breaks land where they are actually feasible given the roads being traveled. The number of distinct speed zones per trip is bounded so the stored timeline stays small enough to serve inline on every share page. A compatibility mode preserves the legacy fixed-speed behavior for contexts without live routing data, such as the demo seed script, ensuring no behavioral regression in those paths. All existing HOS simulation invariants (temporal contiguity, final arrival time, monotonic distance, slack-distribution immutability, segment schema validity) are preserved and asserted in tests.

Clients that currently compute desired arrival from a fixed speed estimate will encounter more 422 HosErrors after this change because real urban speeds are lower than the legacy flat-speed assumption. A release-notes callout must document this regression risk and direct clients to use the actual route duration field instead.

**Scope**:
- Included: trip timelines reflect per-road-class speeds derived from routing annotations; routing queries request per-segment speed annotations (duration and distance) with full route overview; speed profiles derived from routing annotations govern driving segment durations and HOS break placement; compatibility mode for fixed-speed contexts (e.g., demo seed) preserves legacy behavior; demo seed script updated to use the shared compatibility mode; invariant test suite covering temporal contiguity, final arrival time, monotonic distance, slack-distribution immutability, and segment schema validity; release notes callout documenting the minimum-arrival regression risk for clients using flat-speed estimation.
- Excluded: traffic-aware routing profile; 60/70h rolling HOS window; backfill of existing trips; changes to shared Segment/Trip schema types or within-segment interpolation logic; event-driven scheduler; UI or share-page changes; database migration.

**User Scenarios**:
1. **Primary Flow**: New trip creation fetches routing data with per-segment annotations, a speed profile is constructed and threaded through the HOS simulation, producing per-band driving segments with realistic speed-based durations and correctly placed HOS breaks.
2. **Alternative Flow**: Demo seed script uses the single-band compatibility profile to reproduce legacy fixed-speed timeline without a live routing call.
3. **Error Handling**: Missing annotation data in the routing response throws before timeline build begins; all-invalid annotation edges produce a descriptive error; a desired arrival earlier than the speed-profile-derived minimum returns a 422 response carrying the earliest feasible arrival.

---

## Acceptance Criteria

### Functional Requirements

- [ ] **Routing fetch includes annotation data**: Every new trip generation requests per-segment speed annotation data from the routing service.
  - Given: a trip generation is initiated with valid origin and destination
  - When: the routing service API is called
  - Then: the request includes parameters for per-segment duration and distance annotations with full route overview, and the parsed route result exposes per-leg annotation arrays of duration and distance numbers

- [ ] **Speed profile is contiguous and reconciled**: The constructed speed profile covers the full route distance without gaps, overlaps, or invalid bands.
  - Given: a multi-leg routing response with per-segment annotation arrays
  - When: a speed profile is constructed from that routing response (via `buildSpeedProfile`)
  - Then: the first band starts at distance 0, the last band ends at exactly `totalDistance`, every band's start distance equals the previous band's end distance, no band has zero or negative duration or distance, and the total number of bands does not exceed 500

- [ ] **Adjacent near-speed bands are coalesced**: Bands with similar implied speeds are merged to minimize payload size.
  - Given: two adjacent annotation segments whose implied speeds differ by less than 8 km/h
  - When: a speed profile is constructed from those segments (via `buildSpeedProfile`)
  - Then: they appear as a single band in the output rather than two separate bands

- [ ] **Driving segment emitter produces exact mid-band HOS cap split**: When an HOS time cap falls inside a speed band, the driving segment ends at the precise distance within that band.
  - Given: a two-band speed profile (band 1 covering 0–100 km, band 2 covering 100–200 km) and an HOS time cap that corresponds to 30 km into band 2
  - When: driving segments are emitted for that profile and cap (via `makeDriving`)
  - Then: the result contains two driving segments — the first covering 0–100 km and the second covering 100–130 km — and the sum of their durations equals the HOS time cap exactly

- [ ] **Temporal contiguity is preserved across all segments**: No time gaps or overlaps exist between adjacent segments in the generated timeline.
  - Given: a generated trip with multiple driving and rest segments
  - When: the full segment array is inspected
  - Then: for every adjacent pair of segments, the start time of segment N equals the end time of segment N-1, to millisecond precision

- [ ] **Final segment ends at desiredArrival**: The timeline's last segment end time matches the requested arrival time exactly.
  - Given: a valid trip generation call with a specified desired arrival time
  - When: a trip timeline is built from those inputs (via `buildTimeline`)
  - Then: the last segment's end time equals `desiredArrival` exactly

- [ ] **Fixed-speed compatibility mode reproduces legacy 88 km/h behavior**: Using the single-band fallback profile produces a timeline identical to the previous flat-speed implementation.
  - Given: the same route inputs used with the legacy flat-speed code path
  - When: a trip timeline is built using the fixed-speed compatibility profile for that route (via `flatSpeedProfile`)
  - Then: all segment timestamps are within 1 ms and all segment distances are within 1 m of the legacy output

- [ ] **All segments pass schema validation**: No segment in the generated trip violates the existing segment contract.
  - Given: a trip generated using the new variable-speed pipeline
  - When: each segment is validated against `SegmentSchema`
  - Then: all segments pass validation without errors

- [ ] **seed-demo-trip produces valid zero-slack trip using the shared compatibility mode**: The demo seed script uses the canonical pipeline and its output is indistinguishable from the legacy flat-speed result.
  - Given: `seed-demo-trip.ts` is executed (no live routing call required)
  - When: a trip timeline is built using the fixed-speed compatibility profile (via `buildTimeline` with `flatSpeedProfile(totalDistance)`)
  - Then: the resulting trip has zero slack, all segments are valid, and the demo seed produces a timeline whose segments are identical (same count, same rest reasons in order, tEnd within 1 ms) to the legacy flat-88 km/h output

- [ ] **Missing annotation data throws a descriptive error**: A routing response lacking annotation data fails explicitly rather than silently producing a broken timeline.
  - Given: a routing response that does not include per-leg annotation arrays
  - When: trip generation processes that response
  - Then: an error is thrown before timeline build begins, with a message that identifies the missing annotation field; no silent server error occurs

- [ ] **All-invalid annotation edges produce a descriptive error**: When annotation arrays are present but every entry is unusable, the system fails explicitly rather than producing a degenerate speed profile.
  - Given: a routing response whose annotation arrays contain at least one entry, but every entry has duration <= 0 or distance <= 0
  - When: the speed profile construction processes those arrays
  - Then: an error is thrown with a message identifying that no valid annotation edges were found; no degenerate or empty speed profile is passed to the timeline builder

- [ ] **Infeasible arrival time triggers a 422 response carrying minimumArrival**: When the desired arrival is earlier than physically possible given realistic road speeds and required HOS breaks, the caller receives a structured error.
  - Given: a trip generation request where `desiredArrival` is earlier than the minimum feasible arrival derived from the speed-profile-driven timeline
  - When: the HOS timeline builder evaluates feasibility
  - Then: the API responds with HTTP 422 and a response body containing a `minimumArrival` field set to the earliest feasible arrival time

- [ ] **Band-count cap triggers tolerance widening to produce a valid reconciled profile**: When initial coalescing leaves more speed bands than the allowed maximum, progressive widening produces a conforming profile.
  - Given: a route whose annotation arrays produce more bands than the maximum allowed cap after initial coalescing at default tolerance
  - When: the speed profile construction applies progressive tolerance widening
  - Then: the resulting profile contains a band count at or below the maximum cap, every band has positive duration and distance, adjacent bands share contiguous distance boundaries with no gaps or overlaps, the first band starts at distance 0, and the last band ends at `totalDistance`

- [ ] **Slack distribution does not alter driving distances**: Slack distribution shifts timestamps only and leaves all distance values unchanged.
  - Given: a generated trip with multiple driving segments
  - When: slack is distributed across the timeline (via `distributeSlack`)
  - Then: every driving segment's start distance and end distance are identical to their pre-distribution values; only start and end times change

- [ ] **Routing service unavailable propagates error without persisting a timeline**: When the routing service cannot be reached, no partial or invalid timeline reaches storage.
  - Given: the routing service returns a 5xx response or times out
  - When: a trip is generated
  - Then: the error propagates to the caller and no partial or invalid timeline is persisted to storage

- [ ] **Partial annotation data raises the same descriptive error as fully missing annotations**: A multi-leg route where only some legs carry annotation data is treated as a hard failure, not silently patched.
  - Given: a multi-leg route where some legs include annotation arrays and others do not
  - When: the speed profile is constructed from that response (via `buildSpeedProfile`)
  - Then: the system raises a descriptive error identifying the affected leg, identical in kind to the error raised when annotations are entirely absent; no silent gaps or zero-speed segments are produced

### Non-Functional Requirements

- [ ] **Determinism**: Given the same route inputs (identical routing response and token), when a trip is generated twice, the two timelines are byte-identical.
- [ ] **Payload size**: A 600 km route yielding approximately 200 annotation segments produces a stored timeline under 15 KB.
- [ ] **Float precision**: The last speed band's end distance is within 0.001 m of `totalDistance` after reconciliation.
- [ ] **No schema regression**: The stored timeline validates against the existing SegmentSchema and existing share pages render it without modification.

### Definition of Done

- [ ] All acceptance criteria pass
- [ ] Tests written and passing for all invariants listed in the task brief
- [ ] Release notes callout documents the `minArrival` regression risk for clients using flat-speed estimation
- [ ] Code reviewed
- [ ] No existing trip data is affected (new trips only)

---

## Architecture

> References: Skill `.claude/skills/hos-variable-speed-profile/SKILL.md` · Analysis `.specs/scratchpad/01d90203.md` · Scratchpad `.specs/scratchpad/4185a57d.md`

### Solution Strategy

**Architecture Pattern**: Layered pure-function pipeline — matching the existing `packages/simulation` design of HTTP fetch (mapbox.ts) → domain computation (hos.ts) → orchestration (generate.ts). The new profile-construction stage slots between the fetch and simulation layers without introducing classes, shared state, or an event bus.

**Approach**: Thread a coalesced `SpeedEdge[]` speed profile — constructed once at route-fetch time from Mapbox Directions per-edge annotation arrays — through the existing pure-function HOS simulation pipeline (`buildTimeline → simulateMinimum → makeDriving`). `makeDriving` is refactored to return `DrivingSegment[]` and walks an immutable cursor through the profile, emitting one segment per speed band consumed, with an exact mid-band split when the HOS time cap falls inside a band. `flatSpeedProfile(totalDistance)` is the single-band compatibility fallback (the only remaining home of the 88 km/h constant), used as the optional default arg to `buildTimeline` and explicitly by `seed-demo-trip.ts` via the HosError-probe pattern. `Segment`/`Trip` schemas, `interpolate.ts`, and `distributeSlack` are untouched. All 11 existing test call sites pass without modification.

**Key Decisions**:

1. **`makeDriving` returns `DrivingSegment[]`**: One call may cross multiple speed bands; returning an array lets `simulateMinimum` spread the results naturally without schema change or mutable accumulator.
2. **`profile` optional with default `flatSpeedProfile(totalDistance)`**: Zero changes to all 11 existing test call sites. TypeScript evaluates default parameters left-to-right, so referencing `totalDistance` in the 4th param default is valid.
3. **`flatSpeedProfile` replaces `AVG_SPEED_MS` as the 88 km/h authority**: `AVG_SPEED_MS` is removed from module scope; its value lives only as the default `speedMs` parameter of `flatSpeedProfile`.
4. **Coalesce-first**: Profile built and coalesced once at `buildSpeedProfile` call time — never inside `simulateMinimum`. O(bands) cursor walk per `makeDriving` call, bounded by `MAX_SPEED_BANDS = 500`.
5. **seed-demo-trip.ts uses HosError-probe for minArrival**: The canonical `buildTimeline` requires `desiredArrival`. The seed probes `minArrival` by catching `HosError` from an unreachable desired arrival, then calls `buildTimeline(startedAt, totalDistance, minArrival, flatSpeedProfile(totalDistance))`. This produces zero-slack output identical to the legacy 2-arg function.
6. **All-invalid edges throw, not fall back**: Silent fallback to `flatSpeedProfile` would mask API contract violations and produce wrong ETAs. A descriptive `Error` is thrown when every annotation edge is unusable (`raw.length === 0`).
7. **Per-leg annotation validation**: Each leg in `buildSpeedProfile` Phase 1 is validated for the presence of `annotation.duration` and `annotation.distance` before processing; a missing leg throws with the offending leg index, satisfying the "partial annotation" acceptance criterion.

**Trade-offs Accepted**:
- `DrivingSegment` count grows from ~2–6 to ~40–80 per trip: `interpolate.ts` binary search handles any count; schema unchanged; web UI cosmetic display unaffected.
- Real `mapbox/driving` speeds are slower than 88 km/h on city routes → more 422 HosErrors: documented in release notes; clients must switch to Mapbox `duration` for `desiredArrival`.
- Tolerance-widening loop is O(N × widening iterations): acceptable in practice — `MAX_SPEED_BANDS = 500` limits the cap.

---

### Architecture Decomposition

**Components**:

| Component | File | Responsibility | Dependencies |
|-----------|------|----------------|--------------|
| `SpeedEdge` type (new export) | `hos.ts` | One constant-speed band: `{ distStart, distEnd, duration }` | None |
| `COALESCE_TOLERANCE_MS` (private) | `hos.ts` | 8 km/h in m/s = `8_000 / 3600` | None |
| `MAX_SPEED_BANDS` (private) | `hos.ts` | 500 | None |
| `coalesce` (new private fn) | `hos.ts` | Merges adjacent `SpeedEdge[]` within tolerance | `SpeedEdge` |
| `buildSpeedProfile` (new export) | `hos.ts` | Validates per-leg annotation presence; flattens + skips zero edges; coalesces with widening loop; reconciles last band | `SpeedEdge`, `coalesce` |
| `flatSpeedProfile` (new export) | `hos.ts` | Single-band 88 km/h profile; only home of the 88 constant | `SpeedEdge` |
| `makeDriving` (refactored) | `hos.ts` | Cursor-walks `SpeedEdge[]`; emits `DrivingSegment[]` up to `maxSeconds`; exact mid-band split | `SpeedEdge`, `DrivingSegment` |
| `simulateMinimum` (updated) | `hos.ts` | Accepts `profile: SpeedEdge[]`; spreads both `makeDriving` arrays; reads last element | `makeDriving` |
| `buildTimeline` (updated) | `hos.ts` | Optional `profile` arg defaulting to `flatSpeedProfile(totalDistance)` | `simulateMinimum`, `distributeSlack` |
| `MAPBOX_PROFILE` (new private) | `mapbox.ts` | `'mapbox/driving'` — makes profile explicit | None |
| `RouteResult` (updated) | `mapbox.ts` | Add `legs: Array<{annotation:{duration:number[];distance:number[]}}>` | None |
| `getRoute` (updated) | `mapbox.ts` | Appends `&annotations=duration,distance`; asserts `legs[0].annotation`; returns `legs` | `RouteResult` |
| `generateTrip` (updated) | `generate.ts` | Destructures `legs`; calls `buildSpeedProfile`; passes profile to `buildTimeline` | `getRoute`, `buildSpeedProfile`, `buildTimeline` |
| Re-exports | `generate.ts` | `export { buildTimeline, flatSpeedProfile } from './hos.js'` | `hos.ts` |
| `seed-demo-trip.ts` (cleaned) | `apps/api/src/scripts/` | Deletes private `buildTimeline` + `AVG_SPEED_MS`; HosError-probe for `minArrival`; uses canonical functions | `@delivery/simulation/generate` |
| New tests | `hos.test.ts` | ~16 new cases: profile build, cursor walk, mid-band split, error paths, all invariants | `hos.ts` |

**Interactions**:

```
mapbox.ts (getRoute)
    │  legs: Array<{annotation:{duration:number[];distance:number[]}}>
    ▼
hos.ts (buildSpeedProfile)
    │  SpeedEdge[]  (<=500 coalesced bands, contiguous, last.distEnd==totalDistance)
    ▼
hos.ts (buildTimeline → simulateMinimum → makeDriving)
    │  Segment[]
    ▼
generate.ts (generateTrip) → Trip → API → DB
                                │
    seed-demo-trip.ts ──────────┘  (via @delivery/simulation/generate re-exports)
```

---

### Expected Changes

```
packages/simulation/src/
  mapbox.ts     UPDATE  add &annotations=duration,distance to URL; extend RouteResult
                        with legs; assert legs[0].annotation; return legs from getRoute
  hos.ts        UPDATE  remove AVG_SPEED_MS; add SpeedEdge type, buildSpeedProfile,
                        flatSpeedProfile, coalesce (private);
                        refactor makeDriving → DrivingSegment[];
                        update simulateMinimum and buildTimeline signatures
  generate.ts   UPDATE  destructure legs; compute profile; pass to buildTimeline;
                        re-export buildTimeline + flatSpeedProfile
  hos.test.ts   UPDATE  add ~16 new test cases; existing 11 tests unchanged

apps/api/src/scripts/
  seed-demo-trip.ts  UPDATE  delete private buildTimeline + AVG_SPEED_MS;
                             import canonical fns; HosError-probe for minArrival

docs/ (or CHANGELOG)
  release-notes      NEW  document HosError regression risk and DrivingSegment count change
```

No new files. No DB migration. No schema changes. No web app changes.

---

### Runtime Scenarios

**Scenario: New Trip Generation (happy path)**

```
POST /admin/b/:slug/trips
    │
    ▼  getRoute() → Mapbox v5 ?annotations=duration,distance&overview=full
                 ← RouteResult { polyline, totalDistance, duration, legs }
                   assert legs[0].annotation present
    │
    ▼  buildSpeedProfile(legs, totalDistance)
       Phase 1: validate each leg.annotation; flatten; skip duration<=0 || distance<=0
                if raw.length === 0 → throw Error('No valid annotation edges found')
       Phase 2: coalesce(raw, 8 km/h); if bands > 500: tolerance×=1.5; repeat
       Phase 3: bands[last].distEnd = totalDistance
       ← SpeedEdge[K], K ≤ 500
    │
    ▼  buildTimeline(startedAt, totalDistance, desiredArrival, profile)
       simulateMinimum: cursor-walk per shift
         d1 = makeDriving(..., MAX_DRIVE_BEFORE_BREAK, profile) → DrivingSegment[]
         break segment
         d2 = makeDriving(..., min(shiftLeft, windowLeft), profile) → DrivingSegment[]
         sleep segment (if not at destination)
         repeat
       if minArrival > desiredArrival → throw HosError(422, minimumArrival)
       distributeSlack(minimum, slack) → Segment[]
    ← Trip { startedAt, polyline, totalDistance, segments, pauses:[] }
    DB insert trips.timeline
```

**Scenario: Demo Seed Script (no live routing)**

```
seed-demo-trip.ts:
  totalDistance = turf.length(hardcoded NYC-Chicago polyline)
  probe: try buildTimeline(startedAt, totalDistance, startedAt, flatSpeedProfile(totalDistance))
         catch HosError → minArrival = e.minimumArrival
  timeline = buildTimeline(startedAt, totalDistance, minArrival, flatSpeedProfile(totalDistance))
    single-band cursor walk (flat 88 km/h; identical to legacy)
    slack = 0 → distributeSlack returns minimum unchanged → zero-slack Segment[]
  desiredArrival = new Date(minArrival × 1000)
  DB insert (unchanged from legacy behaviour)
```

**Scenario: Missing Annotation (error path)**

```
getRoute(): Mapbox response with overview ≠ full (no annotation arrays)
  assert route.legs?.[0]?.annotation fails
  → throw Error('Mapbox annotation missing: ensure overview=full')
  No timeline built. No DB write. Error propagates → 5xx.
```

**Scenario: All-Invalid Annotation Edges (error path)**

```
buildSpeedProfile(): all edges have duration<=0 or distance<=0
  Phase 1 completes: raw.length === 0
  → throw Error('No valid annotation edges found in route response')
  No timeline built. Error propagates → 5xx.
```

**cursor state transitions inside `makeDriving`**:

```
cursor = findIndex(e.distEnd > distStart)  [guard: if -1, use profile.length - 1]
    │
    ▼  while secondsLeft > 0 and dist < totalDistance - 0.01
    │
    ├── if cursor >= profile.length → break
    │
    ├── bandSeconds <= secondsLeft?
    │     YES: push full-band segment; dist += bandDist; secondsLeft -= bandSeconds; cursor++
    │          └─► loop
    │     NO:  push partial-band segment (partialDist = secondsLeft × speedMs); break
    │
    ▼  return DrivingSegment[]
```

---

### Architecture Decisions

**Decision: `makeDriving` returns `DrivingSegment[]` not `DrivingSegment`**

**Status**: Accepted (locked by task design skeleton)

**Context**: A1 approach requires emitting one `DrivingSegment` per speed band traversed; a single HOS drive period may cross multiple bands.

**Options**:
1. Return `DrivingSegment[]` — caller spreads into `segments[]` and reads last element
2. Return `DrivingSegment` with embedded sub-segments — schema change required
3. Accumulate into shared `segments[]` passed by reference — mutable state

**Decision**: Option 1. No schema change. No mutable state. Both call sites updated identically.

**Consequences**:
- Both `makeDriving` call sites in `simulateMinimum` must be updated simultaneously or types break
- `DrivingSegment` count increases from 2–6 to 40–80 per trip; `interpolate.ts` and web UI unaffected
- `makeDriving` tests assert on array contents, not a single object

---

**Decision: All-invalid annotation edges → throw, not fall back to `flatSpeedProfile`**

**Status**: Accepted (Acceptance Criteria take precedence over skill file suggestion)

**Context**: Skill file `buildSpeedProfile` pattern shows `if (raw.length === 0) return flatSpeedProfile(totalDistance)`. The Acceptance Criteria require an explicit descriptive error.

**Options**:
1. Silent fallback to `flatSpeedProfile`
2. Throw descriptive error

**Decision**: Option 2. Explicit failure surfaces API contract violations to operators rather than silently producing wrong ETAs.

**Consequences**:
- Routing responses with all-zero annotations surface as 5xx errors rather than degrading silently
- `buildSpeedProfile` error message must identify the cause
- Test covers this case with `expect().toThrow()`

---

### Workflow Steps

```
1. Update mapbox.ts
       │ (legs available in RouteResult)
       ▼
2. Update hos.ts  (SpeedEdge, buildSpeedProfile, flatSpeedProfile, coalesce,
       │           makeDriving→DrivingSegment[], simulateMinimum, buildTimeline updated)
       │ (new exports + refactored simulation)
       ▼
3. Update generate.ts
       │ (threads profile; re-exports buildTimeline + flatSpeedProfile)
       ▼
4. Update seed-demo-trip.ts
       │ (HosError-probe; zero-slack demo preserved)
       ▼
5. Add tests in hos.test.ts
       │ (all invariants verified; existing 11 tests unchanged)
       ▼
6. Add release notes
```

Each phase depends on all prior phases completing. Phases 1 and 2 can begin in parallel (hos.ts needs only the type shape of `legs`, not the compiled mapbox.ts), but the full type-check chain requires completion in order.

---

### Contracts

**Updated `buildTimeline`**:

```typescript
export function buildTimeline(
  startedAt: number,       // unix seconds
  totalDistance: number,   // meters
  desiredArrival: number,  // unix seconds
  profile?: SpeedEdge[],   // default: flatSpeedProfile(totalDistance)
): Segment[]               // throws HosError if desiredArrival < minArrival
```

**New `buildSpeedProfile`**:

```typescript
export function buildSpeedProfile(
  legs: Array<{ annotation: { duration: number[]; distance: number[] } }>,
  totalDistance: number,   // meters; used for last-band reconciliation
): SpeedEdge[]             // throws if annotation missing on any leg, or all edges are invalid
```

**New `flatSpeedProfile`**:

```typescript
export function flatSpeedProfile(
  totalDistance: number,
  speedMs?: number,        // default: 88_000 / 3600 m/s
): SpeedEdge[]             // always single-element array
```

**New `SpeedEdge` type**:

```typescript
export type SpeedEdge = {
  distStart: number  // meters from route start; >= 0
  distEnd: number    // meters from route start; > distStart
  duration: number   // seconds to traverse this band; > 0
}
```

**Updated `RouteResult`**:

```typescript
export type RouteResult = {
  polyline: LineString
  totalDistance: number
  duration: number
  legs: Array<{ annotation: { duration: number[]; distance: number[] } }>
}
```

---

## Implementation Process

You MUST launch for each step a separate agent, instead of performing all steps yourself. And for each step marked as parallel, you MUST launch separate agents in parallel.

**CRITICAL:** For each agent you MUST:
1. Use the **Agent** type specified in the step (e.g., `opus`, `sdd:qa-engineer`, `sdd:tech-writer`)
2. Provide path to task file and prompt which step to implement
3. Require agent to implement exactly that step, not more, not less, not other steps

### Implementation Strategy

**Approach**: Bottom-Up
**Rationale**: The core complexity lives in `hos.ts` — new data structures (`SpeedEdge`), new exported functions (`buildSpeedProfile`, `flatSpeedProfile`), and a non-trivial refactor of `makeDriving`/`simulateMinimum`. The orchestration layers (`generate.ts`, `seed-demo-trip.ts`) are simple wiring once the domain layer is correct and tested in isolation. Building domain first enables the test suite to validate all invariants before any orchestration code is written.

### Parallelization Overview

```
Step 1 (mapbox.ts) [opus]          Step 2 (hos.ts) [opus]
(no deps — MUST start immediately)  (no deps — MUST start immediately)
(Parallel with Step 2)              (Parallel with Step 1)
         │                                   │
         └────────────────┬──────────────────┘
                          │
              (BOTH Steps 1 AND 2 MUST complete before proceeding)
                          │
               ┌──────────┴──────────┐
               ▼                     ▼
       Step 3 (generate.ts)    Step 5 (hos.test.ts)
            [opus]              [sdd:qa-engineer]
       (needs Steps 1+2)       (needs Step 2 only)
       (Parallel with Step 5)  (Parallel with Steps 3, 4)
               │                     │
               ▼                     │
       Step 4 (seed-demo-trip.ts)    │
            [opus]                   │
       (needs Step 3)                │
       (Parallel with Step 5)        │
               │                     │
               └──────────┬──────────┘
                          │
              (Step 6 waits for Step 5 to be green)
                          ▼
                 Step 6 (release notes)
                 [sdd:tech-writer]
                 (needs Step 5)
```

---

### Step 1: Update mapbox.ts — annotation fetch and RouteResult type

**Model:** opus
**Agent:** opus
**Depends on:** None
**Parallel with:** Step 2 — both have no dependencies and MUST be launched simultaneously

**Goal**: Extend `getRoute` to request per-segment annotation arrays from Mapbox Directions v5 and return them; update `RouteResult` type to expose `legs` with annotation shapes.

#### Expected Output

- `packages/simulation/src/mapbox.ts`: Updated with `&annotations=duration,distance` URL param, `MAPBOX_PROFILE` const, `RouteResult.legs` type field, response cast extension, annotation assertion, and `legs` in return value.

#### Success Criteria

- [ ] `RouteResult` type includes `legs: Array<{ annotation: { duration: number[]; distance: number[] } }>` field
- [ ] `getRoute` URL contains `&annotations=duration,distance` before `&access_token`
- [ ] `getRoute` response cast type includes `legs` with annotation arrays on each route
- [ ] After route null-check, assertion throws `Error('Mapbox annotation missing: ...')` if `route.legs?.[0]?.annotation` is absent
- [ ] `getRoute` return value includes `legs: route.legs`
- [ ] `const MAPBOX_PROFILE = 'mapbox/driving'` const added (makes profile explicit in source)
- [ ] TypeScript compiles without errors: `pnpm typecheck`

#### Subtasks

- [ ] Add `const MAPBOX_PROFILE = 'mapbox/driving'` before the `getRoute` function in `packages/simulation/src/mapbox.ts`
- [ ] Append `&annotations=duration,distance` to the URL query string in `packages/simulation/src/mapbox.ts` (before `&access_token`)
- [ ] Add `legs: Array<{ annotation: { duration: number[]; distance: number[] } }>` to the `RouteResult` type in `packages/simulation/src/mapbox.ts`
- [ ] Extend the response cast type in `getRoute` to include `legs` with annotation shapes on each route element
- [ ] Add assertion after `if (!route) throw ...`: throw `Error('Mapbox annotation missing: ensure overview=full and annotations=duration,distance are set')` when `!route.legs?.[0]?.annotation` in `packages/simulation/src/mapbox.ts`
- [ ] Add `legs: route.legs` to the return object in `getRoute` in `packages/simulation/src/mapbox.ts`
- [ ] Run `pnpm typecheck` and verify no TypeScript errors

#### Blockers

- None — this step has no prerequisites

#### Risks

- Mapbox API v5 annotation key is `annotation` (singular). Mapbox v6 renames it to `annotations` (plural). The URL is pinned to `v5`, so this is safe; document the v6 caveat in a code comment.

#### Complexity: Small
#### Uncertainty Rating: Low
#### Integration Points: `generate.ts` reads `RouteResult.legs` after this step

#### Definition of Done

- [ ] `RouteResult` type has `legs` field
- [ ] URL includes `&annotations=duration,distance`
- [ ] Assertion present for missing annotation
- [ ] Return includes `legs`
- [ ] `pnpm typecheck` passes

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `packages/simulation/src/mapbox.ts`
**Threshold:** 4.0/5.0

**Rubric:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Type Correctness | 0.30 | `RouteResult.legs` field has exact shape `Array<{ annotation: { duration: number[]; distance: number[] } }>`; response cast type includes `legs`; no structural type errors |
| URL Param Completeness | 0.25 | `&annotations=duration,distance` appended before `&access_token`; `overview=full` present; `MAPBOX_PROFILE` const added |
| Annotation Assertion | 0.25 | Assertion throws `Error('Mapbox annotation missing: ...')` when `!route.legs?.[0]?.annotation`; placed after null-check; no silent return |
| Return Value | 0.15 | `legs: route.legs` present in return object; all existing return fields preserved |
| Code Conventions | 0.05 | ESM `.js` imports; TypeScript strict-compatible; no unnecessary changes outside scope |

**Reference Pattern:** `packages/simulation/src/mapbox.ts`

---

### Step 2: Refactor hos.ts — SpeedEdge, buildSpeedProfile, flatSpeedProfile, makeDriving, simulateMinimum, buildTimeline

**Model:** opus
**Agent:** opus
**Depends on:** None
**Parallel with:** Step 1 — both have no dependencies and MUST be launched simultaneously

**Goal**: Implement the complete speed-profile pipeline in the HOS domain layer: new `SpeedEdge` type and constants, `coalesce` private function, `buildSpeedProfile` and `flatSpeedProfile` exports, refactored `makeDriving` returning `DrivingSegment[]`, and updated `simulateMinimum`/`buildTimeline` signatures. Remove `AVG_SPEED_MS` from module scope.

**CRITICAL**: All sub-changes must be applied atomically. `AVG_SPEED_MS` removal is coupled to `makeDriving` refactor; both `makeDriving` call sites in `simulateMinimum` must be updated simultaneously or the file will not typecheck.

#### Expected Output

- `packages/simulation/src/hos.ts`: `AVG_SPEED_MS` removed; `SpeedEdge` type exported; `COALESCE_TOLERANCE_MS` and `MAX_SPEED_BANDS` private consts added; `coalesce` private function added; `flatSpeedProfile` and `buildSpeedProfile` exported; `makeDriving` refactored to return `DrivingSegment[]` with cursor walk; both call sites in `simulateMinimum` updated to spread arrays; `buildTimeline` has optional `profile` fourth parameter.

#### Success Criteria

- [ ] `AVG_SPEED_MS` constant no longer exists in module scope of `packages/simulation/src/hos.ts`
- [ ] `export type SpeedEdge = { distStart: number; distEnd: number; duration: number }` is present
- [ ] `const COALESCE_TOLERANCE_MS = 8_000 / 3600` (private) is present
- [ ] `const MAX_SPEED_BANDS = 500` (private) is present
- [ ] Private `coalesce(edges: SpeedEdge[], tolerance: number): SpeedEdge[]` function is present
- [ ] `export function flatSpeedProfile(totalDistance: number, speedMs = 88_000 / 3600): SpeedEdge[]` is present and returns a single-element array
- [ ] `export function buildSpeedProfile(legs: Array<{annotation: {duration: number[]; distance: number[]}}>, totalDistance: number): SpeedEdge[]` is present
- [ ] `buildSpeedProfile` validates each leg for annotation presence and throws with leg index if missing
- [ ] `buildSpeedProfile` skips edges where `duration <= 0 || distance <= 0`
- [ ] `buildSpeedProfile` throws `Error('No valid annotation edges found...')` when `raw.length === 0` after filtering
- [ ] `buildSpeedProfile` applies widening tolerance loop: if `bands.length > MAX_SPEED_BANDS`, multiply `tolerance *= 1.5` and re-coalesce until conforming
- [ ] `buildSpeedProfile` sets `bands[bands.length - 1]!.distEnd = totalDistance` (last-band reconciliation)
- [ ] `makeDriving` signature includes `profile: SpeedEdge[]` and returns `DrivingSegment[]`
- [ ] `makeDriving` uses `findIndex(e => e.distEnd > distStart)` with guard `if (cursor === -1) cursor = profile.length - 1`
- [ ] `makeDriving` has `if (cursor >= profile.length) break` at the top of the while loop body
- [ ] `makeDriving` emits full-band segments and performs exact mid-band split when `bandSeconds > secondsLeft`
- [ ] Both `makeDriving` call sites in `simulateMinimum` spread the returned array (`segments.push(...segsN)`) and read the last element for `t` and `dist`
- [ ] `buildTimeline` has signature `buildTimeline(startedAt, totalDistance, desiredArrival, profile: SpeedEdge[] = flatSpeedProfile(totalDistance))`
- [ ] All 11 existing `buildTimeline` call sites in `hos.test.ts` (3-arg form) still typecheck and pass without modification
- [ ] `pnpm --filter @delivery/simulation test` passes (all existing tests green)
- [ ] `pnpm typecheck` passes

#### Subtasks

- [ ] Remove `const AVG_SPEED_MS = 88_000 / 3600` (line 4) from `packages/simulation/src/hos.ts`
- [ ] Add `export type SpeedEdge = { distStart: number; distEnd: number; duration: number }` after the import line in `packages/simulation/src/hos.ts`
- [ ] Add `const COALESCE_TOLERANCE_MS = 8_000 / 3600` (private) in `packages/simulation/src/hos.ts`
- [ ] Add `const MAX_SPEED_BANDS = 500` (private) in `packages/simulation/src/hos.ts`
- [ ] Add private `function coalesce(edges: SpeedEdge[], tolerance: number): SpeedEdge[]` implementing harmonic-style merge in `packages/simulation/src/hos.ts`
- [ ] Add `export function flatSpeedProfile(totalDistance: number, speedMs = 88_000 / 3600): SpeedEdge[]` returning `[{ distStart: 0, distEnd: totalDistance, duration: totalDistance / speedMs }]` in `packages/simulation/src/hos.ts`
- [ ] Add `export function buildSpeedProfile(...)` in `packages/simulation/src/hos.ts`:
  - Phase 1: loop over each leg, validate `leg.annotation?.duration && leg.annotation?.distance` or throw with leg index; flatten edge arrays using cumulative distance; skip `duration <= 0 || distance <= 0` edges
  - After Phase 1: `if (raw.length === 0) throw new Error('No valid annotation edges found in route response')`
  - Phase 2: `let tolerance = COALESCE_TOLERANCE_MS; let bands = coalesce(raw, tolerance); while (bands.length > MAX_SPEED_BANDS) { tolerance *= 1.5; bands = coalesce(raw, tolerance) }`
  - Phase 3: `bands[bands.length - 1]!.distEnd = totalDistance; return bands`
- [ ] Refactor `makeDriving` in `packages/simulation/src/hos.ts` to accept `profile: SpeedEdge[]` and return `DrivingSegment[]`:
  - Init `cursor = profile.findIndex(e => e.distEnd > distStart); if (cursor === -1) cursor = profile.length - 1`
  - While loop with `if (cursor >= profile.length) break` at top
  - Full-band: `push segment, dist += bandDist, secondsLeft -= bandSeconds, cursor++`
  - Partial-band: `const partialDist = secondsLeft * speedMs; push segment; break`
  - Return `segments`
- [ ] Update `simulateMinimum` in `packages/simulation/src/hos.ts` to accept `profile: SpeedEdge[]` and thread it to both `makeDriving` calls:
  - d1 call: `const segs1 = makeDriving(t, dist, totalDistance, MAX_DRIVE_BEFORE_BREAK, profile); segments.push(...segs1); const last1 = segs1[segs1.length - 1]!; t = last1.tEnd; dist = last1.distEnd`
  - d2 call: `const segs2 = makeDriving(t, dist, totalDistance, Math.min(shiftDriveLeft, windowLeft), profile); segments.push(...segs2); const last2 = segs2[segs2.length - 1]!; t = last2.tEnd; dist = last2.distEnd`
- [ ] Update `buildTimeline` in `packages/simulation/src/hos.ts` to add `profile: SpeedEdge[] = flatSpeedProfile(totalDistance)` as the fourth parameter and pass `profile` to `simulateMinimum`
- [ ] Run `pnpm --filter @delivery/simulation test` and verify all 11 existing tests pass
- [ ] Run `pnpm typecheck` and verify no TypeScript errors

#### Blockers

- Step 1 must complete first for type coherence at compile time (though hos.ts does not import from mapbox.ts — the type shape is needed only in generate.ts at Step 3)

#### Risks

- **Simultaneous call-site update**: If only one `makeDriving` call site is updated, `simulateMinimum` will fail to typecheck. Both must change together. Mitigation: treat as a single atomic edit.
- **TypeScript default parameter forward reference**: `profile: SpeedEdge[] = flatSpeedProfile(totalDistance)` references `totalDistance` (parameter 2) in parameter 4's default. This is valid TypeScript — default parameters are evaluated left-to-right at call time.
- **noUncheckedIndexedAccess**: `segs1[segs1.length - 1]!` requires the non-null assertion. The `makeDriving` function always returns at least one element (the while-loop guard ensures it exits only after pushing), but TypeScript cannot prove this statically. Use `!` and add a runtime guard if needed for defensive coding.

#### Complexity: Large
#### Uncertainty Rating: Low (design is fully specified in Architecture section)
#### Integration Points: `generate.ts` (Step 3), `hos.test.ts` (Step 5)

#### Definition of Done

- [ ] `AVG_SPEED_MS` removed from module scope
- [ ] `SpeedEdge` type exported
- [ ] `flatSpeedProfile` exported with 88 km/h default
- [ ] `buildSpeedProfile` exported with per-leg validation, widening loop, last-band reconciliation
- [ ] `makeDriving` returns `DrivingSegment[]` with cursor walk
- [ ] Both call sites in `simulateMinimum` updated
- [ ] `buildTimeline` has optional `profile` param
- [ ] All 11 existing tests pass: `pnpm --filter @delivery/simulation test`
- [ ] `pnpm typecheck` passes

#### Verification

**Level:** ✅ CRITICAL - Panel of 2 Judges with Aggregated Voting
**Artifact:** `packages/simulation/src/hos.ts`
**Threshold:** 4.0/5.0

**Rubric:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Algorithm Correctness | 0.30 | `makeDriving` cursor walk produces correct `DrivingSegment[]`: `findIndex` guard, full-band vs mid-band split, `secondsLeft` tracking, `cursor++` advancement, `cursor >= profile.length` break; no off-by-one in distance accumulation |
| Type Exports & Constants | 0.20 | `SpeedEdge` type exported; `COALESCE_TOLERANCE_MS` and `MAX_SPEED_BANDS` present with correct values; `AVG_SPEED_MS` removed from module scope; `flatSpeedProfile` and `buildSpeedProfile` exported |
| buildSpeedProfile Completeness | 0.20 | Phase 1 per-leg annotation validation with leg-index error; zero-edge skip; `raw.length === 0` throw; Phase 2 widening loop; Phase 3 last-band `distEnd = totalDistance` reconciliation |
| Call Site Atomicity | 0.20 | Both `makeDriving` call sites in `simulateMinimum` updated to spread arrays; `last1`/`last2` reads correct; `buildTimeline` optional `profile` param with `flatSpeedProfile(totalDistance)` default |
| Backward Compatibility | 0.10 | All 11 existing `buildTimeline` 3-arg call sites still typecheck; existing tests pass without modification |

**Reference Pattern:** `packages/simulation/src/hos.ts`

---

### Step 3: Update generate.ts — thread legs to profile and re-export

**Model:** opus
**Agent:** opus
**Depends on:** Steps 1, 2 — both MUST complete before this step starts
**Parallel with:** Step 5 — Step 5 can start once Step 2 is done; Steps 3 and 5 MUST run in parallel once Steps 1+2 are both complete

**Goal**: Wire the new speed-profile pipeline through the trip-generation orchestrator and expose `buildTimeline` and `flatSpeedProfile` via the `./generate` subpath so that `seed-demo-trip.ts` can import them.

#### Expected Output

- `packages/simulation/src/generate.ts`: Imports `buildSpeedProfile` and `flatSpeedProfile`; destructures `legs` from `getRoute`; computes `profile`; passes `profile` to `buildTimeline`; re-exports `buildTimeline` and `flatSpeedProfile`.

#### Success Criteria

- [ ] `generate.ts` imports include `buildSpeedProfile` and `flatSpeedProfile` from `./hos.js`
- [ ] `const { polyline, totalDistance, legs } = await getRoute(...)` (legs destructured)
- [ ] `const profile = buildSpeedProfile(legs, totalDistance)` is called before `buildTimeline`
- [ ] `buildTimeline(startedAt, totalDistance, desiredArrival, profile)` is the call (4 args)
- [ ] `export { buildTimeline, flatSpeedProfile } from './hos.js'` is present
- [ ] `generateTrip` still produces a valid `Trip` object: existing API tests pass
- [ ] `pnpm typecheck` passes

#### Subtasks

- [ ] Update the import from `./hos.js` in `packages/simulation/src/generate.ts` to add `buildSpeedProfile` and `flatSpeedProfile`
- [ ] Change `const { polyline, totalDistance } = await getRoute(...)` to `const { polyline, totalDistance, legs } = await getRoute(...)` in `packages/simulation/src/generate.ts`
- [ ] Add `const profile = buildSpeedProfile(legs, totalDistance)` after the `getRoute` destructuring in `packages/simulation/src/generate.ts`
- [ ] Update `buildTimeline` call to `buildTimeline(startedAt, totalDistance, desiredArrival, profile)` in `packages/simulation/src/generate.ts`
- [ ] Add `export { buildTimeline, flatSpeedProfile } from './hos.js'` after the existing `export { HosError }` line in `packages/simulation/src/generate.ts`
- [ ] Run `pnpm typecheck` and verify no errors

#### Blockers

- Step 1 must complete (for `RouteResult.legs` type)
- Step 2 must complete (for `buildSpeedProfile`, `flatSpeedProfile`, updated `buildTimeline` signature)

#### Risks

- `export { buildTimeline, flatSpeedProfile }` re-exports from `./hos.js` — the `.js` extension is required by ESM + `verbatimModuleSyntax` project rules.

#### Complexity: Small
#### Uncertainty Rating: Low
#### Integration Points: `seed-demo-trip.ts` (Step 4) uses these re-exports

#### Definition of Done

- [ ] `legs` destructured from `getRoute`
- [ ] `profile` computed via `buildSpeedProfile`
- [ ] `buildTimeline` called with 4 args
- [ ] `buildTimeline` and `flatSpeedProfile` re-exported
- [ ] `pnpm typecheck` passes

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `packages/simulation/src/generate.ts`
**Threshold:** 4.0/5.0

**Rubric:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Import Completeness | 0.25 | `buildSpeedProfile` and `flatSpeedProfile` imported from `./hos.js`; ESM `.js` extension used |
| Pipeline Threading | 0.35 | `legs` destructured from `getRoute`; `profile = buildSpeedProfile(legs, totalDistance)` called; `buildTimeline` called with 4 args in correct order |
| Re-export Surface | 0.25 | `export { buildTimeline, flatSpeedProfile } from './hos.js'` present; `./hos.js` extension correct for ESM |
| Code Conventions | 0.15 | No changes outside scope; TypeScript strict-compatible; existing `HosError` export preserved |

**Reference Pattern:** `packages/simulation/src/generate.ts`

---

### Step 4: Update seed-demo-trip.ts — replace divergent implementation

**Model:** opus
**Agent:** opus
**Depends on:** Step 3
**Parallel with:** Step 5 — Step 5 runs in parallel with this step; both MUST be in flight simultaneously

**Goal**: Delete the private `buildTimeline` copy and `AVG_SPEED_MS` constant; import canonical functions from `@delivery/simulation/generate`; use the HosError-probe pattern to obtain `minArrival` and produce a zero-slack demo timeline identical in structure to the legacy output.

#### Expected Output

- `apps/api/src/scripts/seed-demo-trip.ts`: Private `buildTimeline` function (lines 31–67) deleted; `AVG_SPEED_MS` constant (line 13) deleted; `import { buildTimeline, flatSpeedProfile, HosError } from '@delivery/simulation/generate'` added; lines 127–129 replaced with HosError-probe + zero-slack `buildTimeline` call.

#### Success Criteria

- [ ] No `const AVG_SPEED_MS` in `apps/api/src/scripts/seed-demo-trip.ts`
- [ ] No private `function buildTimeline` in `apps/api/src/scripts/seed-demo-trip.ts`
- [ ] `import { buildTimeline, flatSpeedProfile, HosError } from '@delivery/simulation/generate'` present
- [ ] HosError-probe pattern present: try `buildTimeline(startedAt, totalDistance, startedAt, flatSpeedProfile(totalDistance))`, catch `HosError` to extract `e.minimumArrival`
- [ ] Second call: `buildTimeline(startedAt, totalDistance, minArrival, flatSpeedProfile(totalDistance))` to produce zero-slack timeline
- [ ] `const desiredArrival = new Date(minArrival * 1000)` used for DB insert
- [ ] `pnpm typecheck` passes

#### Subtasks

- [ ] Remove `const AVG_SPEED_MS = 88_000 / 3600` (line 13) from `apps/api/src/scripts/seed-demo-trip.ts`
- [ ] Delete the private `function buildTimeline(startedAt: number, totalDistance: number): Segment[]` function body (lines 31–67) from `apps/api/src/scripts/seed-demo-trip.ts`
- [ ] Add `import { buildTimeline, flatSpeedProfile, HosError } from '@delivery/simulation/generate'` to `apps/api/src/scripts/seed-demo-trip.ts`
- [ ] Replace `const timeline = buildTimeline(startedAt, totalDistance)` and `const desiredArrival = new Date(...)` with the HosError-probe pattern in `apps/api/src/scripts/seed-demo-trip.ts`:
  ```
  let minArrival: number
  try {
    buildTimeline(startedAt, totalDistance, startedAt, flatSpeedProfile(totalDistance))
    throw new Error('unreachable')
  } catch (e) {
    if (e instanceof HosError) { minArrival = e.minimumArrival }
    else throw e
  }
  const timeline = buildTimeline(startedAt, totalDistance, minArrival, flatSpeedProfile(totalDistance))
  const desiredArrival = new Date(minArrival * 1000)
  ```
- [ ] Verify `import type { Segment } from '@delivery/schemas'` is still present (needed for `timeline` type annotation if used)
- [ ] Run `pnpm typecheck` and verify no errors

#### Blockers

- Step 2 must complete (for `buildTimeline`, `flatSpeedProfile`, `HosError`)
- Step 3 must complete (for re-exports via `@delivery/simulation/generate`)

#### Risks

- The HosError-probe relies on `buildTimeline(startedAt, totalDistance, startedAt, ...)` always throwing `HosError` (passing the trip start time as desired arrival is always unreachable). This is guaranteed by the HOS math for any non-zero `totalDistance`.
- The `import type { Segment }` import — if it is only used as a type annotation (not a value), `verbatimModuleSyntax` requires the `import type` form. Verify the existing import form is preserved correctly.

#### Complexity: Small
#### Uncertainty Rating: Low
#### Integration Points: None (script only; not imported by other modules)

#### Definition of Done

- [ ] Private `buildTimeline` deleted
- [ ] `AVG_SPEED_MS` deleted
- [ ] Canonical imports added
- [ ] HosError-probe pattern implemented
- [ ] Zero-slack `buildTimeline` call with `flatSpeedProfile`
- [ ] `pnpm typecheck` passes

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `apps/api/src/scripts/seed-demo-trip.ts`
**Threshold:** 4.0/5.0

**Rubric:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Deletion Completeness | 0.25 | Private `buildTimeline` function body fully deleted; `AVG_SPEED_MS` constant deleted; no orphaned dead code |
| Import Correctness | 0.20 | `import { buildTimeline, flatSpeedProfile, HosError } from '@delivery/simulation/generate'`; existing `import type { Segment }` preserved if used |
| HosError-Probe Pattern | 0.35 | try-block uses `buildTimeline(startedAt, totalDistance, startedAt, flatSpeedProfile(totalDistance))`; catch narrows to `HosError`; non-HosError re-thrown; `minArrival = e.minimumArrival` assigned; second call uses `minArrival` |
| Zero-Slack Preservation | 0.15 | `desiredArrival = new Date(minArrival * 1000)` for DB insert; timeline is zero-slack by construction |
| TypeScript Compliance | 0.05 | `pnpm typecheck` passes; `verbatimModuleSyntax` satisfied; no uninitialized variable errors |

**Reference Pattern:** `apps/api/src/scripts/seed-demo-trip.ts`

---

### Step 5: Add new tests in hos.test.ts

**Model:** opus
**Agent:** sdd:qa-engineer
**Depends on:** Step 2
**Parallel with:** Steps 3, 4 — Step 5 MUST be launched as soon as Step 2 completes, running in parallel with Step 3 and subsequently Step 4

**Goal**: Cover all acceptance-criteria invariants for the new speed-profile pipeline with ~16 new test cases. All 11 existing tests pass unmodified.

#### Expected Output

- `packages/simulation/src/hos.test.ts`: `buildSpeedProfile` and `flatSpeedProfile` added to imports; ~16 new test cases in new `describe` blocks covering all invariants.

#### Success Criteria

- [ ] `buildSpeedProfile` and `flatSpeedProfile` imported from `./hos.js` in test file
- [ ] All 11 existing `buildTimeline` tests still pass without modification
- [ ] Test: `buildSpeedProfile` constructs a profile where first band starts at 0 and last band ends at `totalDistance`
- [ ] Test: `buildSpeedProfile` skips edges with `duration <= 0`
- [ ] Test: `buildSpeedProfile` skips edges with `distance <= 0`
- [ ] Test: `buildSpeedProfile` coalesces two adjacent bands within 8 km/h tolerance into one band
- [ ] Test: `buildSpeedProfile` does not coalesce two adjacent bands whose implied speeds differ by more than 8 km/h
- [ ] Test: `buildSpeedProfile` produces at most `MAX_SPEED_BANDS` bands when given a route exceeding the cap after initial coalescing
- [ ] Test: `buildSpeedProfile` throws a descriptive error when all annotation edges have `duration <= 0` or `distance <= 0`
- [ ] Test: `buildSpeedProfile` throws a descriptive error identifying the leg index when a leg is missing annotation arrays
- [ ] Test: `flatSpeedProfile(totalDistance)` returns a single `SpeedEdge` with `distStart=0`, `distEnd=totalDistance`, and implied speed `(distEnd-distStart)/duration` equal to `88_000/3600 m/s`
- [ ] Test: `makeDriving` cursor walk with 2-band profile where HOS cap falls 30 km into the second band: result has two driving segments covering 0–100 km and 100–130 km, and the sum of their durations equals the cap
- [ ] Test: cursor reaching `profile.length` after last band does not crash; last driving segment `distEnd == totalDistance`
- [ ] Test: temporal contiguity — `tStart[i] == tEnd[i-1]` for every adjacent pair across a full multi-band timeline (use `buildTimeline` with an explicit 2-band profile)
- [ ] Test: all driving segments have monotonically non-decreasing `distEnd` values across a full timeline
- [ ] Test: all segments in a timeline generated with variable-speed profile pass `SegmentSchema.parse()` without errors
- [ ] Test: `distributeSlack` does not alter `distStart` or `distEnd` of any driving segment before vs after distribution
- [ ] Test: `buildTimeline` with `flatSpeedProfile(totalDistance)` produces output identical to pre-refactor 3-arg call (regression guard — segment types in same order, same rest reasons, `tEnd` within 1 ms)
- [ ] `pnpm --filter @delivery/simulation test` passes with all tests green

#### Subtasks

- [ ] Add `buildSpeedProfile`, `flatSpeedProfile` to the import from `./hos.js` in `packages/simulation/src/hos.test.ts`
- [ ] Add `SegmentSchema` import from `@delivery/schemas` in `packages/simulation/src/hos.test.ts`
- [ ] Add `describe('buildSpeedProfile', ...)` block with the following tests in `packages/simulation/src/hos.test.ts`:
  - `it('constructs profile from two-leg annotation arrays with correct boundaries', ...)`
  - `it('skips edges with duration <= 0', ...)`
  - `it('skips edges with distance <= 0', ...)`
  - `it('coalesces adjacent bands within 8 km/h tolerance', ...)`
  - `it('does not coalesce bands exceeding 8 km/h tolerance', ...)`
  - `it('applies widening tolerance to cap band count at MAX_SPEED_BANDS', ...)`
  - `it('throws descriptive error when all edges are invalid', ...)`
  - `it('throws descriptive error identifying leg index when annotation is missing', ...)`
- [ ] Add `describe('flatSpeedProfile', ...)` block with the following test in `packages/simulation/src/hos.test.ts`:
  - `it('returns single edge at 88 km/h implied speed', ...)`
- [ ] Add `describe('makeDriving cursor walk', ...)` block with the following tests in `packages/simulation/src/hos.test.ts`:
  - `it('emits two driving segments with exact mid-band split at HOS cap', ...)` — uses 2-band profile (0–100 km, 100–200 km), cap at 30 km into band 2
  - `it('cursor reaching profile end does not crash; last distEnd equals totalDistance', ...)`
- [ ] Add `describe('timeline invariants with variable-speed profile', ...)` block in `packages/simulation/src/hos.test.ts`:
  - `it('temporal contiguity: tStart[i] == tEnd[i-1] across all segments', ...)`
  - `it('monotonically non-decreasing distEnd across driving segments', ...)`
  - `it('all segments pass SegmentSchema validation', ...)`
  - `it('distributeSlack does not alter driving segment distances', ...)`
  - `it('buildTimeline with flatSpeedProfile regression: same output as pre-refactor 3-arg call', ...)`
- [ ] Run `pnpm --filter @delivery/simulation test` and verify all tests pass

#### Blockers

- Step 2 must complete (`buildSpeedProfile`, `flatSpeedProfile`, `SpeedEdge` type, updated `buildTimeline`)

#### Risks

- **`SegmentSchema` import**: Verify the schema export name and import path from `@delivery/schemas`. The project rule states `@delivery/schemas` is the shared Zod contract package.
- **`noUncheckedIndexedAccess`**: Array index access in tests (`segs[0]!`) requires non-null assertions. Use `!` consistently or `expect(segs[0]).toBeDefined()` guards.

#### Complexity: Medium
#### Uncertainty Rating: Low
#### Integration Points: None (test file; not imported by production code)

#### Definition of Done

- [ ] All 11 existing tests still pass
- [ ] All ~16 new tests pass
- [ ] `pnpm --filter @delivery/simulation test` is green
- [ ] All acceptance criteria that map to tests are covered

#### Verification

**Level:** ✅ Per-Describe-Block Judges (5 separate evaluations in parallel)
**Artifacts:** `packages/simulation/src/hos.test.ts` — evaluated per describe block: `describe('buildSpeedProfile')`, `describe('flatSpeedProfile')`, `describe('makeDriving cursor walk')`, `describe('timeline invariants with variable-speed profile')`, and the existing-11-tests regression guard
**Threshold:** 4.0/5.0

**Rubric (per describe block):**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Invariant Coverage | 0.30 | Each test case covers the specific acceptance criterion it targets; no test is a trivially passing no-op |
| Assertion Quality | 0.25 | Assertions use specific matchers (`.toEqual`, `.toThrow(/message/)`); numeric assertions include tolerances where appropriate (within 1 ms, within 1 m) |
| Test Isolation | 0.20 | Tests construct their own inputs (no shared mutable state); no dependency on external services or file system |
| Edge Case Handling | 0.15 | Error-path tests use `expect(() => ...).toThrow()` with message matching; boundary conditions explicitly tested |
| noUncheckedIndexedAccess Compliance | 0.10 | Array accesses use `!` non-null assertions or `.toBeDefined()` guards; no raw `arr[0]` without assertion |

**Reference Pattern:** `packages/simulation/src/hos.test.ts`

---

### Step 6: Add release notes

**Model:** opus
**Agent:** sdd:tech-writer
**Depends on:** Step 5 — all tests MUST be green before release notes are written
**Parallel with:** None

**Goal**: Document the behavioral change for downstream clients using flat-speed estimation.

#### Expected Output

- `docs/release-notes/variable-road-speeds.md` (new file): Covers HosError regression risk, client migration path, and DrivingSegment count change.

#### Success Criteria

- [ ] `docs/release-notes/variable-road-speeds.md` exists
- [ ] Documents that real `mapbox/driving` speeds on city-heavy US routes are typically slower than 88 km/h, causing `minArrival` to be later and triggering more `HosError 422` responses
- [ ] Documents that clients computing `desiredArrival = startedAt + (distance / (88_000/3600)) + padding` must switch to using the Mapbox `duration` field directly
- [ ] Documents that `DrivingSegment` count is no longer an indicator of shift count (now 40–80 segments per shift instead of 2–6)
- [ ] Documents that existing trips are unaffected (no backfill; old flat-88 timelines remain valid)

#### Subtasks

- [ ] Create `docs/release-notes/variable-road-speeds.md` with sections: Summary, Breaking Change Detail, Client Migration, Unchanged Behavior
- [ ] Write Summary: variable road speeds from Mapbox annotations replace flat 88 km/h constant; new trips only
- [ ] Write Breaking Change Detail: city-heavy routes have lower real speeds → later minimum arrival → more 422s from clients using `dist/88+padding`
- [ ] Write Client Migration: use `routeResult.duration` (Mapbox total route duration) as the basis for `desiredArrival` rather than computing from distance and fixed speed
- [ ] Write Unchanged Behavior: existing trips unmodified; `Segment`/`Trip` schema unchanged; share pages render without modification; interpolation unchanged

#### Blockers

- Step 5 must complete (all tests green before documenting the change as ready)

#### Risks

- None for documentation step

#### Complexity: Small
#### Uncertainty Rating: Low
#### Integration Points: None

#### Definition of Done

- [ ] `docs/release-notes/variable-road-speeds.md` created
- [ ] All four content areas covered
- [ ] No emojis (project convention)

#### Verification

**Level:** ✅ Single Judge
**Artifact:** `docs/release-notes/variable-road-speeds.md`
**Threshold:** 4.0/5.0

**Rubric:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Breaking Change Accuracy | 0.30 | Correctly describes that real `mapbox/driving` speeds on city-heavy US routes are slower than 88 km/h, causing later `minArrival` and more 422 HosError responses; no technically incorrect claims |
| Client Migration Path | 0.25 | Documents switching from `dist/(88_000/3600)+padding` to `routeResult.duration` as the basis for `desiredArrival`; actionable and specific |
| Unchanged Behavior Clarity | 0.20 | Explicitly states existing trips unaffected (no backfill), `Segment`/`Trip` schema unchanged, share pages render without modification |
| DrivingSegment Count Change | 0.15 | Notes that `DrivingSegment` count is no longer an indicator of shift count (now 40-80 per trip vs 2-6) |
| Conciseness & Conventions | 0.10 | No emojis (project convention); sections match requested structure (Summary, Breaking Change Detail, Client Migration, Unchanged Behavior) |

---

## Implementation Summary

| Step | Goal | Output | Est. Effort |
|------|------|--------|-------------|
| 1 | Annotation fetch + RouteResult.legs type | `mapbox.ts` | Small |
| 2 | SpeedEdge, buildSpeedProfile, flatSpeedProfile, makeDriving[], simulateMinimum, buildTimeline | `hos.ts` | Large |
| 3 | Thread legs→profile; re-export buildTimeline + flatSpeedProfile | `generate.ts` | Small |
| 4 | Replace divergent seed implementation | `seed-demo-trip.ts` | Small |
| 5 | ~16 new test cases; 11 existing unmodified | `hos.test.ts` | Medium |
| 6 | Release notes for regression risk + client migration | `docs/release-notes/variable-road-speeds.md` | Small |

**Total Steps**: 6
**Critical Path**: Steps 1, 2 → Step 3 → Step 4 → Step 5 → Step 6
**Parallel Opportunities**: Steps 1 and 2 can begin in parallel (mapbox.ts and hos.ts have no import dependency on each other; hos.ts only needs the type shape of `legs`, which is defined independently). Within Step 5, individual `describe` blocks can be written concurrently.

---

---

## Verification Summary

| Step | Verification Level | Judges | Threshold | Artifacts |
|------|-------------------|--------|-----------|-----------|
| 1 | ✅ Single Judge | 1 | 4.0/5.0 | `packages/simulation/src/mapbox.ts` |
| 2 | ✅ Panel (2) | 2 | 4.0/5.0 | `packages/simulation/src/hos.ts` |
| 3 | ✅ Single Judge | 1 | 4.0/5.0 | `packages/simulation/src/generate.ts` |
| 4 | ✅ Single Judge | 1 | 4.0/5.0 | `apps/api/src/scripts/seed-demo-trip.ts` |
| 5 | ✅ Per-Describe-Block | 5 | 4.0/5.0 | `packages/simulation/src/hos.test.ts` (5 describe blocks) |
| 6 | ✅ Single Judge | 1 | 4.0/5.0 | `docs/release-notes/variable-road-speeds.md` |

**Total Evaluations:** 11
**Implementation Command:** `/implement .specs/tasks/draft/implement-variable-road-speeds-hos.feature.md`

---

## Risks & Blockers Summary

### High Priority

| Risk/Blocker | Impact | Likelihood | Mitigation |
|--------------|--------|------------|------------|
| Both `makeDriving` call sites in `simulateMinimum` must update simultaneously | High — type error if partial | High (easy to miss) | Treat entire hos.ts refactor as one atomic commit; typecheck after every save |
| `makeDriving` returns empty array if called with `distStart >= totalDistance` | High — `last1.tEnd` crashes | Low | Guard: while-loop condition `dist < totalDistance - 0.01` prevents reaching this state; add defensive check in tests |
| Float drift: `Σannotation.distance != routes[0].distance` causes simulation loop to never terminate | High — infinite loop | Medium (real routes) | Last-band reconciliation `bands[last].distEnd = totalDistance` is mandatory; covered in acceptance criteria |
| `flatSpeedProfile` default parameter form must reference `totalDistance` from parameter 2 | Medium — TypeScript compilation | Low | Valid TypeScript; default params evaluated left-to-right; already confirmed in architecture scratchpad |
| Real `mapbox/driving` speeds on city routes produce more 422 HosErrors | Medium — API clients break | High (behavior change) | Release notes (Step 6) direct clients to use Mapbox `duration` field |

### Medium Priority

| Risk/Blocker | Impact | Likelihood | Mitigation |
|--------------|--------|------------|------------|
| Cursor bounds guard omitted (`if (cursor >= profile.length) break`) | Medium — crash on long routes | Medium | Explicit subtask; covered by cursor bounds test in Step 5 |
| Annotation key rename in Mapbox v6 (`annotation` → `annotations`) | Medium — silent undefined reads | Low (API pinned to v5) | Add code comment; covered in SKILL.md pitfall table |
| `noUncheckedIndexedAccess` requires `!` on array element reads | Low — compile error | Medium | Use `segs1[segs1.length - 1]!` consistently; TypeScript will catch at compile time |

---

## Definition of Done (Task Level)

- [ ] All 6 implementation steps completed
- [ ] All acceptance criteria verified (functional and non-functional)
- [ ] All 11 existing `buildTimeline` tests pass without modification
- [ ] All ~16 new tests pass: `pnpm --filter @delivery/simulation test`
- [ ] No TypeScript errors: `pnpm typecheck`
- [ ] No lint errors: `pnpm lint`
- [ ] Release notes document created at `docs/release-notes/variable-road-speeds.md`
- [ ] No existing trip data affected (schema unchanged, no backfill)
- [ ] Code reviewed
- [ ] All high-priority risks addressed
