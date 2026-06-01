---
id: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01
hypothesis_id: sleep-cap-tail-wait-block
source: codebase-analysis
CL: 3
R: 0.92
created: 2026-06-01T00:00:00Z
expires: 2026-12-01T00:00:00Z
---

# Evidence: Codebase Analysis — Sleep Cap + Tail Wait Block

## Methodology

1. Read `packages/simulation/src/hos.ts` to confirm current `distributeSlack` implementation and the absence of any sleep upper bound.
2. Read `packages/schemas/src/trip.ts` to verify `RestSegmentSchema` already includes `'wait'` in its reason enum.
3. Read `packages/simulation/src/interpolate.ts` to confirm `wait` rest segments are handled by the generic rest branch without special-casing.
4. Read `packages/simulation/src/hos.test.ts` to verify the existing test at line 114 asserts `tEnd == desiredArrival` and that tests exercise the multi-sleep slack path.
5. Executed arithmetic verification scripts to confirm: (a) the bug produces 84h sleep, (b) the two-phase fix caps sleep at 14h and routes remainder to a tail wait, (c) `absorbable + leftover === slack` holds for all edge cases, (d) `tEnd == desiredArrival` invariant is algebraically preserved.

## Results

- **Bug confirmed**: Current `distributeSlack` at `hos.ts:92–105` has no upper bound on sleep extension. With 1 sleep segment and 74h slack, sleep grows to 84h. With 2 sleep segments and 100h slack, each sleep grows to 60h. Both are biologically absurd.
- **`'wait'` already in schema**: `RestSegmentSchema.reason` at `trip.ts:46` is `z.enum(['sleep', 'break', 'fuel', 'wait'])`. No schema change needed.
- **`interpolate.ts` handles `wait` generically**: The `interpolatePosition` function at `interpolate.ts:36–43` branches on `segment.type === 'driving'`; any rest segment (including `wait`) falls through to `atDistance(trip, segment, segment.atDist, ...)`. A tail `wait` segment with `atDist = totalDistance` yields `progress = 1.0`, correctly rendering the driver as stationary at the destination.
- **Arithmetic verified (node scripts)**:
  - Single sleep, 74h slack: Phase A absorbs 4h (headroom), leftover = 70h tail wait. Sleep = 14h.
  - Two sleeps, 100h slack: Phase A absorbs 8h total (4h each), leftover = 92h tail wait. Each sleep = 14h.
  - All cases: `absorbable + leftover === slack` is true — `tEnd == desiredArrival` invariant holds by construction.
  - Edge cases (slack = 0, sleepCount = 0) remain guarded by the existing early-return branch.
- **Existing test coverage**: `hos.test.ts:114` already asserts `withSlack[last].tEnd ≈ lastMin + extraSlack`. The hypothesis adds three new tests for the capped scenario; the arithmetic guarantees they will pass once the fix is applied.
- **Segment contiguity**: The tail wait block is appended with `tStart = lastSegment.tEnd`, preserving the contiguity invariant.
- **No DAG impact**: `packages/schemas` is untouched; `simulation` → `apps/api`/`apps/web` dependency order is unchanged.

## Interpretation

- The hypothesis correctly identifies the root cause (unbounded sleep growth), the correct cap value (14h FMCSA extended-rest ceiling), and the correct placement for leftover slack (single tail wait block after the last segment).
- All key assumptions stated in the hypothesis are verified against the actual codebase: schema readiness, interpolate.ts compatibility, algebraic correctness of `tEnd` invariant, contiguity preservation.
- The implementation risk is accurately characterized as conservative: single-file change, no schema migration, no downstream breakage.
- The only unverified claim is that the new tests "pass" — they cannot pass until the code is actually changed, which is not within the scope of this validation. However, the arithmetic guarantees they will pass once the fix is applied.

## Source References

- `packages/simulation/src/hos.ts`: `distributeSlack` function at lines 91–105 (bug location and fix target)
- `packages/schemas/src/trip.ts`: `RestSegmentSchema` at line 41–48 (`'wait'` enum member confirmed at line 46)
- `packages/simulation/src/interpolate.ts`: `interpolatePosition` at lines 21–44 (generic rest handling confirmed)
- `packages/simulation/src/hos.test.ts`: existing `tEnd` assertion at line 114
