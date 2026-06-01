---
id: sleep-cap-tail-wait-block
title: Cap Sleep at 14h + Tail Wait Block for Leftover Slack
kind: system
scope: packages/simulation/src/hos.ts — distributeSlack function only. Applies to newly generated trips; no migration of existing JSONB rows.
decision_context: hos-slack-distribution-strategy
depends_on: []
created: 2026-06-01T00:00:00Z
layer: L2
verified_at: 2026-06-01T00:00:00Z
verification:
  verdict: PASS
  checks_passed:
    - internal-consistency
    - constraint-compliance
    - type-compatibility
    - first-principles
  notes: "Two-phase algorithm correctly caps sleep at 14h and places leftover slack as a tail wait block. All 8 context invariants are satisfied; schema already accepts 'wait' reason; no driving segments are touched."
validated_at: 2026-06-01T00:00:00Z
validation:
  verdict: PASS
  evidence_count: 1
  R_eff: 0.92
  weakest_link: "codebase-analysis (new tests cannot be run until code is changed; arithmetic guarantees correctness)"
evidence:
  - id: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01
    source: codebase-analysis
    CL: 3
    R: 0.92
---

# Cap Sleep at 14h + Tail Wait Block for Leftover Slack

## Method (The Recipe)

1. Add a new constant adjacent to the existing constants in `hos.ts`:
   ```ts
   const SLEEP_DURATION_MAX = 14 * 3600 // 14 h biological cap per sleep segment
   ```

2. Rewrite `distributeSlack` to a two-phase algorithm:
   - Phase A — fill sleep headroom: for each `sleep` segment, compute `headroom = SLEEP_DURATION_MAX - SLEEP_DURATION` (= 4 h). Compute total absorbable slack as `min(slack, sleepCount * headroom)`. Divide evenly across all sleep segments (`perSleep = absorbable / sleepCount`). Apply the per-sleep extension exactly as the current code does (shift subsequent segments forward), but hard-stop each sleep at `SLEEP_DURATION_MAX`.
   - Phase B — emit tail `wait`: if `leftover = slack - absorbable > 0`, append a single `rest` segment `{ type: 'rest', reason: 'wait', tStart: lastSegment.tEnd, tEnd: lastSegment.tEnd + leftover, atDist: totalDistance }` after the last existing segment.

3. Add a dev-time invariant assertion at the end of `distributeSlack` (executed in all environments):
   ```ts
   for (const s of result) {
     if (s.type === 'rest' && s.reason === 'sleep') {
       const dur = s.tEnd - s.tStart
       if (dur > SLEEP_DURATION_MAX + 1) throw new Error(`sleep segment exceeds cap: ${dur}s`)
     }
   }
   ```

4. Update `hos.test.ts` with three new test cases:
   - Upper-bound assertion on each existing test: all sleep segments `<= SLEEP_DURATION_MAX`.
   - Large-slack scenario: `dist = route requiring 2 shifts`, `desiredArrival = T0 + 200h`. Verify no sleep exceeds cap, a `wait` segment is present, `tEnd == desiredArrival`, segments contiguous.
   - Regression: the original 84 h sleep scenario now produces short sleeps and a long wait segment.

5. No changes to `packages/schemas/src/trip.ts` (schema already has `reason: 'wait'`; upstream input validation is a separate concern handled in a companion hypothesis).

## Expected Outcome

- No `sleep` segment in any newly generated timeline exceeds 14 hours.
- Biologically absurd share-page renders (driver asleep for 30–84 h) are eliminated.
- Large `desiredArrival` gaps become visible as a `wait` segment at the destination, which is semantically correct (driver is staged at the drop point waiting for the appointment window).
- Invariant `tEnd == desiredArrival` continues to hold (verified by existing test at `hos.test.ts:114` and new tests).
- Segment contiguity invariant preserved.
- All three new tests pass; zero existing tests regress.
- `packages/schemas` is untouched; downstream `interpolate.ts` handles `wait` segments already (it is a superset of `rest`).

## Rationale

- **Anomaly**: `distributeSlack` has no upper bound, turning generous `desiredArrival` values into nonsensically long sleep segments (30–84 h confirmed in analysis).
- **Approach**: 14 h is the FMCSA extended-rest ceiling used in real HOS (10 h mandatory + 4 h optional). Capping there is the most defensible biological constant. Placing leftover slack as a single tail `wait` block is the simplest approach that preserves contiguity, avoids distributing wait across mid-route positions where it has no semantic meaning, and keeps the algorithm deterministic.
- **Assumptions**: The `wait` reason in `RestSegmentSchema` is already schema-valid. The interpolation layer (`interpolate.ts`) passes through any `rest` segment; `wait` segments will render as stationary on the share page, which is the intended behaviour (truck parked at destination).
- **Risk Level**: Conservative — minimal code surface changed, single-file edit, algorithm structure preserved, schema not changed, backward compatible.

## Verification

**Verdict**: PASS
**Verified**: 2026-06-01T00:00:00Z

### Checks Performed

| Check | Result | Notes |
|-------|--------|-------|
| Internal Consistency | PASS | Two-phase algorithm (fill headroom → tail wait) directly achieves all stated outcomes; tEnd == desiredArrival holds by arithmetic: absorbable + leftover = slack |
| Constraint Compliance | PASS | All 8 context invariants satisfied: tEnd invariant, contiguity, HosError throw, no driving modification, schema validity, no migration, DAG preserved |
| Type Compatibility | PASS | SLEEP_DURATION_MAX is number; appended rest segment matches RestSegmentSchema with 'wait' already in z.enum |
| First-Principles Soundness | PASS | 14h cap grounded in FMCSA extended-rest rules; tail-block placement is minimal-surface and semantically correct (driver staged at destination) |

### Verification Notes

The two-phase algorithm is logically sound and internally consistent. Phase A absorbs as much slack as biologically plausible into sleep segments (capped at 14h each), and Phase B places any remainder as a single tail wait block, guaranteeing `tEnd == desiredArrival` by construction. No invariants in the bounded context are violated, and the schema already supports the `wait` reason without modification.

## Validation

**Verdict**: PASS
**Validated**: 2026-06-01T00:00:00Z
**Evidence**: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01

### Summary

Codebase analysis (CL3) confirmed all three key assumptions that the L1 verification was unable to test empirically: (1) `'wait'` is already present in `RestSegmentSchema.reason` at `trip.ts:46` — no schema change needed; (2) `interpolate.ts` handles any rest segment generically, so a tail `wait` block renders correctly as stationary at the destination; (3) the two-phase arithmetic (`absorbable + leftover === slack`) algebraically guarantees the `tEnd == desiredArrival` invariant holds across all edge cases (verified by node execution). The bug is real and severe — current code produces 84h sleep with a single large-slack scenario. The fix is correct, minimal-surface, and backward compatible. R_eff = 0.92 (CL3 codebase analysis; slight reduction because new tests are asserted correct by arithmetic but cannot be executed until the fix is applied).

## Audit

**R_eff**: 1.00
**Confidence Interval**: [0.90, 1.00]
**Audited**: 2026-06-01T00:00:00Z
**Report**: audit-sleep-cap-tail-wait-block-2026-06-01
**Weakest Link**: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01 (1.00)

### Summary

The single evidence item is a same-project codebase analysis (CL3) created on the audit date (0 days old), yielding an adjusted score of 1.00 by the CL/freshness formula. WLNK on one item gives R_eff = 1.00. The confidence interval [0.90, 1.00] reflects the single-evidence limitation. The formula-computed R_eff is technically maximal, but a mild confirmation-bias flag and a residual test-execution gap temper confidence: the three new tests asserted in the hypothesis are arithmetically guaranteed correct but have not been run by a test runner. Recommended follow-up: implement the fix, execute `pnpm --filter @delivery/simulation test`, and record a second evidence item (`ev-test-execution-sleep-cap-...`) to narrow the confidence interval and eliminate the confirmation-bias concern.
