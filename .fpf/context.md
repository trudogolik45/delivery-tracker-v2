# Bounded Context

## Problem Framing

### Anomaly

The HOS (Hours of Service) driver simulation algorithm in `packages/simulation/src/hos.ts`
allows a driver's `sleep` segment duration to grow without any upper bound when the user
supplies a `desiredArrival` far in the future. The function `distributeSlack` (L91-105)
spreads all available time buffer exclusively across `sleep` segments proportionally,
meaning a generous `desiredArrival` can produce a single sleep of 30, 84, or arbitrarily
many hours — biologically impossible and visually absurd on the share page.

The `RestSegmentSchema` already defines a `'wait'` reason alongside `'sleep'` / `'break'`
/ `'fuel'`, but no code path ever creates a `wait` segment. Semantic idle/waiting time
that should be modelled as a stop is being silently collapsed into sleep.

The current branch `fix/hos-sleep-duration-cap` and `draft_fix.md` document a specific
three-layer proposed fix. No code has been written yet — only the analysis draft exists.
`INCIDENT.md` is actually browser tile-fetch errors (maplibre certificate issue) and is
unrelated to HOS; it does not describe a production HOS incident.

### Decision Type

Implementation choice — how to refactor `distributeSlack` in `hos.ts` to:
1. Cap per-sleep duration at a biologically realistic maximum.
2. Emit surplus slack as a `rest` segment with `reason: 'wait'`.
3. Optionally add upstream input validation on `desiredArrival` window.
4. Keep the existing segment-contract and timeline invariants intact.

### Stakeholder Concerns

- **Correctness / realism**: Driver position shown on the share page must look plausible.
  A 30+ hour sleep makes the tracker useless and erodes user trust.
- **Schema backward compatibility**: `trips.timeline` is stored as JSONB; existing saved
  trips must not be invalidated (fix applies only to newly generated trips).
- **Test coverage**: The current test suite (`hos.test.ts`) does not assert an upper bound
  on sleep duration; the bug is untested. Any fix must be backed by regression tests.
- **Invariants preserved**: Final `tEnd` of the timeline must equal `desiredArrival`
  (invariant verified in the existing test at `hos.test.ts:114`).
- **Simplicity**: The simulation is explicitly "simplified" (no rolling 60/70h window,
  constant 88 km/h speed). Solutions should preserve that simplicity philosophy.

---

## Vocabulary

- **HOS (Hours of Service)**: US FMCSA rules governing commercial driver duty limits.
  In this codebase it is a *simplified model* — no rolling 60/70h window, constant speed.
- **`buildTimeline(startedAt, totalDistance, desiredArrival)`**: Public entry point in
  `hos.ts`. Returns an ordered array of `Segment[]` that covers the full trip from
  `startedAt` to `desiredArrival`. Throws `HosError` if arrival is unreachable.
- **`simulateMinimum(startedAt, totalDistance)`**: Internal function that builds the
  fastest-possible segment array (minimum slack). This is always called first.
- **`distributeSlack(segments, slack)`**: Internal function that stretches sleep segments
  to consume surplus time so the final `tEnd` equals `desiredArrival`. The bug lives here.
- **slack**: `desiredArrival − minArrival` — the difference between the user-requested
  arrival time and the earliest possible arrival time. Can be arbitrarily large.
- **sleep segment**: `RestSegment` with `reason: 'sleep'`. Represents the mandatory
  10-hour rest between driving shifts (`SLEEP_DURATION = 10 * 3600`).
- **break segment**: `RestSegment` with `reason: 'break'`. 30-minute mandatory break
  after 8 hours of continuous driving.
- **wait segment**: `RestSegment` with `reason: 'wait'`. Schema-defined but never
  currently emitted. Intended to represent idle/buffer time at a stop.
- **`SLEEP_DURATION`**: Constant `10 * 3600` (10 hours) — baseline mandated rest.
- **`SLEEP_DURATION_MAX`**: Proposed new constant (12 or 14 hours) — the cap beyond
  which a sleep segment should not grow. Value not yet decided.
- **headroom**: The extra time a single sleep segment can absorb:
  `SLEEP_DURATION_MAX − SLEEP_DURATION`. At 14h cap = 4 hours per sleep.
- **leftover slack**: Slack that cannot be absorbed by sleep segments after each is
  filled to `SLEEP_DURATION_MAX`. Must be placed in a `wait` segment.
- **precomputed timeline**: The ADR-0002 architectural decision — a trip's full
  position schedule is computed once at creation and stored in `trips.timeline` JSONB.
  Client-side `interpolate.ts` uses it without hitting the server.
- **contiguous segments**: Each segment's `tStart` equals the previous segment's `tEnd`
  (no gaps, no overlaps). This invariant is tested and must be preserved.
- **`desiredArrival`**: Unix timestamp (integer seconds) supplied by the admin when
  creating or previewing a trip. Currently validated only as `int().positive()` in
  `GenerateTripInputSchema` / `TripPreviewInputSchema` — no upper-bound check.

---

## Invariants

1. The final segment's `tEnd` must equal `desiredArrival` exactly (within float
   rounding tolerance). Verified by test at `hos.test.ts:114`.
2. Segments must be contiguous: `segments[i].tStart === segments[i-1].tEnd` for all `i`.
   Verified by test at `hos.test.ts:71`.
3. `buildTimeline` must throw `HosError` when `minArrival > desiredArrival`. Verified
   by test at `hos.test.ts:79-92`.
4. No driving segment may exceed `MAX_DRIVE_BEFORE_BREAK` (8h) without an intervening
   break, and no shift may exceed `MAX_DRIVE_PER_SHIFT` (11h total). This is enforced
   by `simulateMinimum`; `distributeSlack` must not modify driving segments.
5. `distributeSlack` must only extend rest segments, never driving segments.
6. The `Segment` type is a discriminated union from `@delivery/schemas`; all produced
   segments must be valid against `SegmentSchema` (validated on save via Drizzle/API).
7. Any fix must not alter existing stored `trips.timeline` rows — backward compatibility
   via no-migration policy; fix applies only to newly generated trips.
8. The `packages/simulation` package DAG dependency must be respected:
   `schemas → simulation → apps/*`. No imports from `apps/*` into `packages/*`.

---

## Scope

### In Scope

- `packages/simulation/src/hos.ts` — `distributeSlack` refactor to add sleep cap and
  emit `wait` segments for leftover slack.
- `packages/simulation/src/hos.test.ts` — new regression tests:
  - Assert each sleep `<= SLEEP_DURATION_MAX`.
  - Large slack produces a `wait` segment and sleeps stay under cap.
  - `tEnd == desiredArrival` preserved.
- `packages/schemas/src/trip.ts` — optional: upper-bound `refine` on
  `GenerateTripInputSchema` / `TripPreviewInputSchema` `desiredArrival` window.
- Deciding the value of `SLEEP_DURATION_MAX` (12h vs 14h).
- Deciding placement strategy for the `wait` segment (tail block vs distributed).
- Adding a dev-time invariant assertion after `distributeSlack` returns.

### Out of Scope

- Implementing the FMCSA rolling 60/70h window (explicitly deferred per ADR-0002).
- GPS-based real-time tracking (explicitly rejected per ADR-0002).
- Migrating existing stored timelines with over-long sleeps (no backfill per draft_fix.md).
- Changes to `interpolate.ts` — the interpolation function consumes whatever segments
  `buildTimeline` produces; it does not need changes for this fix.
- Changes to `mapbox.ts` / `getRoute` — route data feeding is unrelated to the bug.
- The unrelated maplibre tile-fetch TLS errors visible in `INCIDENT.md` (different issue).
- Multi-driver or multi-vehicle scheduling optimisation.
- `apps/api` route logic beyond what is needed to validate the `desiredArrival` input.

---

## Context Sources

- `packages/simulation/src/hos.ts` — full source of `buildTimeline`, `simulateMinimum`,
  `distributeSlack`; constants `SLEEP_DURATION`, `MAX_DRIVE_*`, `BREAK_DURATION`.
- `packages/simulation/src/hos.test.ts` — five existing test cases; the slack-distribution
  test only checks the lower bound on sleep, not the upper bound.
- `packages/simulation/src/generate.ts` — calls `buildTimeline` after `getRoute`; passes
  floored `startedAt` and `desiredArrival` from user input.
- `packages/schemas/src/trip.ts` — `RestSegmentSchema` with `reason: z.enum(['sleep',
  'break', 'fuel', 'wait'])`. `GenerateTripInputSchema` and `TripPreviewInputSchema`
  validate `desiredArrival` as `int().positive()` only (no upper bound).
- `draft_fix.md` — detailed analysis of root cause, proposed three-layer approach
  (`distributeSlack` cap, input validation, tests), open questions on constant values
  and `wait` placement strategy.
- `docs/adr/0002-precomputed-trip-timeline.md` — architectural rationale for the
  compute-once timeline model; explicitly acknowledges simplified HOS and average speed.
- `apps/api/src/scripts/seed-demo-trip.ts` — uses `buildTimeline` with minimum slack
  (desiredArrival = minArrival); fix will not affect demo seed.
