# TODO — index of follow-ups

> Индекс отложенных задач. Каноничный трекер проекта — **bd (beads)**; этот файл
> — лёгкий человекочитаемый индекс. При закрытии задачи убирай её отсюда.

| # | bd | Area | Задача | Источник |
|---|------|------|--------|----------|
| 1 | `delivery-tracker-v2-5qb` | web | Удалить мёртвую ветку обработки `421` на share-странице | [ADR-0006](docs/adr/0006-host-to-brand-resolution-uniform-404.md) |

---

## 1. Удалить мёртвый `421`-handler в `s.$hash.tsx`

**Файл:** `apps/web/src/routes/s.$hash.tsx`

**Контекст.** Сервер `GET /share/:hash` резолвит бренд по `Host` и отдаёт
единообразный `404` (anti-oracle); он **никогда не возвращает `421`**
(`grep -rn 421 apps/api/src` — ноль совпадений, включая тесты). Ветка
`421 → window.location.replace(redirectTo)` — наследие отклонённого
[ADR-0005](docs/adr/0005-share-domain-host-enforcement.md), заменённого
[ADR-0006](docs/adr/0006-host-to-brand-resolution-uniform-404.md). Код мёртв.

**Что убрать:**
- стр. 13–14: `const REDIRECTING = Symbol('redirecting')` и тип `ShareResult`;
- стр. 19: `useQuery<ShareResult>` → `useQuery<ShareResponse>`;
- стр. 23–29: блок `if (res.status === 421) { … return REDIRECTING }`;
- стр. 39: `if (isLoading || data === REDIRECTING)` → `if (isLoading)`.

**Проверка:** `pnpm --filter @delivery/web typecheck` (предварительно сгенерировать
route tree — см. [`run-delivery-tracker`](.claude/skills/run-delivery-tracker/SKILL.md)),
`pnpm --filter @delivery/web lint`. Поведение share-страницы не меняется
(сервер 421 не отдавал).

**Тип:** чистый dead-code cleanup, отдельным коммитом (`refactor(web):`).
