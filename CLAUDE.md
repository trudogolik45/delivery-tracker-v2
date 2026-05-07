# delivery-tracker

Multi-tenant система трекинга доставок: pickup'ы → водители → share-страницы на брендовых доменах. Полный дизайн — в [docs/architecture/README.md](docs/architecture/README.md).

## Стек

- Node ≥24, pnpm 10 (закреплён через `packageManager` в корневом `package.json`)
- Postgres 18 (через docker compose)
- API: Hono 4 + Drizzle ORM 0.45 + pg + Zod v4
- Web: Vite 8 + React 19 + TypeScript 6 + Tailwind v4 + shadcn/ui (`base-nova`) + TanStack Router + TanStack Query
- Infra: docker compose (dev), Caddy + docker compose (prod, скелет)

## Команды

| Команда | Где |
|---|---|
| `pnpm dev:api` / `pnpm dev:web` | корень |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` | корень |
| `docker compose up -d` | корень (Postgres) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | `apps/api` |
| `pnpm dlx shadcn@latest add <name>` | `apps/web` |

> pnpm 10: используй `pnpm run <script>` или `pnpm --filter <pkg> <script>`, не голый `pnpm <script>`.

## Переменные окружения

| Переменная | dev (`apps/api/.env`) | prod (`.env.production`) |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | То же, хост `postgres` (не `localhost`) |
| `JWT_SECRET` | Подпись JWT | Подпись JWT |
| `MAPBOX_TOKEN` | Mapbox Directions (HOS) | Mapbox Directions (HOS) |
| `APP_DOMAIN` | — | Домен share-страниц |
| `ADMIN_DOMAIN` | — | Домен админки |
| `POSTGRES_PASSWORD` | — | Пароль прод-postgres |

## Конвенции

- **Git**: `feat(api|web|db|infra):` / `chore(infra):` / `docs(runbook):` / `fix:` — фаза в теле, не subject. Код + runbook в одном коммите. Никогда `--amend`/force-push/`--no-verify` без запроса.
- **Runbook sync**: любое отклонение от `docs/runbook.md` — синхронизировать обратно в том же ходе.
- **Smoke-тесты**: `curl`/`node`/`psql`-вариант обязателен; браузер — опционально поверх.

### Code style
- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) через `@delivery/tsconfig/base.json`.
- Zod **v4**: `z.uuid()`, `z.email()` — top-level, не `z.string().uuid()`.
- TS 6: не добавлять `baseUrl` — `paths` работает без него.
- API — ESM; импорты с `.js` (`./db/schema.js`).
- Drizzle pin: `drizzle-orm@^0.45`, `drizzle-kit@^0.31`.
- Общие схемы — в `@delivery/schemas`, не локально в роутах.

### Pnpm
- `auto-install-peers=true`.
- `pnpm.onlyBuiltDependencies` allow-list: `esbuild`, `msw`. Новый нативный пакет → допиши.

## Не трогать

- `pnpm-lock.yaml` — только через `pnpm install`
- `apps/web/src/routeTree.gen.ts` — генерируется TanStack Router
- `apps/api/src/db/migrations/` — не редактировать постфактум, только через `db:generate`
- `.env*` — никогда не комитить
- `dist/`, `node_modules/` — генерируемые
- `docs/runbook.md`, `docs/architecture/README.md` — только после согласования


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
