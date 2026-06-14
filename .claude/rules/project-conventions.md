# Project Conventions

> Auto-extracted by `/project-discovery`. Source of truth for versions stays `package.json` / `tsconfig` / `env.schema.ts`.

## Tech Stack

### Runtime & Package Manager

- Node.js `>=24` (engine constraint in root `package.json`; CI pins `node-version: '24'`)
- pnpm `11.6.0` (exact, from `packageManager` field in root `package.json`; CI and Docker read it via corepack)
- Shared dependency versions live in a pnpm **catalog** (`pnpm-workspace.yaml`): `typescript`, `zod`, `@turf/*`, `vitest`, `eslint`, `@eslint/js`, `globals`, `typescript-eslint` — bump once there; packages reference `catalog:`. Native-build allowlist is `allowBuilds` in the same file (pnpm 11 dropped `pnpm.onlyBuiltDependencies`).
- Module system: ESM (`"type": "module"` in all `apps/*` and `packages/*`)
- TS target (base / API / simulation / schemas): `ES2022` (`packages/tsconfig/base.json`)
- TS target (web app): `es2023` (`apps/web/tsconfig.app.json`)
- TypeScript `~6.0.3` across **all** packages — pinned once via the pnpm catalog (was split TS 5.x / 6.x before the catalog migration)
- Postgres (Docker): `postgres:18-alpine` (`docker-compose.yml`)

### API Stack (`apps/api`)

- Hono `^4.12.25`
- `@hono/node-server` `^2.0.0`
- `@hono/zod-validator` `^0.7.6`
- Drizzle ORM `^0.45.2` — note: still on the `1.0.0-beta.x` track per project rules
- drizzle-kit `^0.31.10`
- pg (postgres driver) `^8.20.0`
- `@node-rs/argon2` `^2.0.2` (password hashing, installs via prebuilt platform binaries)
- nanoid `^5.1.11`
- dotenv `^17.4.2`
- tsx `^4.21.0` (runtime / watch dev server)
- `@turf/length` `^7.3.5` (via `catalog:`; also used directly in API)
- Zod `^4.4.3` (via `catalog:`)
- Drizzle dialect: `postgresql`, migrations output to `apps/api/src/db/migrations/`

### Web Stack (`apps/web`)

- React `^19.2.5` + react-dom `^19.2.5`
- Vite `^8.0.10`
- `@vitejs/plugin-react` `^6.0.1`
- TanStack Router `^1.168.26` + devtools `^1.166.13`
- `@tanstack/router-plugin` `^1.167.29` (Vite plugin, auto code-splitting enabled)
- TanStack Query `^5.100.6` + devtools `^5.100.6`
- Tailwind CSS `^4.2.4` (via `@tailwindcss/vite` `^4.2.4` — Vite plugin integration)
- shadcn CLI `^4.6.0` (devDependency); component style: `base-nova` per CLAUDE.md
- `@base-ui/react` `^1.4.1` (Base UI headless components)
- maplibre-gl `^5.24.0` (map rendering; no Mapbox — library is MapLibre)
- lucide-react `^1.14.0`
- clsx `^2.1.1`, tailwind-merge `^3.5.0`, class-variance-authority `^0.7.1`
- cmdk `^1.1.1`
- tw-animate-css `^1.4.0`
- `@fontsource-variable/geist` `^5.2.8`

### Shared Packages

- `@delivery/schemas` — Zod (via `catalog:` → `^4.4.3`)
- `@delivery/simulation` — `@turf/along` / `@turf/length` (via `catalog:` → `^7.3.5`); exports split: `./generate` (Node-only) / `./interpolate` (browser-safe)
- `@delivery/tsconfig` — shared `base.json` / `node.json` / `react.json` presets (no versioned external deps)

### Testing & Tooling

- Vitest `^4.1.5` (via `catalog:`; all four packages: `apps/api`, `apps/web`, `packages/schemas`, `packages/simulation`)
- Test environment: `node` in both `apps/api/vitest.config.ts` and `apps/web/vitest.config.ts`
- Prettier `3.8.3` (exact, root devDependency)
- ESLint `^10.2.1`, typescript-eslint `^8.59.1` — unified via `catalog:` (was `^8.59.1` / `^8.58.2` before the migration)
- `eslint-plugin-react-hooks` `^7.1.1`, `eslint-plugin-react-refresh` `^0.5.2` (web only)
- CI: GitHub Actions, `ubuntu-latest`, timeout 10 min (`ci.yml`); no test DB — all API tests mock `../db/index.js`

## Architecture

### Backend (API)

- **Architecture style**: Single Hono `app` instance in `apps/api/src/index.ts` with four mounted sub-routers: `/auth` (`authRoutes`), `/admin` (`adminRoutes`), `/internal` (`internalRoutes`), `/share` (`shareRoutes`). Admin routes are split further: a top-level `adminRoutes` for brand-agnostic endpoints, and a nested `brandScoped` sub-router mounted at `/b/:brandSlug` within it — `apps/api/src/routes/admin.ts`.

- **Request flow**:
  1. Conditional Hono logger (skips `/internal` paths to avoid leaking `INTERNAL_TOKEN`) — `index.ts:18-21`
  2. CORS middleware (`hono/cors`, origin is `PUBLIC_BASE` in prod, `localhost:5173` in dev) — `index.ts:28-34`
  3. Global `app.onError` catch-all returning `{ error: 'internal' }` 500 — `index.ts:36-39`
  4. Route dispatch to sub-router
  5. Within `/admin`: `requireAuth` on `adminRoutes.use('*')`, then for brand-scoped paths `requireAdminBrand` on `brandScoped.use('*')`, then optional `zValidator` per handler, then Drizzle query via `tenantDb(brand)` or direct `db`

- **AuthN / AuthZ**:
  - `requireAuth` (`apps/api/src/auth/middleware.ts`): reads `SESSION_COOKIE_NAME` cookie, verifies JWT via `verifySession`, then fetches the user row from `users` table and sets `c.set('user', user)`. Applied as `adminRoutes.use('*', requireAuth)` — covers all `/admin/*` routes.
  - `requireAdminBrand` (`apps/api/src/middleware/tenant.ts`): reads `:brandSlug` param, queries `brands` table with `AND ownerId = user.id`, sets `c.set('brand', row)`. Applied as `brandScoped.use('*', requireAdminBrand)` — all `/admin/b/:brandSlug/*` routes get both `requireAuth` then `requireAdminBrand`.
  - `/share/:hash` has no auth — public route scoped by `Host` header + hash lookup.
  - `/internal/*` uses timing-safe `INTERNAL_TOKEN` check (header `x-internal-token` or `?token=`) — `apps/api/src/routes/internal.ts:24-34`.
  - `/auth/login` has in-memory rate limiter per `ip:email` pair with constant-time argon2 dummy hash for missing users.

- **Validation**: `zValidator('json', Schema, onValidationError)` from `@hono/zod-validator` applied inline per handler as a middleware argument. `onValidationError` is a shared hook in `apps/api/src/middleware/validate.ts` that flattens Zod issues into `{ error: string }` with HTTP 400 — overrides the default `@hono/zod-validator` response shape. All schemas come from `@delivery/schemas` (never defined locally in route files). Validated data is consumed via `c.req.valid('json')`.

- **Data access**:
  - Global Drizzle instance `db` exported from `apps/api/src/db/index.ts` (single `pg.Pool`, `drizzle-orm/node-postgres`).
  - Tenant-scoped access via `tenantDb(brand): TenantDb` factory in `apps/api/src/db/tenant.ts`. Every method embeds `eq(<table>.brandId, brandId)` — provides `cargo`, `trips`, `uploads` namespaces. Routes under `brandScoped` must use `tenantDb(brand)` (enforced by arch test `admin.arch.test.ts`).
  - Direct `db` calls are permitted only for cross-tenant lookups: `brands` table in `requireAdminBrand`, `requireAuth`, `share.ts` host resolution, and `internal.ts` domain validation.
  - Pause/resume use atomic SQL JSON update with a `WHERE` guard to prevent double-pause/double-resume without a separate transaction — `db/tenant.ts:246-299`.

- **Error handling**: Global `app.onError` in `index.ts` logs and returns `{ error: 'internal' }` 500 for uncaught exceptions. Handlers return explicit `c.json({ error: '...' }, 4xx)` for all known failure paths. No `Result` type or `HTTPException` — plain `c.json` with status codes throughout. `HosError` from `@delivery/simulation/generate` is caught locally in trip creation handlers and mapped to 422.

- **Storage abstraction**:
  - Interface `Storage` in `apps/api/src/storage/types.ts`: `put`, `url`, `exists`, `delete`.
  - `LocalStorage` implementation in `apps/api/src/storage/local.ts`: files stored at `STORAGE_ROOT/<key[0..2]>/<key>` (two-char prefix sharding). `makeKey` = `sha256(data).<ext>`. `url(key)` returns a host-relative `/uploads/…` path — intentionally avoids leaking admin host into share pages.
  - DB stores `storageKey` (the content-addressed filename); `storage.url(key)` is called at read time to build the URL — never persisted.
  - Singleton `storage` exported from `apps/api/src/storage/index.ts`, wired to `env.STORAGE_ROOT`.

- **DI / wiring**: No IoC container. All dependencies are module-level singletons: `db` (db/index.ts), `storage` (storage/index.ts), `env` (env.ts). Sub-routers import these directly. `tenantDb(brand)` is a plain factory function called per-request with the resolved brand from context. No constructor injection.

### Frontend (Web)

- **Architecture style**: File-based routing via TanStack Router. Route files live in `apps/web/src/routes/`; the router tree is auto-generated into `apps/web/src/routeTree.gen.ts` (do not edit directly). The router is created in `apps/web/src/main.tsx` with `createRouter({ routeTree, context: { queryClient } })`, passing the TanStack Query client as router context so `beforeLoad` hooks can call `context.queryClient.ensureQueryData(...)`.

- **Routing conventions**:
  - Dotted filenames encode path hierarchy: `b.$brandSlug.trips.index.tsx` → `/admin/b/:brandSlug/trips/`.
  - Dynamic segments use `$param` syntax (e.g. `s.$hash.tsx`, `b.$brandSlug.*`).
  - Layout routes are named `route.tsx` (e.g. `apps/web/src/routes/admin/route.tsx`); they render `<Outlet />` for child routes.
  - `__root.tsx` defines the root layout via `createRootRouteWithContext<{ queryClient: QueryClient }>()`.

- **Data fetching**: TanStack Query (`@tanstack/react-query`) throughout. `queryOptions` objects are defined alongside the feature they serve — `meQueryOptions` lives in `apps/web/src/lib/auth.ts`. Route-level components call `useQuery(...)` inline (e.g. `b.$brandSlug.trips.index.tsx` line 26). Route guards pre-fetch via `context.queryClient.ensureQueryData(meQueryOptions)` inside `beforeLoad`. Share page (`s.$hash.tsx`) uses `staleTime: 25_000` + `refetchInterval: 30_000` for live position polling.

- **API client pattern** (`apps/web/src/lib/api.ts`): Two thin wrappers over `fetch`:
  - `apiRequest(path, options)` — raw `Response`, always sends `credentials: 'include'` (cookie-based session). Base URL from `VITE_API_BASE_URL` env var, defaulting to `http://localhost:3000`.
  - `apiJson<T>(path, options, parser?)` — throws typed `ApiError(status, message)` on non-OK; accepts an optional Zod parser. Callers pass generic type or a parser function.

- **Auth handling** (`apps/web/src/lib/auth.ts`): Session is cookie-based (`credentials: 'include'`; no token storage in JS). Auth state lives in TanStack Query under key `['auth', 'me']` via `meQueryOptions`. Guards implemented in `beforeLoad` on layout routes: `/admin/route.tsx` redirects unauthenticated users to `/login`; `login.tsx` redirects already-authenticated users to `/admin`. `useLogin` / `useLogout` are `useMutation` hooks that update the query cache directly on success (`queryClient.setQueryData(meQueryKey, ...)`). Schemas (`LoginInputSchema`, `MeResponseSchema`, `LoginResponseSchema`) are validated client-side via Zod parse calls.

- **UI layer**: Components in `apps/web/src/components/ui/` use the `base-nova` variant of shadcn/ui — primitives come from `@base-ui/react/*` (e.g. `ButtonPrimitive` from `@base-ui/react/button`), styled with `cva` + `class-variance-authority` and Tailwind CSS v4. Icons from `lucide-react` (e.g. `Plus`, `MapPin`, `Clock`, `ArrowLeft` in the trips list). Map rendering uses `maplibregl` with OSM tiles (`apps/web/src/components/TripMap.tsx`).

- **State management**: No global client state store. All server state in TanStack Query. Local UI state via `useState` (e.g. form fields in `login.tsx`). `TripMap` holds a `now` tick via `useState` + `setInterval` for real-time marker animation.

- **`@delivery/schemas` consumption**: Types and Zod schemas imported directly from the package. Examples: `import type { TripListItem } from '@delivery/schemas'` in the trips list; `ShareResponseSchema.parse(...)` used for runtime validation in `s.$hash.tsx`; `TripStatus` type re-exported from `apps/web/src/lib/trip-status.ts`; `Trip` type consumed by `TripMap.tsx`. Auth schemas (`LoginInputSchema`, `MeResponseSchema`, `LoginResponseSchema`) parsed in `lib/auth.ts`. The client does not define its own Zod schemas — all contracts come from `@delivery/schemas`.

## Structure

```
delivery-tracker/
├── apps/
│   ├── api/                          # Hono 4 Node.js backend, served via @hono/node-server
│   │   └── src/
│   │       ├── index.ts              # App composition: CORS (admin-domain origin), logger (suppressed on /internal), 4 route mounts (/auth /admin /internal /share), SIGINT handler, dev static for /uploads/*
│   │       ├── env.ts                # Runtime env validation (Zod); process.exit on failure — never import in tests
│   │       ├── env.schema.ts         # EnvSchema export (safe to import in tests)
│   │       ├── uploads.ts            # Multipart upload handling
│   │       ├── uploads.test.ts       # Co-located test
│   │       ├── logger-redaction.test.ts  # Confirms PII/token scrubbing in pino logger
│   │       ├── env.test.ts           # Env schema validation tests
│   │       ├── auth/                 # JWT issuance, argon2 password check, per ip:email rate-limiter, requireAuth middleware, /auth route handler
│   │       │   ├── jwt.ts / jwt.test.ts
│   │       │   ├── middleware.ts     # requireAuth (Hono middleware)
│   │       │   ├── passwords.ts
│   │       │   ├── rate-limiter.ts / rate-limiter.test.ts
│   │       │   └── routes.ts / routes.test.ts   # POST /auth/login, POST /auth/logout, GET /auth/me
│   │       ├── db/                   # Drizzle ORM: schema definition, tenant-scoped query helpers, SQL migrations
│   │       │   ├── schema.ts         # Source-of-truth table definitions (brands, trips, cargo, users…)
│   │       │   ├── index.ts          # db client export
│   │       │   ├── tenant.ts / tenant.test.ts   # Multi-tenant scoping helpers (brand-isolated queries)
│   │       │   └── migrations/       # Sequential SQL files generated by `db:generate`; never hand-edit
│   │       ├── middleware/           # Shared Hono middleware
│   │       │   ├── tenant.ts         # requireAdminBrand — cross-brand isolation
│   │       │   └── validate.ts       # onValidationError hook for zValidator
│   │       ├── routes/               # HTTP route handlers, each mounted in index.ts
│   │       │   ├── admin.ts          # /admin/* — brand management, trips CRUD, cargo, uploads, DNS status; guarded by requireAuth + requireAdminBrand
│   │       │   ├── share.ts          # /share/* — public share-page data endpoint (no auth)
│   │       │   ├── internal.ts       # /internal/* — Caddy on_demand_tls ask endpoint; token in query param, not logged
│   │       │   └── *.test.ts         # Co-located: admin.arch, admin.cargo-mutations, admin.cargo-photos, admin.dns-status, admin.trip-*, admin.uploads, share, internal
│   │       ├── storage/              # Storage abstraction: local.ts (dev, serves from uploads/), types.ts; URL assembled via storage.url(key) — DB stores storageKey only
│   │       │   ├── local.ts / local.test.ts
│   │       │   ├── index.ts
│   │       │   └── types.ts
│   │       ├── scripts/              # One-off admin scripts: seed-admin.ts, seed-demo-trip.ts, assign-brand-owner.ts
│   │       └── uploads/              # Runtime upload directory — contents never committed
│   │
│   └── web/                          # React 19 SPA built with Vite 8, TanStack Router + TanStack Query
│       └── src/
│           ├── main.tsx              # Entry: QueryClient + RouterProvider wrapping routeTree.gen; ReactQueryDevtools in dev
│           ├── index.css
│           ├── routeTree.gen.ts      # AUTO-GENERATED by TanStack Router; never hand-edit (edit routes/*.tsx instead)
│           ├── components/           # Shared UI components
│           │   ├── GeoSearch.tsx     # Geocoder autocomplete (calls /admin/geocode proxy)
│           │   ├── TripMap.tsx       # Map display component (uses simulation/interpolate)
│           │   └── ui/               # shadcn/ui (base-nova theme) primitives
│           ├── lib/                  # Client utilities, all co-located with tests
│           │   ├── api.ts / api.test.ts          # Typed fetch wrappers against /admin and /share endpoints
│           │   ├── auth.ts           # Auth state helpers (session check, logout)
│           │   ├── format.ts / format.test.ts    # Date/distance/duration formatters
│           │   ├── trip-status.ts / trip-status.test.ts  # Derives live trip status from Trip data
│           │   └── utils.ts          # Tailwind cn() helper
│           └── routes/               # TanStack Router file-based routes
│               ├── __root.tsx        # Root layout
│               ├── index.tsx         # / redirect
│               ├── login.tsx         # /login page
│               ├── s.$hash.tsx       # /s/:hash — public share page (customer-facing, branded domain)
│               └── admin/            # /admin/b/:brandSlug/* — brand admin SPA
│                   ├── route.tsx     # Admin layout / auth gate
│                   ├── index.tsx     # Brand selector
│                   ├── b.$brandSlug.dashboard.tsx
│                   ├── b.$brandSlug.trips.*.tsx  # Trips list, detail, new
│                   └── b.$brandSlug.cargo.*.tsx  # Cargo list, detail, new
│
└── packages/
    ├── schemas/                      # @delivery/schemas — Zod v4 contracts shared across API and web; source of truth for request/response shapes
    │   └── src/
    │       ├── index.ts              # Re-exports all: brand, auth, trip, share, upload, cargo
    │       ├── brand.ts              # Brand/tenant Zod schemas
    │       ├── auth.ts               # Login request/response schemas
    │       ├── trip.ts / trip.test.ts  # Trip, Segment, PauseInterval, GenerateTripInput schemas + tests
    │       ├── share.ts              # Public share-page payload schema
    │       ├── cargo.ts              # Cargo item schemas
    │       └── upload.ts             # Upload response schema
    │
    ├── simulation/                   # @delivery/simulation — route simulation split into two entry points
    │   └── src/
    │       ├── generate.ts           # Node-ONLY entry (./generate): calls Mapbox Directions API + buildTimeline; produces Trip
    │       ├── mapbox.ts             # Mapbox Directions HTTP client (Node)
    │       ├── hos.ts / hos.test.ts  # HOS (Hours of Service) timeline builder; largest test file (36 kB)
    │       ├── interpolate.ts / interpolate.test.ts  # Browser-safe entry (./interpolate): computes lat/lng position from Trip + epoch t; uses @turf/along
    │       └── generate.ts (package.json exports)  # ./generate vs ./interpolate export map enforces the Node/browser split
    │
    └── tsconfig/                     # Shared TypeScript base configs consumed by all apps and packages
```

**Test locations:** all tests are co-located `*.test.ts` next to source — no separate `__tests__` directories. API has the highest density: `auth/` (4 files), `routes/` (9 files), `db/` (1), `storage/` (1), plus 3 at `src/` root. Web tests live in `lib/` (3 files). Packages: `schemas/src/trip.test.ts`, `simulation/src/hos.test.ts` and `interpolate.test.ts`.

**Key structural invariants confirmed in source:**
- DAG: `schemas` → `simulation` → `apps/*`. Import of `apps/*` from `packages/*` is banned.
- `routeTree.gen.ts` is regenerated by TanStack Router CLI — editing routes in `routes/*.tsx` is the only correct path.
- `db/migrations/` SQL files are Drizzle-generated artifacts (first file: `0000_pale_mordo.sql`).
- Storage key vs URL split: DB stores `storageKey`; public URL assembled at read time via `storage.url(key)` (`apps/api/src/storage/local.ts`).
- `/internal/*` requests skip the Hono logger (confirmed in `index.ts` line 18–21) to prevent token leakage from Caddy on_demand_tls query param.

## Naming

### File Naming

- **API source files**: kebab-case throughout — `rate-limiter.ts`, `tenant.ts`, `middleware.ts`, `env.schema.ts` (`apps/api/src/`).
- **API test files**: co-located with source, named `<module>.test.ts`; multi-concern test files use dot-separated descriptors: `admin.trips.test.ts`, `admin.cargo-mutations.test.ts`, `admin.cargo-photos.test.ts`, `admin.dns-status.test.ts`, `admin.trip-distance.test.ts`, `admin.trip-validation.test.ts`, `login.timing.test.ts` — the base module name comes first, then the concern.
- **Web route files**: TanStack dotted convention — `b.$brandSlug.trips.index.tsx`, `b.$brandSlug.trips.$tripId.tsx`, `b.$brandSlug.cargo.new.tsx`; layout boundaries use `route.tsx` and `__root.tsx`.
- **Web lib files**: kebab-case — `trip-status.ts`, `api.ts`, `format.ts`, `auth.ts`, `utils.ts`.
- **Web component files**: PascalCase for domain components (`TripMap.tsx`, `GeoSearch.tsx`); kebab-case for shadcn/ui primitives under `components/ui/` (`badge.tsx`, `input-group.tsx`).
  - **Rule for new components**: kebab-case **only** for files generated by the `shadcn` CLI (it always emits kebab-case under `components/ui/` and overwrites those paths on re-run). Every hand-written component is **PascalCase**, named after its exported component. The split is by origin, not a free choice.
- **Schemas package**: one file per domain, kebab-case — `trip.ts`, `cargo.ts`, `brand.ts`, `auth.ts`, `share.ts`, `upload.ts`; barrel at `src/index.ts`.
- **Simulation package**: kebab-case — `generate.ts`, `interpolate.ts`, `hos.ts`, `mapbox.ts`.

### Function / Variable Naming

- All functions and variables use **camelCase** uniformly.
- Async functions follow verb-noun pattern with no special suffix: `generateTrip`, `buildTimeline`, `interpolatePosition`, `totalPausedSeconds`, `resolvePhotoUrls`, `safeResolve4`.
- DB query helpers in `tenantDb` use `byId`, `byShareHash`, `listAll`, `insert`, `update`, `delete`, `findOwnedIds`, `insertOrGetByStorageKey` — `by*` for single-record lookup, `list*` for multi-row, `findOwned*` for filtered existence checks.
- Web fetch helpers: `apiRequest` (raw `Response`) and `apiJson` (parsed JSON). No `get`/`fetch`/`list` prefix pattern — verb describes intent directly.
- Middleware exports use imperative verb form: `requireAuth`, `requireAdminBrand`.

### Exports

- **Named exports only** across all packages and apps — no default exports observed in any source file.
- Schemas barrel (`packages/schemas/src/index.ts`): `export * from './trip.js'` etc. — re-exports every domain module with `.js` extension.
- API route modules export a single named `const`: `adminRoutes`, `authRoutes`, `shareRoutes` (`apps/api/src/routes/`).
- Middleware exported as named `const`: `requireAuth` (`auth/middleware.ts`), `requireAdminBrand` (`middleware/tenant.ts`).
- Simulation package exports named functions directly from entry files; `generate.ts` re-exports `HosError` from `hos.ts`.

### Type / Zod Schema Naming

- Zod schemas: **PascalCase + `Schema` suffix** — `TripSchema`, `CargoSchema`, `CargoCreateSchema`, `BrandCreateSchema`, `LoginInputSchema`, `TripListItemSchema`, `GenerateTripInputSchema`, `SegmentSchema`, `DrivingSegmentSchema`, `RestSegmentSchema`, `TripStatusSchema`, `PauseIntervalSchema`.
- Inferred TypeScript types: **PascalCase, no suffix**, matching schema name without `Schema` — `Trip`, `Cargo`, `Brand`, `Segment`, `TripStatus`, `PauseInterval`, `LoginInput`.
- Pattern: `export const FooSchema = z.object({...}); export type Foo = z.infer<typeof FooSchema>` — always adjacent, always named this way.
- Drizzle row types in `apps/api/src/db/tenant.ts`: `<Table>Row` / `<Table>Insert` lifted via `$inferSelect` / `$inferInsert` — e.g. `CargoRow`, `CargoInsert`, `TripRow`, `TripInsert`.
- Hono context env types: `AuthEnv`, `BrandEnv`, `AdminEnv` (intersection of the two).

### Suffix Conventions (confirmed)

- `Schema` — every Zod schema object.
- `Routes` — every Hono router instance exported from a route file (`adminRoutes`, `authRoutes`, `shareRoutes`).
- `Env` — Hono generic environment types (`AuthEnv`, `BrandEnv`).
- `Row` / `Insert` — Drizzle inferred DB types.
- `Error` — custom error classes (`HosError`, `ApiError`).
- No `Middleware` suffix; middleware constants use `require*` imperative naming instead.

### Test File Naming and Description Style

- Co-located `*.test.ts` files next to the module under test.
- Multi-scenario API route tests use dot notation: `admin.trips.test.ts`, `admin.cargo-mutations.test.ts` — base route file name + concern slug, all kebab-case after the first dot.
- Test descriptions: `describe('tripStatusFromTimeline', () => { it('returns Pending when ...') })` — `describe` uses the function/module name verbatim; `it` uses plain English starting with a verb in present tense ("returns", "rejects", "resolves").
- No `test()` alias observed — `it()` used exclusively.

## Testing

### Framework & Runner

- **Vitest** in both `apps/api` and `apps/web`; both configs set `environment: 'node'`, glob `src/**/*.test.ts` (web also `.tsx`).
- Run command is per-workspace (`pnpm --filter <pkg> test` or `pnpm -r test`); no root-level script confirmed in the files read.

### Assertion Style

- `expect(...).toBe(...)` for primitives and identity.
- `expect(...).toEqual(...)` for deep object equality.
- `expect(...).toBeNull()`, `.not.toBeNull()`, `.toBeUndefined()`, `.toBeInstanceOf(...)`.
- `expect(...).toThrow(HosError)` for thrown errors; also the try/catch pattern to inspect error properties after throwing.
- `expect(...).toBeCloseTo(value, precision)` for floating-point (used heavily in `hos.test.ts`).
- `expect(...).toSatisfy(predicate)` — used once in `api.test.ts` for compound error assertion.
- `expect(...).toHaveBeenCalledWith(...)`, `.toHaveBeenCalledTimes(...)`, `.mockClear()` / `vi.clearAllMocks()` for mock verification.
- `.rejects.toSatisfy(...)` for async rejection assertions.
- No `should`/`assert` style; Vitest `expect` only.

### Mocking

- **`vi.mock()`** exclusively — no MSW, no other mocking library.
- **`vi.hoisted()`** used in `share.test.ts` to share mutable state between `vi.mock` factory closures and test bodies (a hoisted state object with `brandLookupResult` / `tripLookupResult`).
- **`vi.fn()`** / **`vi.mocked()`** / **`.mockResolvedValue()`** / **`.mockRejectedValue()`** / **`.mockReturnValue()`** — standard function mock API.
- **`vi.stubGlobal('fetch', vi.fn())`** in `apps/web/src/lib/api.test.ts`; cleaned up in `afterEach` via `vi.unstubAllGlobals()`.
- What is mocked vs real:
  - `../env.js` is **always mocked** — every API test file opens with `vi.mock('../env.js', ...)` that injects a literal env object. `env.ts` is never imported directly; `EnvSchema` from `env.schema.ts` would be used in tests (per project rules), and `env.ts` is confirmed never imported.
  - `../db/index.js` (the Drizzle `db` client) is **always mocked** — either a chainable fake object or `{ db: {} }`.
  - `../db/tenant.js` (`tenantDb`) is **always mocked** with `vi.fn()`.
  - Auth/middleware (`requireAuth`, `requireAdminBrand`) mocked to immediately set context variables and call `next()`.
  - `@delivery/simulation/generate` mocked in route tests; the actual `buildTimeline` / `solveMaxDistance` run **real** in `hos.test.ts`.
  - No real Postgres, no PGlite, no Testcontainers — all DB access is mock-chain based.

### DB in Tests

**Confirmed: no real database.** `tenant.test.ts` mocks `./index.js` with a hand-rolled chainable Drizzle mock (passthrough methods return the chain; thenable methods — `where`, `limit`, `returning` — resolve from a `resultQueue` array). `admin.trips.test.ts` provides `{ db: {} }` stub. There is no PGlite import, no `DATABASE_URL` connection, no testcontainer setup in any of the read files.

### Test Structure

- **`describe` + `it`** nesting; one level of `describe` per logical grouping (route, function, schema rule). Some files have multiple top-level `describe` blocks.
- `beforeEach` used to reset mock state (`chainCalls.length = 0`, `resultQueue.length = 0`, `vi.clearAllMocks()`).
- `afterEach` used in `api.test.ts` for `vi.unstubAllGlobals()`.
- AAA (Arrange / Act / Assert) pattern throughout — no given-when-then labels.
- **Description language: English only.** All `describe` and `it` strings are English.

### Test Data Setup

- **Inline literal fixtures** at module scope: named constants (`BRAND_A`, `BRAND_B`, `TRIP_ID`, `VALID_TRIP_INPUT`, `T0`, `TIMELINE`, etc.).
- **Builder/factory functions**: `makeRow(over?: Partial<...>)` in `share.test.ts`; `makeTenantDb(overrides?)` in `admin.trips.test.ts` — both accept partial overrides merged with spread. No external factory library.
- No seed helpers, no database fixtures, no faker — test data is small, hand-crafted, domain-specific.
- `resultQueue` push-pattern in `tenant.test.ts` sequences DB mock responses per test.

### Notable Confirmed Rules

- **`env.ts` is never imported in tests** — confirmed: every file that needs env mocks `../env.js` with `vi.mock`. The rule "use `EnvSchema` from `env.schema.ts`, not `env.ts`" holds.
- **`_resetForTests()` is exported from `rate-limiter.ts`** and called in `beforeEach` in `rate-limiter.test.ts` and `login.timing.test.ts` to reset in-memory bucket state between tests.
- `vi.hoisted()` is the pattern for state shared between `vi.mock` factories and tests (not module-level `let` reassigned inside `beforeEach` without hoisting).

## Do NOT Use

### Deliberately Avoided Patterns

- **Do NOT use `z.string().uuid()` / `.email()` / `.url()`** — Zod v4 requires top-level helpers: `z.uuid()`, `z.email()`, `z.url()`. The old chained syntax silently passes typechecks. Confirmed: all of `packages/schemas/src/` (auth.ts, brand.ts, trip.ts, share.ts) uses only the top-level form.

- **Do NOT write ESM imports without `.js` extension in `apps/api`** — all local imports must carry `.js`: e.g. `import { db } from './db/index.js'`. Confirmed: `apps/api/src/index.ts`, `routes/admin.ts`, `db/tenant.ts` all use `.js` endings. Package imports (`@delivery/schemas`, `hono`, `drizzle-orm`) are the only exception.

- **Do NOT add `baseUrl` to `apps/web/tsconfig.json`** — `paths` works without it in TS 6. Confirmed: web `tsconfig.json` contains only a `paths` entry (`@/*`) with no `baseUrl`.

- **Do NOT define Zod schemas locally inside route files** — shared contracts belong exclusively in `packages/schemas/src/` and are imported as `@delivery/schemas`. Confirmed: `routes/admin.ts` imports all its schemas from `@delivery/schemas`, none defined inline.

- **Do NOT wrap Drizzle in a Repository class** — data access is direct (Drizzle query builder called inline). Confirmed: `apps/api/src/db/tenant.ts` exports plain functions and type aliases, no Repository wrapper.

- **Do NOT store public photo URLs in the database** — only `storageKey` is persisted; the public URL is assembled at read time via `storage.url(key)`. Confirmed: `apps/api/src/db/schema.ts` line 104 stores `storage_key`, not a URL.

- **Do NOT use `@delivery/simulation/generate` in the browser** — `./generate` is Node-only; `./interpolate` is the browser-safe entry point. Confirmed: `apps/web/src/components/TripMap.tsx` imports from `@delivery/simulation/interpolate`; `routes/admin.ts` imports from `@delivery/simulation/generate`.

- **Do NOT import `apps/*` packages from `packages/*`** — DAG direction is `schemas → simulation → apps/{api,web}`; reverse imports or cycles are forbidden.

- **Do NOT collapse `@delivery/schemas` and the Drizzle DB schema** — Zod contracts live in `packages/schemas/src/`, table definitions live in `apps/api/src/db/schema.ts`. They are separate.

- **Do NOT use Drizzle `1.0.0-beta.x` in production** — treat it as pre-release until `1.0.0` final.

- **Do NOT run bare `pnpm <script>`** — pnpm 11 requires `pnpm run <script>` or `pnpm --filter <pkg> <script>`.

- **Do NOT pin shared dep versions per-package** — they live in the pnpm `catalog:` (`pnpm-workspace.yaml`); a per-package literal reintroduces the version drift the catalog exists to prevent.

- **Do NOT use `pnpm.onlyBuiltDependencies` in `package.json`** — pnpm 11 ignores it. Native-build packages go in `allowBuilds` (`pnpm-workspace.yaml`) as an `name: true` map.

---

### Do-Not-Edit Files

- **`apps/web/src/routeTree.gen.ts`** — auto-generated by TanStack Router. Edit route files under `apps/web/src/routes/*.tsx` instead.

- **`apps/api/src/db/migrations/*.sql`** — auto-generated by Drizzle (`pnpm db:generate`). Modify `apps/api/src/db/schema.ts`, then regenerate. Hand-editing SQL after the fact causes schema drift.

- **`docs/runbook.md`, `docs/architecture/README.md`, `docs/adr/*`** — ADRs are immutable (add new ones, never rewrite old ones). Any code change that deviates from the runbook must update it in the same commit.

- **`apps/api/uploads/`** — directory contents must not be committed.

- **`pnpm-lock.yaml`** — never edit by hand; only update via `pnpm install` / `pnpm add`.

---

### Security Regression Traps

- **Do NOT add a protected Hono sub-router without `.use('*', requireAuth)` as its first middleware.** An endpoint registered without this guard is publicly accessible. Confirmed: `apps/api/src/routes/admin.ts` line 33: `adminRoutes.use('*', requireAuth)` is the first statement after `new Hono()`.

- **Do NOT add routes under `/admin/b/:slug/*` without `requireAdminBrand`** — missing this guard leaks data across tenants. Confirmed: `routes/admin.ts` line 111 shows `brandScoped.use('*', requireAdminBrand)` gates all brand-scoped endpoints.

- **Do NOT import `env.ts` in tests** — `apps/api/src/env.ts` calls `process.exit(1)` on validation failure (line 24), which terminates the test runner. Use `EnvSchema` from `apps/api/src/env.schema.ts` instead. Confirmed: `env.test.ts` imports only `EnvSchema` from `./env.schema.js`; no test file imports `env.js` directly.
