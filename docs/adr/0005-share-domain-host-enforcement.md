# ADR-0005: Принудительный Domain Enforcement через Host Header + 421

## Status
Superseded by [ADR-0006](0006-host-to-brand-resolution-uniform-404.md)

## Context
Share Pages должны открываться только на домене конкретного бренда (`delivery.brand1.com/s/:hash`), а не на общем admin-домене. Если пользователь открывает ссылку через неправильный домен, нужно его перенаправить.

## Decision
`GET /share/:hash` проверяет, что HTTP-заголовок `Host` совпадает с `brand.shareDomain`. При несовпадении возвращает HTTP 421 (`Misdirected Request`) с телом `{redirectTo: "https://<correct-domain>/s/<hash>"}`. Клиент при получении 421 делает `window.location.replace(redirectTo)`.

## Alternatives Considered

- **302 Redirect с сервера** — корректен семантически, но требует знания протокола (http vs https) на сервере. С on-demand TLS каждый бренд — HTTPS, но сервер не знает точный URL клиента. 421 перекладывает это на клиента.
- **Без enforcement (возвращать данные любому Host)** — нарушает изоляцию брендов: данные одного бренда открываются на чужом домене.
- **301 Permanent Redirect** — небезопасен: браузер кэширует и повторяет редирект при смене shareDomain.
- **CORS-ограничения** — не применимы для прямого GET, только для fetch.

## Consequences

**Positive:**
- Данные Share Page всегда отображаются на домене правильного бренда.
- Клиент сам строит целевой URL через `window.location.replace` — нет зависимости от серверного знания о протоколе.
- 421 — семантически корректный статус по RFC 7540 §9.1.2 (Misdirected Request).
- Redirect прозрачен для пользователя (не создаёт history entry).

**Negative:**
- Требует корректной обработки 421 в React-компоненте (иначе пользователь видит ошибку).
- JavaScript-disabled browsers не получат redirect.
- При смене shareDomain старые share-ссылки будут делать бесконечный redirect (не задокументировано в API).

## Trade-offs
Строгая изоляция брендов по домену важнее удобства при редких случаях прямого доступа по неправильному URL.
