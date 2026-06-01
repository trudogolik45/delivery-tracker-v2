---
id: DRR-2026-06-01-hos-sleep-duration-cap
decision_context: hos-slack-distribution-strategy
recommended: sleep-cap-tail-wait-block
candidates:
  - sleep-cap-tail-wait-block
  - fmcsa-14h-driving-window-and-30min-break
  - sleep-cap-12h-distributed-wait
  - upstream-desired-arrival-validation
created: 2026-06-01T00:00:00Z
status: pending_approval
---

# Decision Readiness Report: HOS Sleep Duration Cap Strategy

## Context

The HOS (Hours of Service) driver simulation algorithm in `packages/simulation/src/hos.ts`
allows `sleep` segment durations to grow without an upper bound when the user supplies a
generous `desiredArrival`. The function `distributeSlack` spreads all available time buffer
proportionally across `sleep` segments, producing biologically impossible sleep durations
(30–84 hours confirmed) that render share-page timelines absurd and erode user trust.

The bounded context defines four open questions this decision must settle:
1. What constant to use for `SLEEP_DURATION_MAX` (12h vs 14h)?
2. Where to place leftover slack after sleep segments are capped (tail block vs distributed)?
3. Whether to add upstream input validation on `desiredArrival` at the schema layer?
4. Whether to add FMCSA 14h per-shift on-duty window enforcement in `simulateMinimum`?

An additional hypothesis (`event-driven-hos-scheduler`) was rejected at the verify stage for
violating the simplicity constraint — it was too architecturally complex for a "simplified
model" context. Four hypotheses survived to L2 validation.

The hypotheses are **not mutually exclusive**. Two address `distributeSlack` (algorithm layer,
competing approaches), one is upstream validation (complementary), and one is a realism
upgrade to `simulateMinimum` (complementary). The recommended path combines the primary
algorithm fix with both complementary layers.

---

## Candidates Evaluated

| Rank | Hypothesis | R_eff | Weakest Link | Status |
|------|------------|-------|--------------|--------|
| 1 | Cap Sleep at 14h + Tail Wait Block (`sleep-cap-tail-wait-block`) | 1.00 | codebase-analysis (CL3, 0d) | **Recommended — Primary fix** |
| 1 | Model FMCSA 14h On-Duty Window (`fmcsa-14h-driving-window-and-30min-break`) | 1.00 | codebase-analysis (CL3, 0d, analyst cap 0.88) | **Recommended — Additive layer** |
| 3 | Cap Sleep at 12h + Distributed Wait (`sleep-cap-12h-distributed-wait`) | 0.92 | internal-test (CL3, no live Vitest run) | Alternative (competing with rank-1 primary) |
| 3 | Upstream `desiredArrival` Validation (`upstream-desired-arrival-validation`) | 0.92 | internal-test (CL3, Zod v4 binary not directly tested) | **Recommended — Complementary layer** |

Note on R_eff = 1.00 ties: both CL3-fresh codebase-analysis items score 1.00 by the
WLNK/freshness formula. `sleep-cap-tail-wait-block` is preferred over
`fmcsa-14h-driving-window-and-30min-break` as the primary fix because it directly addresses
the reported bug in `distributeSlack`. The FMCSA hypothesis addresses `simulateMinimum` and
is orthogonal; it is ranked co-equal but categorized as additive.

---

## Recommendation

**Recommended Path**: Three-layer composite fix.

### Layer 1 — Primary (must-have): `sleep-cap-tail-wait-block`

**R_eff Score**: 1.00  
**Confidence Interval**: [0.90, 1.00]

Rewrite `distributeSlack` with a two-phase algorithm:
- Phase A: distribute sleep headroom evenly, hard-capping each sleep at `SLEEP_DURATION_MAX = 14 * 3600`.
- Phase B: append a single `rest/wait` tail block for any remaining slack after all sleep headroom is exhausted.

This is the minimal, direct fix for the reported bug. It is the lowest-risk change (single
function, minimal code surface, schema already supports `wait`), and the 14h cap is
externally grounded in the FMCSA extended-rest ceiling.

### Layer 2 — Complementary (strongly recommended): `upstream-desired-arrival-validation`

**R_eff Score**: 0.92  
**Confidence Interval**: [0.82, 0.97]

Add a `z.refine` on both `GenerateTripInputSchema` and `TripPreviewInputSchema` rejecting
`desiredArrival` more than 14 days ahead of `startedAt`. This provides defence-in-depth:
invalid inputs are rejected at the API boundary before reaching `buildTimeline`, surfacing
UI-clock errors as user-facing 400 responses rather than producing silently broken timelines.

### Layer 3 — Additive (recommended, lower urgency): `fmcsa-14h-driving-window-and-30min-break`

**R_eff Score**: 1.00 (formula) / 0.88 (analyst practical cap)  
**Confidence Interval**: [0.90, 1.00]

Enforce the FMCSA 14-hour per-shift on-duty window in `simulateMinimum`. This is independent
of the `distributeSlack` fix and improves the realism of the minimum timeline itself, not
just the slack distribution. It can be implemented in the same PR or a follow-up. It requires
care because some existing tests may need expected-value updates.

### Why `sleep-cap-12h-distributed-wait` Was Not Recommended as Primary

- **Lower R_eff** (0.92 vs 1.00): evidence is an ad-hoc Node simulation rather than direct
  codebase analysis.
- **Higher algorithmic complexity**: mid-array insertion of wait segments per sleep cycle
  requires a shift accumulator and more complex contiguity maintenance, increasing the risk
  of edge-case bugs.
- **12h cap vs 14h**: 14h is the externally grounded FMCSA extended-rest ceiling and aligns
  with the companion FMCSA hypothesis. 12h has no comparable regulatory anchor in the project
  context.
- **Distributed wait placement**: semantically, a single tail wait block (driver staged at
  destination awaiting delivery window) is more realistic than wait segments scattered at
  mid-route rest stops, which would imply the driver chose to idle at intermediate points
  rather than proceeding to the delivery location.
- It remains a valid alternative if the team prefers 12h or distributed placement; the choice
  is a values call, not a correctness failure.

---

## Consequences

### Positive

- Biologically absurd share-page renders (driver asleep for 30–84 h) are permanently eliminated.
- Large `desiredArrival` gaps are represented as a `wait` segment at the destination, which is
  semantically correct (driver staged at drop point awaiting appointment window).
- `tEnd == desiredArrival` invariant is preserved by construction (arithmetic guarantee).
- Segment contiguity invariant is preserved.
- Schema backward compatibility is maintained — no migration of existing stored timelines.
- Upstream validation provides defence-in-depth against future algorithmic regressions.
- FMCSA 14h window improvement makes the simulator more defensible to logistics-domain users.
- All changes are bounded to `packages/simulation` and `packages/schemas`; no API route or DB
  migration changes are required beyond Hono's existing `zValidator` propagating the new error.

### Negative

- Three new test cases must be written and maintained (sleep cap upper bound, large-slack
  scenario, regression on 84h case).
- The FMCSA layer (Layer 3) may require updates to existing test expected values where the
  14h window truncates a shift that previously assumed 11h driving.
- `SLEEP_DURATION_MAX` becomes a new named constant that future contributors must understand;
  it should be documented with an inline comment referencing the FMCSA rule.

### Trade-offs Accepted

- Choosing a single tail wait block over distributed wait segments accepts a simpler algorithm
  at the cost of slightly less realistic intermediate timeline appearance (all idle time appears
  at destination rather than across intermediate stops).
- Choosing 14h over 12h accepts a slightly larger sleep headroom per cycle in exchange for
  external regulatory grounding and consistency with the FMCSA additive layer.
- The FMCSA Layer 3 is additive, not critical-path — if test-value churn is undesirable,
  it can be deferred to a follow-up PR without affecting the primary bug fix.

---

## Dissenting Evidence

- **ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01**: The 12h distributed
  hypothesis passed all five simulated test groups including contiguity through the insertion
  loop, suggesting the "more complex algorithm" concern is manageable. The 12h cap and
  distributed placement are coherent choices. This evidence supports the alternative as viable,
  though it does not displace the primary recommendation.

- **Analyst R cap (0.88) on FMCSA evidence**: The evidence analyst for the FMCSA hypothesis
  noted that `shiftStart` tracking inside the `while` loop may interact with edge cases not
  visible through static inspection alone, particularly around early shift termination when the
  14h window is hit. This is a bounded risk but confirms Layer 3 carries more implementation
  uncertainty than Layers 1 and 2.

- **Confirmation bias flags**: Both R_eff=1.00 hypotheses carry mild confirmation-bias flags in
  their audit reports (all findings support the hypothesis; no counterargument scenarios tested).
  This is inherent to single-evidence assessments and is mitigated by running tests after
  implementation.

---

## Validity

This decision should be revisited if:

- The project adopts real FMCSA rolling 60/70h window enforcement (currently out of scope per
  ADR-0002); a full rewrite of `simulateMinimum` would supersede both the sleep-cap and FMCSA
  14h window changes.
- The `trips.timeline` JSONB schema changes in a way that requires migrating existing stored
  timelines; the "no backfill" assumption in this decision would need to be reconsidered.
- The biological realism requirement changes — e.g., if logistics users report that 14h sleeps
  are still implausible for their fleet type, `SLEEP_DURATION_MAX` may need to be lowered.
- A significant fraction of trips in production are found to use `desiredArrival` values beyond
  14 days, which would mean the upstream validation constant requires adjustment.
- A second (non-solo) developer begins contributing to the simulation package; at that point,
  the 12h distributed alternative may be preferred for its more distributed idle-time semantics.

**Review Date**: 2026-12-01

---

## Next Steps

1. **Implement Layer 1** (`sleep-cap-tail-wait-block`): Add `SLEEP_DURATION_MAX = 14 * 3600`
   and rewrite `distributeSlack` in `packages/simulation/src/hos.ts` with the two-phase
   algorithm (fill headroom → tail wait block). Add the dev-time invariant assertion.

2. **Write new tests**: Add three regression tests to `hos.test.ts`:
   - Upper-bound assertion on sleep duration across existing test scenarios.
   - Large-slack scenario: verify no sleep exceeds cap, a `wait` segment is present,
     `tEnd == desiredArrival`, segments are contiguous.
   - Regression: the 84h sleep scenario now produces short sleeps and a long tail wait.

3. **Implement Layer 2** (`upstream-desired-arrival-validation`): Add
   `MAX_ARRIVAL_WINDOW_SECONDS = 14 * 24 * 3600` and the `z.refine` to both
   `GenerateTripInputSchema` and `TripPreviewInputSchema` in `packages/schemas/src/trip.ts`.
   Add boundary tests. Verify `zValidator` propagates the 400 error correctly (no middleware
   changes required).

4. **Run quality gates**: `pnpm --filter @delivery/simulation test` and
   `pnpm --filter @delivery/schemas test`. All existing + new tests must pass.

5. **Implement Layer 3** (`fmcsa-14h-driving-window-and-30min-break`, same PR or follow-up):
   Add `MAX_ONDUTY_WINDOW = 14 * 3600` and `shiftStart` tracking in `simulateMinimum`. Update
   any existing test expected values that assume 11h driving per shift regardless of on-duty
   clock. Add a new test asserting no shift exceeds `14 * 3600` wall-clock seconds.

6. **Record test-execution evidence**: After running the Vitest suite successfully, record a
   second evidence item per hypothesis (source: test-run, CL3) to tighten confidence intervals
   and eliminate the residual confirmation-bias concern.

7. **Commit**: One commit per logical layer, or a single PR with all three layers — coordinate
   with team preference. Conventional commit format: `fix(simulation): cap sleep duration at
   14h and emit tail wait segments for excess slack`.

---

## References

- Context: `.fpf/context.md`
- Hypothesis (primary): `.fpf/knowledge/L2/sleep-cap-tail-wait-block.md`
- Hypothesis (alternative): `.fpf/knowledge/L2/sleep-cap-12h-distributed-wait.md`
- Hypothesis (complementary): `.fpf/knowledge/L2/upstream-desired-arrival-validation.md`
- Hypothesis (additive): `.fpf/knowledge/L2/fmcsa-14h-driving-window-and-30min-break.md`
- Audit: `.fpf/evidence/audit-sleep-cap-tail-wait-block-2026-06-01.md`
- Audit: `.fpf/evidence/audit-sleep-cap-12h-distributed-wait-2026-06-01.md`
- Audit: `.fpf/evidence/audit-upstream-desired-arrival-validation-2026-06-01.md`
- Audit: `.fpf/evidence/audit-fmcsa-14h-driving-window-and-30min-break-2026-06-01.md`
- Evidence: `.fpf/evidence/ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01.md`
- Evidence: `.fpf/evidence/ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01.md`
- Evidence: `.fpf/evidence/ev-internal-test-upstream-desired-arrival-validation-2026-06-01.md`
- Evidence: `.fpf/evidence/ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01.md`
- Architecture: `docs/adr/0002-precomputed-trip-timeline.md`
- Draft analysis: `draft_fix.md`
