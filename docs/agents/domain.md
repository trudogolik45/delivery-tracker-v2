# Domain Documentation

Single-context repo pattern: one `docs/context.md` + `docs/adr/` directory.

- **[docs/context.md](../context.md)** — canonical domain glossary (Dispatch Manager, Brand, Trip, Cargo, Share Page). Defines terms and invariants to use in code, issues, and PRs.
- **[docs/adr/](../adr/)** — Architecture Decision Records, created lazily as decisions accumulate.

When naming things in code or issues, consult `docs/context.md` first to use the canonical term.
