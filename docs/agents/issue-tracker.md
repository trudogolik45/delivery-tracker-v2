# Issue Tracker

Issues для этого репо живут в **bd (beads)** — локальный issue tracker с собственным CLI. Git remote не настроен, GitHub/GitLab не используются.

## Как skills должны работать с issue'ами

Skill'ы (`triage`, `to-issues`, `to-prd`, `qa`) **не вызывают `gh` / `glab`**. Вместо этого:

### Создание

```bash
bd create \
  --title="Краткое summary" \
  --description="Зачем issue существует и что нужно сделать" \
  --type=task|bug|feature \
  --priority=2 \
  --labels="ready-for-agent"   # см. docs/agents/triage-labels.md
```

Priority — числовой 0–4 (0=critical, 4=backlog), **не** «high/medium/low».

Опциональные секции для качественных issue:
- `--acceptance="критерии приёмки"`
- `--design="дизайн-решения"`
- `--notes="дополнительный контекст"`
- `--validate` — проверить, что описание содержит обязательные секции

### Поиск и просмотр

```bash
bd ready              # доступные issue без блокеров
bd list --status=open
bd search <query>
bd show <id>
```

### Обновление

```bash
bd update <id> --claim                    # взять в работу
bd update <id> --labels="needs-info"      # сменить лейбл
bd update <id> --description="..."        # инлайн-апдейт
bd close <id1> <id2>                      # закрыть (несколько за раз эффективнее)
bd close <id> --reason="wontfix"
```

> **Не** использовать `bd edit` — открывает `$EDITOR` (vim/nano) и блокирует агента.

### Зависимости

```bash
bd dep add <issue> <depends-on>           # issue блокируется depends-on
bd blocked                                # все заблокированные
```

## Сессионный workflow

В начале сессии: `bd prime` восстанавливает контекст после компакта/clear.

В конце сессии (обязательно): `bd close <id1> <id2> ...` для всех завершённых issue, затем стандартный push-протокол из `CLAUDE.md` (раздел **Session Completion**).

Полный справочник команд — `bd prime` или `bd --help`.
