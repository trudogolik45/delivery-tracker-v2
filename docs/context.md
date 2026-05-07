# Delivery Tracker

Система трекинга доставок: Dispatch Manager'ы управляют брендами и поездками, конечные получатели видят статус через публичные share-страницы.

## Language

**Dispatch Manager**:
Пользователь системы — сотрудник логистической компании, управляющий брендами, грузами и поездками.
_Avoid_: Admin, User, Operator

**Brand**:
Торговая марка, под которой ведутся доставки. Имеет уникальный slug и share-домен.
_Avoid_: Tenant, Account, Organization

**Brand Ownership**:
Отношение «один Dispatch Manager владеет многими брендами». У каждого бренда ровно один владелец.
_Avoid_: Brand membership, Brand access

**Cargo**:
Груз, привязанный к конкретному бренду. Содержит описание и фотографии.
_Avoid_: Shipment, Package, Delivery

**Trip**:
Конкретная поездка по доставке груза. Привязана к бренду и грузу.
_Avoid_: Delivery, Route, Order

**Share Page**:
Публичная страница (без аутентификации) для конечного получателя, где видно статус поездки.
_Avoid_: Tracking page, Customer view

## Relationships

- Один **Dispatch Manager** владеет многими **Brand**'ами
- Один **Brand** принадлежит ровно одному **Dispatch Manager**'у
- **Brand** нельзя удалить, пока он принадлежит Dispatch Manager'у с активными данными — сначала надо удалить бренд, потом DM (RESTRICT)
- Один **Brand** содержит много **Cargo** и много **Trip**'ов
- **Share Page** обращается к **Trip** без аутентификации, через share-токен

## Invariants

- Dispatch Manager видит только свои Brand'ы — чужой Brand выглядит как несуществующий (404, не 403)
- Dispatch Manager создаёт Brand самостоятельно — в момент создания он становится владельцем
- Передача Brand между Dispatch Manager'ами не поддерживается через API — только через БД вручную

## Example dialogue

> **Dev:** «Может ли Dispatch Manager зайти на /admin/b/чужой-slug/trips?»
> **Domain expert:** «Нет — он получит 404. Чужой Brand для него не существует.»

> **Dev:** «Если удалить Dispatch Manager'а, что будет с его Brand'ами?»
> **Domain expert:** «Нельзя удалить — база заблокирует. Сначала нужно решить судьбу брендов.»

## Flagged ambiguities

- «Admin» использовался в коде (`/admin/*` routes, `seed-admin`) — это технический префикс для аутентифицированного раздела, а не роль. Единственная роль пользователя в домене — **Dispatch Manager**.

## Non-obvious code comments

| Файл | Где | Почему |
|------|-----|--------|
| `apps/api/src/routes/admin.ts` | pause endpoint, WHERE guard | атомарный guard предотвращает double-pause race condition |
| `apps/api/src/routes/share.ts` | 421 vs 302 | сервер не знает протокол — клиент сам строит HTTPS-редирект |
| `apps/api/src/routes/internal.ts` | top | доступен только из docker-сети (Caddy), не наружу |
| `apps/api/src/storage/local.ts` | `url()` | host-relative URL — admin host не утекает на share-страницы |
| `apps/api/src/index.ts` | static middleware | раздача `/uploads/*` только в dev; в prod — Caddy |
