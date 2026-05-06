# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

This repo additionally has **`architecture.md`** at the root — it covers multi-tenancy, package hierarchy, DB schema, and storage decisions. Read it alongside `CONTEXT.md` when working on those areas.

## File structure

This is a **single-context repo**: one `CONTEXT.md` + `docs/adr/` at the repo root.

```
/
├── CONTEXT.md                ← создаётся лениво через /grill-with-docs
├── architecture.md           ← существующий дизайн-документ
├── docs/adr/
│   ├── 0001-*.md
│   └── 0002-*.md
├── apps/
│   ├── api/
│   └── web/
└── packages/
```

Несмотря на монорепо-структуру (`apps/api`, `apps/web`, `packages/*`), домен единый — multi-tenant трекинг доставок. Single-context layout достаточен.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
