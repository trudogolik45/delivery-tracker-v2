---
id: ev-codebase-analysis-fmcsa-14h-driving-window-and-30min-break-2026-06-01
hypothesis_id: fmcsa-14h-driving-window-and-30min-break
source: codebase-analysis
CL: 3
R: 0.88
created: 2026-06-01T00:00:00Z
expires: 2026-12-01T00:00:00Z
---

# Evidence: Codebase Analysis — 14-Hour On-Duty Window Gap Confirmed

## Methodology

1. Read `packages/simulation/src/hos.ts` in full to inspect all FMCSA constants and the `simulateMinimum` loop.
2. Read `packages/simulation/src/hos.test.ts` to assess existing test coverage of the 14h window constraint.
3. Read `docs/adr/0002-precomputed-trip-timeline.md` to verify scope boundaries (rolling 60/70h exclusion vs. per-shift 14h window).
4. Cross-checked the hypothesis method against the actual function signatures and data flow (`simulateMinimum` → `buildTimeline` → `distributeSlack`).

## Results

- Finding 1: `hos.ts` declares exactly five constants — `AVG_SPEED_MS`, `MAX_DRIVE_BEFORE_BREAK` (8h), `BREAK_DURATION` (30min), `MAX_DRIVE_PER_SHIFT` (11h), `SLEEP_DURATION` (10h). No `MAX_ONDUTY_WINDOW` constant exists. Confirmed absence.
- Finding 2: `simulateMinimum` tracks `t` (current time) and `dist` (distance) but has no `shiftStart` variable. The per-shift wall-clock ceiling is not enforced. Current maximum wall-clock per shift: 8h + 0.5h break + 3h = 11.5h — within 14h only because breaks are short and no loading/unloading segments exist in the current model.
- Finding 3: ADR-0002 explicitly excludes the "rolling 60/70h window" but does not exclude the 14h per-shift window, which is a distinct FMCSA constraint. The hypothesis correctly identifies this as in-scope.
- Finding 4: `hos.test.ts` has no assertion that `shiftEnd - shiftStart <= 14 * 3600`. The gap in test coverage matches the hypothesis's stated need for a new test.
- Finding 5: `distributeSlack` operates on the `Segment[]` output of `simulateMinimum` by stretching sleep segments. It does not inspect or depend on the presence of a 14h window check, confirming compositional safety.
- Finding 6: The proposed change (one new constant + `shiftStart` tracking inside the existing `while` loop) is minimal and consistent with the existing coding style (numeric constants at top of file, simple arithmetic inside the loop).

## Interpretation

- The hypothesis accurately describes a real gap in the current implementation: `simulateMinimum` enforces driving-duration limits but not the outer 14h on-duty clock window.
- The proposed fix is mechanically sound: a `shiftStart` timestamp reset at each shift entry, a `MAX_ONDUTY_WINDOW` ceiling check before emitting the second driving segment, and early shift termination if the window would be exceeded.
- The edge-case claim ("a single short shift is unaffected since 11.5h < 14h") is verified by direct arithmetic from the constants in the file.
- Existing tests will continue to pass for short trips; tests covering multi-stop or slow-loading scenarios with wall-clock > 11.5h per shift do not yet exist and will be needed.
- Risk is bounded to `packages/simulation` — no API routes or DB schema are affected.

## Source References

- `packages/simulation/src/hos.ts`: lines 1–9 (constants), lines 40–69 (`simulateMinimum` loop — no `shiftStart` or 14h check present)
- `packages/simulation/src/hos.test.ts`: full file — no test for 14h window ceiling
- `docs/adr/0002-precomputed-trip-timeline.md`: "HOS-модель упрощена: rolling 60/70h window не реализован" — confirms 14h per-shift window is not excluded
