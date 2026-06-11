# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах.

## Источники контекста

- **Архитектура**: [docs/architecture/README.md](docs/architecture/README.md)
- **Прод-операции**: [docs/runbook.md](docs/runbook.md)
- **Решения**: [docs/adr/](docs/adr/)
- **API контракт**: [docs/api/openapi.yaml](docs/api/openapi.yaml)

## Правила в `.claude/rules/`

Загружаются Claude Code в каждой сессии. Структура и AGENTS.md — синхронизированы через `/setup-rules`.

| Файл | Тема |
|---|---|
| [`delivery-tracker-v2-project.md`](.claude/rules/delivery-tracker-v2-project.md) | Стек, структура, команды, env-переменные, инварианты |
| [`delivery-tracker-v2-conventions.md`](.claude/rules/delivery-tracker-v2-conventions.md) | Git, code style, Zod v4, ESM `.js`-импорты, pnpm |
| [`delivery-tracker-v2-do-not-touch.md`](.claude/rules/delivery-tracker-v2-do-not-touch.md) | Защищённые / генерируемые файлы |
| [`delivery-tracker-v2-shell.md`](.claude/rules/delivery-tracker-v2-shell.md) | Не-интерактивные shell-флаги |

## Use Context7 MCP for Loading Documentation

Context7 MCP установлен глобально (плагин из маркетплейса Anthropic, доступен во всех проектах) и достаёт актуальную документацию с примерами кода. Используй `resolve-library-id` → `get-library-docs`, или сразу передавай известный ID ниже. По умолчанию запрашивай документацию для версий, закреплённых в проекте.

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

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
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

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
