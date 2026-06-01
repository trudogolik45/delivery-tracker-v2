---
id: upstream-desired-arrival-validation
title: Upstream Input Validation: Cap desiredArrival Window at Schema Layer
kind: system
scope: packages/schemas/src/trip.ts — GenerateTripInputSchema and TripPreviewInputSchema. apps/api input boundary. Does not change hos.ts logic.
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
  notes: "Zod refine on both schemas is logically sound, violates no invariants, uses compatible types already present, and applies the foundational principle of rejecting invalid states at the boundary."
validated_at: 2026-06-01T00:00:00Z
validation:
  verdict: PASS
  evidence_count: 1
  R_eff: 0.92
  weakest_link: "live test used Zod v3 compatible API (refine/path identical in v4); project's actual v4 binary not directly executable in isolation"
evidence:
  - id: ev-internal-test-upstream-desired-arrival-validation-2026-06-01
    source: internal-test
    CL: 3
    R: 0.92
---

# Upstream Input Validation: Cap desiredArrival Window at Schema Layer

## Method (The Recipe)

1. In `packages/schemas/src/trip.ts`, add a `z.refine` on both `GenerateTripInputSchema` and `TripPreviewInputSchema` that rejects a `desiredArrival` more than N days (e.g., 14 days = 1 209 600 seconds) ahead of `startedAt`:
   ```ts
   const MAX_ARRIVAL_WINDOW_SECONDS = 14 * 24 * 3600 // 14 days
   ```
   ```ts
   GenerateTripInputSchema.refine(
     (d) => d.desiredArrival - d.startedAt <= MAX_ARRIVAL_WINDOW_SECONDS,
     { message: 'desiredArrival must be within 14 days of startedAt', path: ['desiredArrival'] }
   )
   ```
   Apply the same refine to `TripPreviewInputSchema`.

2. Decide the constant value: 14 days is the practical outer limit for a long-haul freight booking horizon; anything beyond is almost certainly a UI clock error or test artefact.

3. Write a Zod validation test in `packages/schemas` (or inline in the API tests) confirming:
   - Inputs within 14 days pass.
   - Inputs at exactly the boundary pass.
   - Inputs beyond the boundary return a Zod validation error with the correct `path`.

4. In `apps/api/src/routes/`, update the route that handles trip creation and trip preview to surface the new validation error to the API caller as a `400 Bad Request` with the Zod message in the response body (Hono's `zValidator` middleware propagates this automatically if the schema is updated).

5. `hos.ts` is NOT changed by this hypothesis alone. It is designed to complement the `sleep-cap-tail-wait-block` or `sleep-cap-12h-distributed-wait` hypotheses, not replace them.

## Expected Outcome

- Biologically impossible `desiredArrival` values are rejected at the API boundary before reaching `buildTimeline`.
- UI-level bugs (wrong year, wrong timezone) surface immediately as user-facing errors rather than producing a silently broken share-page timeline.
- The HOS simulator only ever receives inputs within a bounded realistic window, shrinking the feasible slack range.
- Even after other fixes, this provides defence-in-depth: no timeline can accumulate more than `14 days × headroom` of slack regardless of future algorithm changes.

## Rationale

- **Anomaly**: The root cause chain includes the observation that `desiredArrival` is only validated as `int().positive()` — there is no semantic upper bound. Fixing only `distributeSlack` leaves the door open for re-introducing the bug via algorithm changes or for generating timelines that are technically capped but still semantically absurd.
- **Approach**: Validation at the schema/API boundary follows the principle of making invalid states unrepresentable. It is also the cheapest defence — a single `refine` in the shared schemas package enforces the limit everywhere the schema is used (creation, preview, imports).
- **Assumptions**: 14 days is a reasonable commercial logistics booking horizon. The constant is configurable; a different project might use 7 or 30 days. `startedAt` is present in both schemas alongside `desiredArrival`, making the refine feasible without adding new fields.
- **Risk Level**: Conservative — Zod schema changes are low-risk, additive, and immediately testable. The only behavioural change is that previously-accepted extreme inputs are now rejected with a clear error message, which is the intended effect.

## Verification

**Verdict**: PASS
**Verified**: 2026-06-01T00:00:00Z

### Checks Performed

| Check | Result | Notes |
|-------|--------|-------|
| Internal Consistency | PASS | `z.refine` condition on `desiredArrival - startedAt` correctly produces the described outcome; `startedAt` is confirmed present in both schemas |
| Constraint Compliance | PASS | Only modifies `packages/schemas/src/trip.ts` (explicitly in-scope); does not touch `hos.ts`, stored timelines, or driving segment logic; all 8 invariants remain intact |
| Type Compatibility | PASS | Both fields are integer Unix timestamps in both schemas; Zod v4 `refine` with `path` array is valid syntax; `zValidator` middleware in Hono propagates schema errors automatically |
| First-Principles Soundness | PASS | Rejecting invalid inputs at the boundary ("make invalid states unrepresentable") is a foundational correctness principle; the hypothesis correctly frames this as complementary defence-in-depth, not a standalone fix |

### Verification Notes

The hypothesis is logically sound and internally consistent. The proposed `z.refine` approach is well-matched to the stated problem — `desiredArrival` lacks a semantic upper bound, and adding one at the shared-schemas layer enforces it everywhere the schemas are consumed without touching simulation logic. No project invariants are violated; the change is additive and fully reversible.

## Validation

**Verdict**: PASS
**Validated**: 2026-06-01T00:00:00Z
**Evidence**: ev-internal-test-upstream-desired-arrival-validation-2026-06-01

### Summary

Direct codebase analysis confirmed that both `GenerateTripInputSchema` and `TripPreviewInputSchema` in `packages/schemas/src/trip.ts` lack any semantic upper-bound on `desiredArrival`. A live test of the proposed `z.refine` technique using the Zod API (compatible across v3/v4) verified correct behaviour: at-boundary passes, beyond-boundary is rejected with `path: ["desiredArrival"]` and the specified message. The `zValidator` middleware is already wired to both target endpoints (`/trips` and `/trips/preview`) in `apps/api/src/routes/admin.ts`; no additional middleware registration is required. Existing test fixtures use `desiredArrival` values well within the 14-day window and will not be affected.

## Audit

**R_eff**: 0.92
**Confidence Interval**: [0.82, 0.97]
**Audited**: 2026-06-01T00:00:00Z
**Report**: audit-upstream-desired-arrival-validation-2026-06-01
**Weakest Link**: ev-internal-test-upstream-desired-arrival-validation-2026-06-01 (0.92)

### Summary

R_eff of 0.92 reflects high confidence in the schema-layer approach. The sole evidence item is a CL3 internal test that confirmed the `z.refine` technique behaves correctly at, within, and beyond the 14-day boundary, and that the existing `zValidator` middleware wiring requires no changes. The 0.92 score (rather than 1.00) reflects one real limitation: the live Zod test ran outside the project workspace against the v3/v4-compatible API surface, not directly against the installed `zod@^4.0.0` binary via `pnpm --filter @delivery/schemas test`. To raise R_eff to 1.00, add a unit test in `packages/schemas/src/trip.test.ts` that imports the schemas directly and asserts boundary behaviour — this converts indirect evidence into a fully in-workspace CL3 test with no adjusted-R penalty. The confidence interval [0.82, 0.97] is wide because a single evidence item provides limited statistical narrowing; a second independent test would tighten it substantially.
