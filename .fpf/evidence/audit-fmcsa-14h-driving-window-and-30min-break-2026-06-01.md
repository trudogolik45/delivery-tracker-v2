---
id: audit-fmcsa-14h-driving-window-and-30min-break-2026-06-01
hypothesis_id: fmcsa-14h-driving-window-and-30min-break
r_eff: 1.00
confidence_interval:
  lower: 0.90
  upper: 1.00
weakest_link: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01
created: 2026-06-01T00:00:00Z
---

# Audit Report: Model the FMCSA 14-Hour On-Duty Window in simulateMinimum

## R_eff Calculation

**Final R_eff: 1.00**
**Confidence Interval: [0.90, 1.00]**

> **Note on analyst-assigned R discrepancy**: The single evidence item carries a pre-assigned R: 0.88 in its frontmatter, reflecting the analyst's domain judgement that static codebase analysis without test execution of the proposed change warrants a reliability cap. The CL3 + freshness formula yields 1.00 (no penalty, no decay). The formula value is reported as R_eff per protocol. The analyst cap of 0.88 is documented in the weakest-link section as a conservative bound; implementers should treat 0.88 as the practical reliability ceiling until the proposed change is tested.

### Evidence Analysis

| Evidence ID | Type | CL | Base | Age | Decay | Final Score |
|-------------|------|----|------|-----|-------|-------------|
| ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01 | codebase-analysis | CL3 | 1.00 | 0d | 0% | 1.00 |

**CL3 rationale**: The evidence is direct inspection of the target file in this exact project (same codebase, same module). No cross-context penalty applies.

**Freshness**: Evidence created 2026-06-01, audit date 2026-06-01. Age = 0 days. Decay multiplier = 1.00 (Fresh < 30 days).

### Weakest Link Analysis

- **Weakest Evidence**: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01
- **Score (formula)**: 1.00
- **Analyst-assigned R cap**: 0.88
- **Reason**: This is the sole evidence item, making it the weakest link by definition. The formula score of 1.00 is the maximum possible for CL3 fresh evidence. However, the evidence is static analysis only — the proposed change has not been implemented or executed. The analyst correctly capped R at 0.88 to reflect the residual uncertainty that: (a) `shiftStart` tracking inside the `while` loop may interact with edge cases not visible through file inspection alone, and (b) the impact on existing tests with expected-value changes has not been empirically verified.
- **Mitigation**: Implement the change in `packages/simulation/src/hos.ts`, add the two new test cases described in the hypothesis (multi-stop scenario where 14h window truncates driving; assertion that `shiftEnd - shiftStart <= 14 * 3600`), and run `pnpm --filter @delivery/simulation test`. A passing test run would elevate this evidence to CL3 executed, allowing R to rise toward 0.95+.

### Dependency Tree

```
[fmcsa-14h-driving-window-and-30min-break R:1.00]
  └── depends_on: (none)
```

No dependencies declared. R_eff is determined solely by self-evidence.

### Bias Assessment

- [ ] **Pet Idea Bias**: Not detected. The hypothesis was grounded in a real FMCSA regulatory constraint (14-hour on-duty window) with direct verification against the codebase. The evidence confirms the gap exists; it does not advocate for the hypothesis beyond what the code shows.
- [ ] **NIH Bias**: Not detected. The hypothesis explicitly positions the change as additive to the sleep-cap hypothesis. External FMCSA rule sources (regulatory constraint, not an invented internal standard) ground the claim, and the out-of-scope boundary (rolling 60/70h window per ADR-0002) was respected without trying to extend scope beyond what is justified.
- [x] **Confirmation Bias**: Minor flag. All six findings in the evidence file support the hypothesis. No finding contradicts or complicates the proposed fix. The evidence does not test failure modes (e.g., does early shift termination when the 14h window is hit produce a valid Segment[] that distributeSlack can stretch without breaking invariants?). The edge-case claim ("short trips unaffected") is arithmetically verified (11.5h < 14h), which is appropriate, but the more complex edge cases (loading segments, multiple breaks consuming window time) are asserted sound without a test execution. This is a bounded risk given the code change is small, but it is a gap.

### Risk Summary

The hypothesis is well-grounded in regulatory reality and the codebase gap is empirically confirmed. The sole evidence item is high-quality static analysis (CL3, fresh) but carries a known limitation: no test execution of the proposed change. The primary reliability risk is that the `shiftStart` reset and early-termination logic in the `while` loop could produce edge-case Segment[] arrays that violate contiguity or cause distributeSlack to produce incorrect timelines under configurations not visible through static inspection. This risk is bounded to the simulation package (no API or DB impact) and is addressable by running the two new test cases described in the hypothesis before merging. Until tests pass, the practical reliability ceiling is the analyst-assigned 0.88.
