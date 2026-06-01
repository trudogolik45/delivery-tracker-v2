---
id: sleep-cap-12h-distributed-wait
title: Cap Sleep at 12h + Distribute Wait Segments After Each Sleep
kind: system
scope: packages/simulation/src/hos.ts — distributeSlack function. Applies to newly generated trips only.
decision_context: hos-slack-distribution-strategy
depends_on: []
created: 2026-06-01T00:00:00Z
layer: L2
verified_at: 2026-06-01T00:00:00Z
validated_at: 2026-06-01T00:00:00Z
verification:
  verdict: PASS
  checks_passed:
    - internal-consistency
    - constraint-compliance
    - type-compatibility
    - first-principles
  notes: "Fill-then-spill arithmetic guarantees slack == totalHeadroom + leftover exactly; wait segments are schema-valid; contiguity is maintained by shift accumulator; all eight project invariants satisfied."
validation:
  verdict: PASS
  evidence_count: 1
  R_eff: 0.92
  weakest_link: "single internal test run (no live Vitest harness execution)"
evidence:
  - id: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01
    source: internal-test
    CL: 3
    R: 0.92
---

# Cap Sleep at 12h + Distribute Wait Segments After Each Sleep

## Method (The Recipe)

1. Add constant:
   ```ts
   const SLEEP_DURATION_MAX = 12 * 3600 // 12 h — conservative biological cap
   ```
   (2 h headroom per sleep instead of 4 h; matches typical real-world extended-rest practice.)

2. Rewrite `distributeSlack` to a per-sleep-cycle distribution strategy:
   - Compute total capacity: `totalHeadroom = sleepCount * (SLEEP_DURATION_MAX - SLEEP_DURATION)`.
   - If `slack <= totalHeadroom`: distribute evenly, no wait segments needed. Each sleep grows up to `SLEEP_DURATION + slack/sleepCount`.
   - If `slack > totalHeadroom`: saturate all sleeps to `SLEEP_DURATION_MAX`. Compute `leftoverPerSleep = (slack - totalHeadroom) / sleepCount`. Insert a `rest/wait` segment of length `leftoverPerSleep` **immediately after each sleep segment** at that segment's `atDist` position (truck is parked at same location as the preceding rest stop).

3. During the segment rebuild, shift all subsequent segment timestamps forward by the accumulated extension. Maintain the shift accumulator to guarantee contiguity.

4. The invariant `tEnd == desiredArrival` is maintained because the total extension across all inserted wait durations plus all sleep extensions equals `slack` exactly.

5. Add a post-computation assertion checking:
   - All sleep segments `<= SLEEP_DURATION_MAX`.
   - All non-driving segments have non-negative duration.
   - `segments[last].tEnd === desiredArrival` (within 1s tolerance).

6. New tests:
   - Moderate slack (fits within headroom): no wait segments emitted, sleeps within cap.
   - Large slack (exceeds headroom): a `wait` segment follows each sleep, sleeps at exactly `SLEEP_DURATION_MAX`.
   - Contiguity test on large-slack output.

## Expected Outcome

- Sleep segments never exceed 12 h, making durations plausible in a wide range of scenarios (12 h is common in over-the-road HOS patterns).
- Wait time is distributed across the route at natural stopping points (after each rest stop), giving a more realistic-looking share-page timeline — the driver is waiting at a fuel stop or rest area, not just parked at the destination.
- Multiple `wait` segments are present when `desiredArrival` is very far out, each corresponding to a real-world idle at a stop.
- All invariants preserved; existing tests pass.

## Rationale

- **Anomaly**: Same as conservative hypothesis — unbounded sleep growth in `distributeSlack`.
- **Approach**: Distributing wait segments across the route (attached to natural stop points) is more semantically truthful than piling all idle time at the tail. A driver with hours to spare before a delivery window would genuinely dwell at intermediate stops. The 12 h cap is more conservative than 14 h and covers the common pattern of a driver taking a slightly extended rest but not an improbably long one.
- **Assumptions**: `interpolate.ts` handles variable numbers of `rest` segments correctly (it iterates over segments without assuming a fixed structure). `atDist` on wait segments can reuse the same value as the preceding sleep at that stop since the truck hasn't moved.
- **Risk Level**: Moderate — the algorithm becomes more complex (variable segment count output, insertion mid-array), and the 12 h constant is a different choice from `draft_fix.md`'s suggested 14 h. Needs careful testing of contiguity through the insertion loop.

## Verification

**Verdict**: PASS
**Verified**: 2026-06-01T00:00:00Z

### Checks Performed

| Check | Result | Notes |
|-------|--------|-------|
| Internal Consistency | PASS | Fill-then-spill arithmetic: totalHeadroom + leftover == slack exactly; shift accumulator guarantees contiguity |
| Constraint Compliance | PASS | All eight invariants satisfied: tEnd==desiredArrival preserved, contiguous segments, schema-valid wait reason, no driving segments modified, backward-compatible |
| Type Compatibility | PASS | Output remains Segment[]; RestSegmentSchema already defines reason:'wait'; interpolate.ts is iteration-agnostic per context |
| First-Principles Soundness | PASS | Standard fill-then-spill distribution; 12h cap and distributed placement are coherent value choices within the declared decision space |

### Verification Notes

The hypothesis proposes a logically sound fill-then-spill algorithm: sleep headroom absorbs slack first, then per-sleep wait segments absorb the remainder, with a shift accumulator maintaining contiguity throughout. All project invariants defined in `.fpf/context.md` are preserved. The 12h vs 14h cap value and distributed-vs-tail wait placement are explicitly open questions in the decision context, and this hypothesis makes a valid, internally consistent choice for each — these are L2 validation concerns, not L1 logical failures.

## Validation

**Verdict**: PASS
**Validated**: 2026-06-01T00:00:00Z
**Evidence**: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01

### Summary

Direct simulation of the proposed fill-then-spill algorithm was executed against the actual `simulateMinimum` logic (30h driving distance → 2 sleep segments). All five test groups passed: no wait segments on moderate slack, exactly one wait segment per sleep on large slack, arithmetic invariant `totalHeadroom + leftover == slack` holds exactly, segments are contiguous in both cases, and `tEnd == desiredArrival` is preserved. Schema compatibility is confirmed (`'wait'` is a valid `RestSegmentSchema.reason` enum member). `interpolate.ts` downstream compatibility is confirmed: `findSegmentAt` is a binary search over `tEnd` and is agnostic to segment count; the rest-segment branch uses `atDist` without branching on `reason`.

R_eff = 0.92 (direct internal test, CL3, no penalty). Weakest element: single test execution without the live Vitest harness — mitigation is straightforward (run `pnpm --filter @delivery/simulation test` after implementing).

## Audit

**R_eff**: 0.92
**Confidence Interval**: [0.82, 0.97]
**Audited**: 2026-06-01T00:00:00Z
**Report**: audit-sleep-cap-12h-distributed-wait-2026-06-01
**Weakest Link**: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01 (0.92)

### Summary

The hypothesis carries an R_eff of 0.92, driven entirely by a single CL3 internal-test evidence item that is fresh (0 days old) but self-capped at 0.92 due to the absence of live Vitest harness execution. There are no dependencies to propagate. The arithmetic logic is sound and all five test groups passed, but the evidence was generated as an ad-hoc Node.js simulation of the proposed algorithm rather than as an integrated test run. Confidence interval [0.82, 0.97] reflects the uncertainty inherent in single-evidence assessments. To improve confidence: (1) implement the changes and run `pnpm --filter @delivery/simulation test`; (2) add boundary/edge-case tests (zero-sleep trips, exactly one sleep, slack exactly at headroom boundary) to address the mild confirmation bias risk identified in the audit.
