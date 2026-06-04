# delivery-tracker Plans.md

作成日: 2026-06-05

> Task ledger (harness `harness-plan`/`harness-work`). Product contract precedence: `spec.md > sub-spec > Plans.md`.

---

## Planning validation (Phase: CI baseline)

- **team_validation_mode**: `subagent` — 4 independent perspectives (Architecture/Correctness, Security/Supply-chain, QA/Test-infra, Skeptic) run via Workflow fan-out, verified against the repo.
- **Spec skip reason**: CI is verification-only infrastructure. It adds no user-visible behavior, API, data model, permission, billing, or external-integration contract. No root `spec.md` exists and none is warranted for this change — the product contract is unchanged. (Per harness two-SSOT rule: `Spec skip reason` recorded in place of a `Spec delta`.)
- **Memory check**: `bd memories ci|github-actions|workflow` → no prior CI/CD decision exists. `.github/` absent entirely. Not reinventing a wheel.
- **Lint/formatter baseline**: prettier 3.8.3 + `format:check` already present; ESLint configured for `apps/web`. No source code changes in this plan (YAML + config only) → no pre-implementation lint-setup task required.
- **DoD principle**: every CI task's "done" = the workflow actually runs **green on a real PR**, not just "file written".
- **Progress (2026-06-05)**: **1.1 ✅** — frozen-lockfile install reproduced in `node:24-slim` (Debian 12, Node v24.16.0): `Lockfile is up to date`, 623 pkgs added, esbuild/msw postinstalls OK, exit 0 (aarch64). **1.2 ✅** — `ci.yml` committed `27adacf`; host gates all green: `pnpm -r lint` exit 0, `pnpm -r typecheck` exit 0, `pnpm -r --stream test` exit 0 (**115 tests** — schemas 4 / simulation 64 / api 47). **Residual → task 1.4**: same-arch x86_64 + real-PR green require a push (held for user). Container run was aarch64; x64 platform pkgs are statically present in the lock, and the staleness check is arch-independent. **Real CI (x86_64)**: first PR run RED — `apps/web` typecheck failed `TS2307` (`routeTree.gen.ts` absent in a clean checkout — gitignored TanStack-generated file); fixed in `7efbe5f` by generating the route tree (`pnpm --filter @delivery/web exec vite build`) before typecheck. Re-run **GREEN in 52s** (PR #6, run 26981125467). **1.4 ✅**.

### Verified constraints (do not re-derive)

- Root scripts: `lint`=`pnpm -r lint`, `typecheck`=`pnpm -r typecheck`. **No root `test`** → CI must use `pnpm -r test`.
- Tests need **no DB and no secrets**: every `apps/api` route/auth test mocks `../db/index.js` / `../env.js` with fixture strings. `pnpm -r test` covers api + schemas + simulation; `web` is silently skipped (no test script).
- `pnpm -r lint` currently lints **only `apps/web`** (sole package with a `lint` script) — known pre-existing gap, documented, not blocking.
- `packageManager` = `pnpm@10.33.2` (corepack hash); `engines.node` = `>=24`; no `.nvmrc`. `onlyBuiltDependencies` = `[esbuild, msw]` (note: `@node-rs/argon2` intentionally absent — tests mock it).
- pnpm-lock.yaml (238 KB) generated on macOS → must be confirmed installable on Linux under `--frozen-lockfile`.

### Explicitly cut / deferred (rejected by review)

- ❌ Build matrix (single target: ubuntu-latest + Node 24).
- ❌ Postgres service container / migrations in CI (tests mock the DB).
- ❌ Any `DATABASE_URL`/`JWT_SECRET`/secret in the test job.
- ❌ `pnpm -r build` gate now — would expose the missing `@node-rs/argon2` native build (see 2.3).
- ❌ `pull_request_target`, `id-token: write`, deploy scopes (deploy is out of scope).

---

## Phase 1: CI baseline — lint + typecheck + test (Required)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 1.1 | Pre-flight: confirm the macOS-generated lockfile installs on Linux/Node 24. Run `docker run --rm -v "$PWD":/w -w /w node:24-slim sh -c "corepack enable && pnpm install --frozen-lockfile"` (or treat the first CI run as the gate). `[tdd:skip:infra-no-app-logic]` | `pnpm install --frozen-lockfile` exits 0 on Linux+Node 24 — no `ERR_PNPM_OUTDATED_LOCKFILE` / missing optional platform pkg | - | cc:完了 |
| 1.2 | Add `.github/workflows/ci.yml`: single job `ubuntu-latest`; steps = `actions/checkout` → `pnpm/action-setup@<sha>` (v4, version `10.33.2`) → `actions/setup-node@<sha>` (v4, `node-version: 24`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm -r lint` → `pnpm -r typecheck` → `pnpm -r --stream test`. Triggers: `push:[main]` + `pull_request:[main]`. Top-level `permissions: contents: read`. `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.ref != 'refs/heads/main' }} }`. `timeout-minutes: 10`. Every `uses:` pinned to a 40-char commit SHA + `# vX.Y.Z` tag comment. Header comment documenting: web-only lint, no DB/secrets. `[tdd:skip:ci-config]` | `gh workflow view` / YAML parse OK **AND** a draft PR shows install+lint+typecheck+test steps all green | 1.1 | cc:完了 [27adacf, 7efbe5f] |
| 1.3 | Add `.github/dependabot.yml` for the `github-actions` ecosystem (weekly) so SHA pins don't rot. `[tdd:skip:config]` | Valid YAML; Dependabot recognized in repo Insights; opens a bump PR when an action SHA updates | 1.2 | cc:完了 [381b58c] |
| 1.4 | Verify end-to-end on a real PR: branch → PR → CI green; confirm a fork PR receives no secret access (token is read-only). `[tdd:skip:verification]` | Required check green on the PR; lint+typecheck+test all visible as executed in the run logs | 1.2 | cc:完了 [PR#6, run 26981125467] |

## Phase 2: Hardening & follow-ups (Recommended / Optional)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 2.1 | Add `pnpm run format:check` (prettier) as a 4th gate, after install. Catches drift that the local PostToolUse hook misses on human/direct-git commits. `[tdd:skip:formatting]` | Step green on formatted code; a deliberately mis-formatted file makes the step fail | 1.2 | cc:TODO |
| 2.2 | Close the lint-coverage gap: add a comment in `ci.yml` noting only `apps/web` is linted, and file a `bd` issue to add `lint` scripts (ESLint) to `apps/api`, `packages/schemas`, `packages/simulation`. `[tdd:skip:docs]` | Comment present in `ci.yml`; `bd` issue created listing the 3 packages | 1.2 | cc:TODO |
| 2.3 | Decide `@node-rs/argon2` build policy **before** any future `build` gate: either add it to `pnpm.onlyBuiltDependencies` (compile native binary in CI) or document the intentional omission (tests mock it). `[tdd:skip:infra]` | `package.json` either lists `@node-rs/argon2` in `onlyBuiltDependencies` or carries a comment explaining the omission | - | cc:TODO |
