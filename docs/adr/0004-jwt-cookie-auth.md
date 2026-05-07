# ADR-0004: JWT в HTTP-only Cookie для аутентификации

## Status
Accepted

## Context
Dispatch Manager'ы аутентифицируются в административном разделе `/admin/*`. Нужно выбрать механизм хранения сессии на клиенте.

## Decision
Сессия хранится в JWT (HS256, TTL 7 дней) в `httpOnly` cookie с именем `auth`. Параметры cookie: `SameSite=Lax, Secure=true (prod), path=/`. На сервере JWT верифицируется при каждом запросе, с проверкой существования user в БД.

## Alternatives Considered

- **JWT в localStorage** — уязвим к XSS; любой JS-код на странице читает токен.
- **Server-side sessions (Redis/DB)** — добавляет stateful-зависимость (Redis) или нагрузку на БД. Избыточно для MVP с одним инстансом.
- **OAuth2/OIDC (внешний провайдер)** — нет самостоятельной регистрации пользователей; Dispatch Manager'ы создаются вручную через seed-скрипт. OAuth overhead неоправдан.
- **Stateless refresh-токены** — усложняет логику (rotation, revocation). При TTL 7 дней и ручной регистрации достаточно одного JWT.

## Consequences

**Positive:**
- `httpOnly` защищает токен от XSS-атак.
- `SameSite=Lax` обеспечивает базовую CSRF-защиту.
- Stateless — нет зависимости от Redis или сессионной таблицы.
- Простая реализация: `hono/jwt` + `hono/cookie`.

**Negative:**
- Нет мгновенного отзыва токена (refresh/revoke). При компрометации токен остаётся валидным до TTL.
- HS256 — симметричный ключ; компрометация `JWT_SECRET` — компрометация всех сессий.
- Нет rate-limiting на `/auth/login` (отложено, см. U-3 в specs).

## Trade-offs
Простота и отсутствие внешних зависимостей важнее granular revocation. Реальный сценарий компрометации JWT_SECRET требует смены ключа + принудительного logout — приемлемо для текущего масштаба.
