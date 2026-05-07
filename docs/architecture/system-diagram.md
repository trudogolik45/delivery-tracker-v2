# System Architecture Diagram

> Актуальное состояние на 2026-05-07. Воспроизведено из кода (Architecture Designer).

---

## Компонентная диаграмма

```mermaid
graph TD
    subgraph Browser["Браузер"]
        SPA["React SPA\n(Vite 8 / TanStack Router)"]
    end

    subgraph Server["VPS — Hetzner CPX21"]
        subgraph Docker["Docker Compose"]
            Caddy["Caddy 2.11\n(Reverse Proxy / On-demand TLS)"]

            subgraph API["api:3000 (Hono 4)"]
                AuthR["/auth/*\nJWT cookie"]
                AdminR["/admin/*\nCRUD (requireAuth)"]
                BrandR["/admin/b/:slug/*\nBrand-scoped (requireAdminBrand)"]
                ShareR["/share/:hash\nPublic (Host-enforced)"]
                InternalR["/internal/validate-domain\nCaddy TLS hook"]
                StorageSvc["LocalStorage\n(SHA256-addressed)"]
            end

            WebSvc["web:80\n(Nginx / static SPA)"]

            PG[("PostgreSQL 18\n5 tables")]
        end

        subgraph Volumes["Docker Volumes"]
            UploadsVol[("cargo_uploads\n/srv/uploads")]
            PGVol[("postgres_data")]
            CaddyData[("caddy_data\ncaddy_config")]
        end
    end

    subgraph External["Внешние сервисы"]
        Mapbox["Mapbox\nDirections + Geocoding APIs"]
        LetsEncrypt["Let's Encrypt\nACME"]
    end

    Browser -->|"HTTPS /s/:hash\n(brand domain)"| Caddy
    Browser -->|"HTTPS /admin/*\n(admin domain)"| Caddy

    Caddy -->|"/uploads/*\nread-only"| UploadsVol
    Caddy -->|"ACME validation"| LetsEncrypt
    Caddy -->|"ask: is domain registered?\n(docker-internal only)"| InternalR
    Caddy -->|"/admin/* /auth/*\n/share/*"| API
    Caddy -->|"/* (SPA)"| WebSvc

    AdminR --> BrandR
    BrandR --> PG
    AuthR --> PG
    ShareR --> PG
    InternalR --> PG
    StorageSvc --> UploadsVol
    BrandR --> StorageSvc
    BrandR --> Mapbox
    PG --> PGVol
```

---

## Поток создания Trip

```mermaid
sequenceDiagram
    actor DM as Dispatch Manager
    participant Web as React SPA
    participant API as Hono API
    participant Mapbox as Mapbox Directions
    participant DB as PostgreSQL

    DM->>Web: Шаг 1: выбрать Cargo
    DM->>Web: Шаг 2: ввести маршрут (origin, destination, waypoints)
    DM->>Web: Шаг 3: ввести время отправки + желаемое прибытие
    Web->>API: POST /admin/b/:slug/trips/preview
    API->>Mapbox: GET /directions/v5 (polyline + distance)
    Mapbox-->>API: polyline, totalDistance
    API->>API: buildTimeline(startedAt, distance, desiredArrival) [HOS rules]
    alt desiredArrival невозможен
        API-->>Web: 422 {error, minimumArrival}
        Web-->>DM: Показать "Use minimum arrival time"
    else OK
        API-->>Web: {trip: {polyline, segments, ...}}
        Web-->>DM: Шаг 4: показать карту preview
    end
    DM->>Web: "Create trip"
    Web->>API: POST /admin/b/:slug/trips
    API->>Mapbox: GET /directions/v5 (повторно)
    API->>API: generateTrip → buildTimeline
    API->>DB: INSERT trips (shareHash=nanoid(16), routeGeometry, timeline)
    API-->>Web: {tripId, shareHash}
    Web->>DM: Redirect → /admin/b/:slug/trips/:tripId
```

---

## Поток открытия Share Page

```mermaid
sequenceDiagram
    actor Customer as Получатель груза
    participant DNS as DNS / Caddy
    participant API as Hono API
    participant DB as PostgreSQL

    Customer->>DNS: GET https://delivery.brand1.com/s/abc123
    DNS->>API: Caddy: ask /internal/validate-domain?domain=delivery.brand1.com
    API->>DB: SELECT id FROM brands WHERE share_domain=?
    DB-->>API: row found
    API-->>DNS: 200 OK
    DNS->>DNS: ACME → Let's Encrypt (first time only)
    DNS->>API: GET /share/abc123\nHost: delivery.brand1.com
    API->>DB: SELECT trips JOIN cargo JOIN brands WHERE share_hash=?
    DB-->>API: row (с routeGeometry, timeline, cargo data)
    alt Host != brand.shareDomain
        API-->>Customer: 421 {redirectTo: "https://..."}
        Customer->>Customer: window.location.replace(redirectTo)
    else OK
        API-->>Customer: ShareResponse {trip, cargo}
        Customer->>Customer: Render TripMap (MapLibre + interpolate.ts)
    end
```

---

## Модель данных

```mermaid
erDiagram
    users {
        uuid id PK
        text email UK
        text password_hash
        timestamp created_at
    }

    brands {
        uuid id PK
        text slug UK
        text share_domain UK
        text name
        uuid owner_id FK
        timestamp created_at
    }

    cargo {
        uuid id PK
        uuid brand_id FK
        text title
        jsonb fields
        uuid[] photo_upload_ids
        timestamp created_at
    }

    trips {
        uuid id PK
        uuid brand_id FK
        uuid cargo_id FK
        text share_hash UK
        jsonb origin
        jsonb destination
        jsonb waypoints
        timestamp starts_at
        timestamp desired_arrival
        jsonb pauses
        jsonb route_geometry
        jsonb timeline
        timestamp created_at
    }

    uploads {
        uuid id PK
        text storage_key UK
        text mime_type
        integer size_bytes
        text sha256
        timestamp created_at
    }

    users ||--o{ brands : "owns"
    brands ||--o{ cargo : "has"
    brands ||--o{ trips : "has"
    cargo ||--o{ trips : "attached to"
    uploads }o--o{ cargo : "photo_upload_ids[]"
```

---

## Пакетная DAG (monorepo)

```mermaid
graph LR
    schemas["@delivery/schemas\n(Zod contracts)"]
    simulation["@delivery/simulation\n(generate + interpolate)"]
    api["@delivery/api\n(Hono server)"]
    web["@delivery/web\n(React SPA)"]
    tsconfig["@delivery/tsconfig\n(TS base configs)"]

    schemas --> simulation
    simulation --> api
    simulation --> web
    schemas --> api
    schemas --> web
    tsconfig --> api
    tsconfig --> web
    tsconfig --> schemas
    tsconfig --> simulation

    style schemas fill:#e8f4fd
    style simulation fill:#fff3e0
```

**Правило**: зависимости строго снизу вверх. `generate.ts` — Node-only (Mapbox API). `interpolate.ts` — browser-safe.
```
