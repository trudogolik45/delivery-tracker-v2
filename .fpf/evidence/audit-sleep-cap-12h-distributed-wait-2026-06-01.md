---
id: audit-sleep-cap-12h-distributed-wait-2026-06-01
hypothesis_id: sleep-cap-12h-distributed-wait
r_eff: 0.92
confidence_interval:
  lower: 0.82
  upper: 0.97
weakest_link: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01
created: 2026-06-01T00:00:00Z
---

# Audit Report: Cap Sleep at 12h + Distribute Wait Segments After Each Sleep

## R_eff Calculation

**Final R_eff: 0.92**
**Confidence Interval: [0.82, 0.97]**

### Evidence Analysis

| Evidence ID | Type | CL | Base | Age | Decay | CL-Computed | Declared R | Final Score |
|---|---|---|---|---|---|---|---|---|
| ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01 | internal-test | 3 | 1.00 | 0d | 0% | 1.00 | 0.92 | 0.92 |

**Score derivation note:** CL3 base score is 1.00 and freshness multiplier is 1.00 (0 days old). However, the evidence file itself declares `R: 0.92`, citing a known quality limitation: the test was executed as a direct Node.js simulation of the proposed algorithm rather than via the live Vitest harness. Per WLNK, the conservative minimum of `min(CL-computed 1.00, declared-R 0.92)` is applied, yielding 0.92. This is the honest reflection of the evidence's stated ceiling.

### Weakest Link Analysis

- **Weakest Evidence**: ev-internal-test-sleep-cap-12h-distributed-wait-2026-06-01
- **Score**: 0.92
- **Reason**: The evidence is a direct simulation of the fill-then-spill algorithm logic executed in Node.js — not a run of the actual Vitest test suite against the committed implementation. All 5 test groups passed, but the gap between "algorithm pseudocode executed ad-hoc" and "implementation integrated and passing `pnpm --filter @delivery/simulation test`" is real. The algorithm is also more complex than the current implementation (variable segment count, mid-array insertion), which increases the surface area for integration bugs that only surface under the live harness.
- **Mitigation**: Straightforward — implement the changes in `packages/simulation/src/hos.ts` and run `pnpm --filter @delivery/simulation test`. If existing tests pass and the three new tests described in the hypothesis (moderate slack, large slack, contiguity) are added and green, this evidence should be superseded by a CL3 harness-executed result, pushing R toward 0.97+.

### Dependency Tree

```
[sleep-cap-12h-distributed-wait R:0.92]
  └── depends_on: (none)
```

No dependencies declared. R_eff is determined entirely by self-evidence.

### Bias Assessment

- [ ] **Pet Idea Bias**: Not detected. The hypothesis explicitly acknowledges the competing hypothesis (`sleep-cap-14h-tail-wait`) within the same decision context and articulates trade-offs (12h vs 14h cap, distributed vs tail placement). The rationale section names specific risk areas (algorithm complexity, mid-array insertion) rather than advocating unconditionally.
- [ ] **NIH Bias**: Not detected. The 14h cap from `draft_fix.md` was explicitly considered and rejected in favor of 12h with a stated rationale ("2h headroom per sleep instead of 4h; matches typical real-world extended-rest practice"). External alternatives were engaged, not ignored.
- [x] **Confirmation Bias**: Mild risk. All 5 test groups were designed by the same author who proposed the algorithm, and the test fixture was constructed to exercise the algorithm's happy path. No adversarial test cases were included (e.g., zero sleep segments, exactly one sleep, slack exactly equal to totalHeadroom boundary, negative slack). The validation notes do not describe failure scenario testing. Mitigation: add boundary and edge-case tests before promoting to decision.

### Risk Summary

The hypothesis is algorithmically sound and its internal arithmetic is verified. The primary reliability risk is the absence of live-harness execution — the R: 0.92 ceiling is appropriate and should not be inflated. A secondary, underweighted risk is the lack of boundary/edge-case tests (zero-sleep trips, exactly one sleep, slack at the headroom boundary), which leaves a gap that confirmation bias may have introduced. Recommendation: run `pnpm --filter @delivery/simulation test` immediately after implementation and add at least two edge-case tests before this hypothesis is selected as the winning decision.
