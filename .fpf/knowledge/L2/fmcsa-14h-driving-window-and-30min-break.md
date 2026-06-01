---
id: fmcsa-14h-driving-window-and-30min-break
title: Model the FMCSA 14-Hour On-Duty Window in simulateMinimum
kind: system
scope: packages/simulation/src/hos.ts — simulateMinimum function and constants. Broader HOS realism improvement beyond the sleep-cap bug fix.
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
  notes: "Method logically leads to expected outcome; no invariants are violated; the 14h window is a distinct FMCSA constraint from the out-of-scope 60/70h rolling window; type-compatible with existing Segment union."
validated_at: 2026-06-01T00:00:00Z
validation:
  verdict: PASS
  evidence_count: 1
  R_eff: 0.88
  weakest_link: "codebase-analysis — direct inspection of the target file, CL3, no execution of the proposed change"
evidence:
  - id: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01
    source: codebase-analysis
    CL: 3
    R: 0.88
---

# Model the FMCSA 14-Hour On-Duty Window in simulateMinimum

## Method (The Recipe)

1. Add a new constant:
   ```ts
   const MAX_ONDUTY_WINDOW = 14 * 3600 // FMCSA 14-hour on-duty window per shift
   ```
   The current model allows driving 8 h + 30 min break + 3 h = 11.5 h of wall-clock time per shift with no outer window constraint. Under real FMCSA rules, the 11-hour driving limit must be completed within a 14-hour on-duty window from the start of the shift. Any non-driving on-duty time (break, loading/unloading) eats into that window.

2. Modify `simulateMinimum` to enforce the 14-hour window:
   - Track `shiftStart` timestamp when each driving shift begins.
   - After each activity (drive, break, drive), check `currentTime - shiftStart <= MAX_ONDUTY_WINDOW`.
   - If the 30-minute break plus remaining driving would exceed the 14-hour window, terminate the shift earlier (driver can only drive until the window closes) and begin the mandatory 10-hour sleep.
   - This can cause a shift to end with less than 11 h of actual driving if on-duty time is consumed by breaks or loading segments.

3. Ensure the rest of the algorithm (sleep segments, `distributeSlack` with the cap fix) composes correctly with the new `simulateMinimum` output. The invariants (contiguity, `tEnd == desiredArrival`) are unaffected because `simulateMinimum` still produces a valid minimum timeline; `distributeSlack` still stretches it.

4. Update `hos.test.ts`:
   - New test: a long trip where the 30-min break eats into the 14 h window, causing the effective driving limit to be less than 11 h in that shift.
   - Verify that `simulateMinimum` never produces a shift where `shiftEnd - shiftStart > 14 * 3600`.
   - Existing tests that assumed exactly 11 h of driving per shift may need adjustment if the 14-h window is tighter in the test's time context.

5. This hypothesis is **additive** to the sleep-cap hypothesis. It improves `simulateMinimum` while the cap hypothesis fixes `distributeSlack`. Both can be applied together.

## Expected Outcome

- The simulated minimum timeline is more realistic for trips where loading, break, or fuel time eats into the on-duty window, producing a shorter effective driving block.
- The share-page timeline is more defensible to a logistics-domain user who knows FMCSA rules.
- Edge case: a very short trip that falls entirely within one 14-h window is unaffected (current behaviour is already correct for those cases since 8 + 0.5 + 3 = 11.5 h < 14 h).
- No change to the sleep-cap or wait-segment logic required; the fix is orthogonal.

## Rationale

- **Anomaly**: `simulateMinimum` currently models driving duration limits (8 h before break, 11 h total) but ignores the 14-hour on-duty clock window that constrains the entire shift regardless of breaks. This means multi-stop or slow-loading trips that stay on duty past 14 hours are not correctly modeled.
- **Approach**: The 14-h window is the second most important FMCSA constraint after the 11-h driving limit, and it is the one most often violated in simplified models. Adding it does not require the rolling 60/70 h window (explicitly out of scope per ADR-0002) but does bring `simulateMinimum` materially closer to real HOS.
- **Assumptions**: The project's "simplified model" philosophy allows selective realism upgrades. The 14-h window requires only a single new constant and a timestamp check inside the existing `while` loop; no architectural change.
- **Risk Level**: Moderate — changes `simulateMinimum` logic which feeds `buildTimeline`. Some existing tests may need updated expected values if the 14-h window affects their scenario. The risk is bounded to the simulation package.

## Verification

**Verdict**: PASS
**Verified**: 2026-06-01T00:00:00Z

### Checks Performed

| Check | Result | Notes |
|-------|--------|-------|
| Internal Consistency | PASS | Tracking shiftStart and enforcing a 14h ceiling directly produces the claimed outcome of shorter effective driving when non-driving on-duty time is consumed |
| Constraint Compliance | PASS | No project invariants violated: contiguity and tEnd==desiredArrival are unaffected (distributeSlack still stretches the minimum timeline); driving-segment immutability in distributeSlack is untouched; the 14h per-shift window is distinct from the out-of-scope 60/70h rolling window |
| Type Compatibility | PASS | Adds one numeric constant and a timestamp variable inside an existing while loop; all produced segments remain valid against the existing SegmentSchema discriminated union |
| First-Principles Soundness | PASS | 8h+0.5h+3h=11.5h<14h confirms single-shift trips are correctly unaffected; multi-stop on-duty time consuming the 14h window is a real FMCSA constraint and the truncation logic is arithmetically sound |

### Verification Notes

The hypothesis is logically self-consistent and does not violate any bounded-context invariants. The 14-hour on-duty window is a distinct FMCSA constraint from the 60/70h rolling window that is explicitly out of scope; enforcing it requires only a constant and a timestamp check, making the change minimal and compositionally safe with the sleep-cap fix. The one risk — that existing tests may need expected-value updates — is acknowledged in the hypothesis and is a test-maintenance concern, not a logical flaw.

## Validation

**Verdict**: PASS
**Validated**: 2026-06-01T00:00:00Z
**Evidence**: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01

### Summary

Direct codebase inspection of `packages/simulation/src/hos.ts` confirmed the absence of `MAX_ONDUTY_WINDOW` and `shiftStart` tracking in `simulateMinimum`. The five existing constants match exactly the hypothesis's description of the current state. ADR-0002 scopes out the rolling 60/70h window but not the per-shift 14h window, confirming the proposed change is in scope. The `distributeSlack` function is compositionally independent of the 14h window check, confirming the additive nature of the fix. No test in `hos.test.ts` asserts the 14h ceiling, confirming the test gap. The proposed change (one constant + one timestamp variable + one ceiling check) is consistent with the existing code style and does not touch any shared schemas, API routes, or DB migrations.

## Audit

**R_eff**: 1.00
**Confidence Interval**: [0.90, 1.00]
**Audited**: 2026-06-01T00:00:00Z
**Report**: audit-fmcsa-14h-driving-window-and-30min-break-2026-06-01
**Weakest Link**: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01 (1.00 formula / 0.88 analyst cap)

### Summary

The single evidence item is CL3 (same-project codebase analysis) with 0-day age, yielding a formula R_eff of 1.00 under the WLNK principle. However, the evidence is purely static analysis — no test execution of the proposed change has occurred. The analyst pre-assigned R: 0.88 to reflect this limitation, which represents the practical reliability ceiling until the two new test cases described in the hypothesis are implemented and pass. To improve confidence, implement the `shiftStart` tracking and `MAX_ONDUTY_WINDOW` ceiling in `hos.ts`, add assertions that no shift exceeds 14 * 3600 seconds, run `pnpm --filter @delivery/simulation test`, and re-evaluate with the resulting test-execution evidence. A confirmation bias flag was noted: all evidence findings support the hypothesis; no counterargument scenarios were tested.
