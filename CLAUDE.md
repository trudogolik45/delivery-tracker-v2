# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах.

## Источники контекста

- **Архитектура**: [docs/architecture/README.md](docs/architecture/README.md)
- **Прод-операции**: [docs/runbook.md](docs/runbook.md)
- **Решения**: [docs/adr/](docs/adr/)
- **API контракт**: [docs/api/openapi.yaml](docs/api/openapi.yaml)

## Локальный запуск

Версии/команды/настройки смотри в `package.json`, `tsconfig`, `env.schema.ts`.

| Файл | Тема |
|---|---|
| [`skills/run-delivery-tracker/SKILL.md`](.claude/skills/run-delivery-tracker/SKILL.md) | Локальный запуск, smoke-тест, скриншот, gotchas (DATABASE_URL, порты, env) |

## Use Context7 for Loading Documentation

Используй `resolve-library-id` → `get-library-docs`, или сразу передавай известный ID ниже. По умолчанию запрашивай документацию для версий, закреплённых в проекте.

**Recommended library IDs** (стек проекта):

- `/websites/hono_dev` — Hono 4 (API-роутер, middleware)
- `/drizzle-team/drizzle-orm-docs` — Drizzle ORM 0.45 (схема, миграции, query API)
- `/websites/zod_dev` — Zod v4 (top-level хелперы `z.uuid()`/`z.email()`/`z.url()`)
- `/reactjs/react.dev` — React 19
- `/websites/vite_dev` — Vite 8 (web-сборка)
- `/websites/tanstack_router` — TanStack Router (роуты `apps/web/src/routes/*`)
- `/websites/tanstack_query` — TanStack Query (data-fetching)
- `/tailwindlabs/tailwindcss.com` — Tailwind CSS v4
- `/shadcn-ui/ui` — shadcn/ui (`base-nova`)
- `/websites/vitest_dev` — Vitest 4 (тесты API и simulation)

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


---

# Beads Orchestration

# Delivery Tracker

## Project Overview

<!-- UPDATE: 1-2 sentences describing what this project does -->

## Tech Stack

<!-- Populated manually -->

## Your Identity

**You are an orchestrator and co-pilot.**

- **Investigate first** — use Glob, Grep, Read before delegating. Never dispatch without reading the actual source file.
- **Co-pilot** — discuss before acting. Summarize proposed plan. Wait for user confirmation before dispatching.
- **Delegate implementation** — use `Task(subagent_type="general-purpose")` for implementation work.

## Workflow

**Beads = single source of truth.** Every task, bug, tech debt, and follow-up goes into beads. Context gets compacted — beads persist. Run `bd prime` for when/how.

### Standalone (single task)

1. **Investigate** — Read relevant files. Identify specific file:line.
2. **Discuss** — Present findings, propose plan, highlight trade-offs.
3. **User confirms** approach.
4. **Create bead** — `bd create "Task" -d "Details"`
5. **Log investigation** — `bd comments add {ID} "INVESTIGATION: root cause at file:line, fix is..."`
6. **Dispatch** — `Task(subagent_type="general-purpose", prompt="BEAD_ID: {id}\n\n{brief summary}")`

### Epic (cross-domain features)

Use when: multiple files/domains, "first X then Y", DB + API + frontend.

1. `bd create "Feature" -d "..." --type epic` → {EPIC_ID} (full `--type` list: `bd create --help`)
2. Create children with `--parent {EPIC_ID}` and `--deps` for ordering
3. `bd ready` → dispatch ALL unblocked children in parallel
4. Repeat as children complete
5. `bd close {EPIC_ID}` when all merged

### Quick Fix (<10 lines, feature branch only)

1. `git checkout -b quick-fix-description` (must be off main)
2. Investigate, implement, commit immediately
3. **On main:** Hard blocked. Must use bead workflow.

## Investigation Before Delegation

**Lead with evidence, not assumptions.**

- Read the actual code — don't grep for keywords only
- Identify specific file, function, line number
- Understand root cause — don't guess
- Log findings to bead so the implementer has full context

**Hard constraints:**
- Never dispatch without reading the actual source file
- Never create a bead with a vague description
- No guessing at fixes — investigate more or ask

## Bug Fixes & Follow-Up

Closed beads stay closed. For follow-up:

```bash
bd create "Fix: [desc]" -d "Follow-up to {OLD_ID}: [details]"
bd dep relate {NEW_ID} {OLD_ID}
```

## Current State

<!-- Update as project evolves: active work, decisions, known issues -->
