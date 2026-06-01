---
id: audit-sleep-cap-tail-wait-block-2026-06-01
hypothesis_id: sleep-cap-tail-wait-block
r_eff: 1.00
confidence_interval:
  lower: 0.90
  upper: 1.00
weakest_link: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01
created: 2026-06-01T00:00:00Z
---

# Audit Report: Cap Sleep at 14h + Tail Wait Block for Leftover Slack

## R_eff Calculation

**Final R_eff: 1.00**
**Confidence Interval: [0.90, 1.00]**

### Evidence Analysis

| Evidence ID | Type | CL | Base | Age | Decay | Final Score |
|-------------|------|----|------|-----|-------|-------------|
| ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01 | codebase-analysis | CL3 | 1.00 | 0d | 0% | 1.00 |

**CL derivation**: CL3 — same project, internal codebase analysis directly inspecting the target files (`hos.ts`, `trip.ts`, `interpolate.ts`, `hos.test.ts`). No context transfer penalty.

**Freshness derivation**: Evidence created 2026-06-01, audit date 2026-06-01 — age = 0 days. Fresh (< 30 days) → multiplier 1.00. No decay applied.

**Adjusted Score**: 1.00 × 1.00 = **1.00**

**WLNK application**: Single evidence item. R_eff = min(1.00) = **1.00**

### Confidence Interval Derivation

Evidence count n = 1.

```
Lower = R_eff - (0.1 / sqrt(1)) = 1.00 - 0.10 = 0.90
Upper = min(R_eff + (0.05 / sqrt(1)), 1.0) = min(1.05, 1.0) = 1.00
```

The wide lower-bound spread (±0.10) reflects the single-evidence limitation. Confidence interval: **[0.90, 1.00]**.

### Weakest Link Analysis

- **Weakest Evidence**: ev-codebase-analysis-sleep-cap-tail-wait-block-2026-06-01
- **Score**: 1.00 (by CL3 + freshness formula)
- **Reason**: This is the sole evidence item, so it is trivially the weakest link. The formula yields a perfect score (CL3, zero age), but the evidence author correctly flagged an inherent limitation: the three new tests asserted in the hypothesis cannot be executed until the fix code is actually written. Their correctness is guaranteed by arithmetic — the invariant `absorbable + leftover === slack` is algebraically exact — but runtime test execution has not occurred. This represents an epistemic ceiling not captured by the CL/decay formula alone.
- **Mitigation**: Implement the fix in `packages/simulation/src/hos.ts`, run `pnpm --filter @delivery/simulation test`, and record a second evidence item `ev-test-execution-sleep-cap-...` (CL3, source: test-run). This would confirm behavioral correctness empirically and provide a second evidence item that tightens the confidence interval.

### Dependency Tree

```
[sleep-cap-tail-wait-block R:1.00]
  └── depends_on: (none)
```

No dependencies declared in `depends_on: []`.

### Bias Assessment

- [ ] **Pet Idea Bias**: Not detected. The hypothesis is tightly scoped to a single function (`distributeSlack`), cites a concrete external Standard (FMCSA extended-rest ceiling), and explicitly documents what it does NOT change (schema, interpolation layer, existing tests). There is no overreach or attachment to a particular architectural style.
- [ ] **NIH Bias**: Not detected. The 14h cap is grounded in an external regulatory Standard (FMCSA HOS rules), not an invented internal constant. The alternative of distributing wait across mid-route positions was considered and explicitly rejected with a stated reason (no semantic meaning at mid-route positions). The analysis fairly weighed simplicity and semantic correctness.
- [x] **Confirmation Bias**: Mild concern. All evidence is from a single codebase analysis session that both found the bug and validated the fix. The same analysis that confirms the bug also confirms the fix works. A second, independent evidence item (test execution after the fix is applied) would eliminate this concern. Note: the arithmetic verification using node scripts is an objective check, which partially mitigates this, but the test execution gap remains.

### Risk Summary

The hypothesis is well-supported by a thorough, same-project codebase analysis (CL3) conducted on the day of creation. The R_eff of 1.00 from the formula reflects maximal congruence and zero staleness, but the confidence interval [0.90, 1.00] honestly captures the single-evidence limitation. The primary residual risk is that the new tests have not been executed; correctness is guaranteed by arithmetic but not by a test runner. Implementing the fix and recording a test-execution evidence item would raise confidence materially and confirm no integration regressions in the simulation package. No cognitive biases that would distort the hypothesis toward an incorrect solution were detected.
