---
id: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01
hypothesis_id: sleep-cap-12h-distributed-wait
source: internal-test
CL: 3
R: 0.92
created: 2026-06-01T00:00:00Z
expires: 2026-12-01T00:00:00Z
---

# Evidence: Fill-Then-Spill Algorithm Validation — Direct Simulation Test

## Methodology

1. Read the full source of `packages/simulation/src/hos.ts` (the target file), `packages/schemas/src/trip.ts` (schema), and `packages/simulation/src/interpolate.ts` (downstream consumer).
2. Implemented the exact fill-then-spill algorithm described in the hypothesis (`SLEEP_DURATION_MAX = 12 * 3600`; extend sleeps first, then insert per-sleep wait segments).
3. Constructed a realistic 2-sleep test fixture using the actual `simulateMinimum` logic (30 hours of driving distance → 2 shifts → 2 sleep segments).
4. Executed 5 test groups in Node.js directly against the proposed algorithm logic.

## Results

All 5 test groups passed with zero failures:

- **Test 1 — Moderate slack (within headroom):** no wait segments emitted, all sleeps ≤ 12h, `tEnd == desiredArrival` (diff = 0.0000s), segments contiguous.
- **Test 2 — Large slack (exceeds headroom):** exactly 2 wait segments (one per sleep), all sleeps == 12h exactly, `tEnd == desiredArrival` (diff = 0.0000s), segments contiguous.
- **Test 3 — Arithmetic invariant:** `totalHeadroom + leftover == slack` holds exactly (43200.00 == 43200.00).
- **Test 4 — Wait placement:** each sleep segment is immediately followed by a wait segment.
- **Test 5 — `interpolate.ts` compatibility:** `'wait'` is a valid enum member in `RestSegmentSchema.reason`; `findSegmentAt` binary search is index-agnostic; rest-segment branch uses `atDist` regardless of `reason`, so wait segments with `atDist` reusing the preceding sleep's location are handled correctly.

## Interpretation

- The fill-then-spill arithmetic is correct: distributing headroom first across sleeps, then routing excess as per-sleep wait segments, guarantees `sum_of_extensions == slack` exactly, preserving the `tEnd == desiredArrival` invariant.
- The shift-accumulator approach (as described in the hypothesis) maintains contiguous segments throughout insertion.
- The 12h cap is valid: `RestSegmentSchema` already accepts `'wait'` as a reason; no schema change is required.
- `interpolate.ts` requires no changes: `findSegmentAt` is a binary search over `tEnd` ordering and is agnostic to segment count or insertion position; the rest-segment branch dispatches on `atDist` without branching on `reason`.
- The algorithm is more complex than the current flat-distribution (`distributeSlack`) but all stated invariants (contiguity, `tEnd`, sleep cap, schema validity) hold.

## Source References

- `packages/simulation/src/hos.ts`: target file, `distributeSlack` (L91–105), constants (L4–8)
- `packages/simulation/src/hos.test.ts`: existing test suite confirming invariants and test patterns
- `packages/schemas/src/trip.ts`: `RestSegmentSchema.reason` enum at L46 confirming `'wait'` is valid
- `packages/simulation/src/interpolate.ts`: `findSegmentAt` (L46–55), rest-segment branch (L41–43) confirming iteration-agnostic consumption
- Direct simulation test executed in Node.js against proposed algorithm pseudocode
