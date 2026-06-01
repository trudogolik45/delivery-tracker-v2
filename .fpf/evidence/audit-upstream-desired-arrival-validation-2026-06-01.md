---
id: audit-upstream-desired-arrival-validation-2026-06-01
hypothesis_id: upstream-desired-arrival-validation
r_eff: 0.92
confidence_interval:
  lower: 0.82
  upper: 0.97
weakest_link: ev-internal-test-upstream-desired-arrival-validation-2026-06-01
created: 2026-06-01T00:00:00Z
---

# Audit Report: Upstream Input Validation — Cap desiredArrival Window at Schema Layer

## R_eff Calculation

**Final R_eff: 0.92**
**Confidence Interval: [0.82, 0.97]**

### Evidence Analysis

| Evidence ID | Source | CL | Base | Age | Decay | Author R | Final Score |
|---|---|---|---|---|---|---|---|
| ev-internal-test-upstream-desired-arrival-validation-2026-06-01 | internal-test | CL3 | 1.00 | 0d | 0% (×1.00) | 0.92 | **0.92** |

**Note on score derivation.** CL3 + fresh age yields a mechanical score of 1.00. The evidence author applied a conservative downgrade to R: 0.92 to reflect that the live Zod test ran against the v3-compatible API surface (not the project's own installed v4 binary in isolation). Because this caveat is empirically grounded — the project's `packages/schemas/package.json` pins `^4.0.0` and the test script ran from `/tmp/test-zod-refine.mjs` rather than from within the workspace — the author's stated R: 0.92 is adopted as the final adjusted score. This is the most conservative defensible value; it is not an estimate.

### WLNK Application

With a single evidence item, WLNK is trivial:

```
R_eff = min(0.92) = 0.92
```

### Confidence Interval

```
evidence_count = 1
Lower = 0.92 - (0.10 / sqrt(1)) = 0.92 - 0.10 = 0.82
Upper = min(0.92 + (0.05 / sqrt(1)), 1.0) = min(0.97, 1.0) = 0.97
```

The wide interval [0.82, 0.97] reflects that a single evidence item cannot narrow uncertainty much regardless of its quality. Additional independent evidence (e.g., a test running directly inside the workspace against the installed Zod v4 binary) would narrow this interval significantly.

### Weakest Link Analysis

- **Weakest Evidence**: ev-internal-test-upstream-desired-arrival-validation-2026-06-01
- **Score**: 0.92
- **Reason**: The live Zod refine test was executed outside the project workspace using the v3/v4 compatible API surface rather than running `pnpm --filter @delivery/schemas test` against the actual installed `zod@^4.0.0` binary. While the `.refine()` + `path` API is documented as identical across v3 and v4, the indirect execution introduces a small congruence gap that the evidence author correctly penalised.
- **Mitigation**: Add a unit test in `packages/schemas` (e.g., `src/trip.test.ts`) that imports `GenerateTripInputSchema` and `TripPreviewInputSchema` directly and asserts at-boundary, beyond-boundary, and within-boundary behaviour. Running this test as part of `pnpm --filter @delivery/schemas test` would produce CL3 evidence with an unadjusted R of 1.00, raising R_eff to 1.00 and narrowing the confidence interval to [0.95, 1.00].

### Dependency Tree

```
[upstream-desired-arrival-validation R:0.92]
  └── depends_on: (none)
```

No dependency propagation required. `depends_on: []` in hypothesis frontmatter.

### Bias Assessment

- [ ] **Pet Idea Bias**: Not present. The hypothesis explicitly frames itself as complementary defence-in-depth ("not a standalone fix"), acknowledges that `hos.ts` is unaffected, and identifies two co-hypotheses that address the root cause. There is no overstated importance claim.
- [ ] **NIH Bias**: Not present. The approach (Zod `refine` at the shared-schemas layer) is the canonical pattern for this stack and is the most natural point of enforcement. No viable external alternative (e.g., database constraint, route-level guard) was dismissed without examination — the schema layer is objectively the lowest-cost, broadest-coverage enforcement point for this project.
- [ ] **Confirmation Bias**: Mild flag. The evidence catalogue contains one item (a supporting test). There is no failure-scenario evidence (e.g., a test confirming that the old schema without the refine accepts bad inputs and produces a broken timeline). The validation narrative is entirely positive. This is acceptable given that the "failure of the old code" is the anomaly that motivated the hypothesis, and codebase inspection confirmed the absence of the bound — but a second evidence item documenting a negative case would improve rigour.

### Risk Summary

R_eff 0.92 reflects high but not complete confidence. The dominant risk is the single-evidence basis: the proposed `z.refine` was tested against the Zod API outside the project workspace, not via an in-workspace automated test. The fix is logically sound, schema-level, and non-breaking for all existing fixtures, so the probability of a regression is very low. The main open action is to add a unit test in `packages/schemas` that runs inside the project to convert the indirect CL3 evidence into a direct, unadjusted CL3 score and push R_eff to 1.00.
